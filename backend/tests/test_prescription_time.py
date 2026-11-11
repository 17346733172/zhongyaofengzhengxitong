import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.api import create_app
from app.store import Store
from tests.postgres import test_schema


class PrescriptionTimeTests(unittest.TestCase):
    def setUp(self):
        self.dsn = test_schema(self)
        self.app = create_app(self.dsn, api_key="", enable_runner=False)
        self.client = self.enterContext(TestClient(self.app))

    def create(self, number):
        response = self.client.post("/api/v1/prescriptions", json={
            "external_no": number, "patient_code": "SIM-TIME",
            "herbs": [{"name": "演示饮片", "grams_per_dose": 10}],
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def review(self, prescription, approved=True):
        response = self.client.post(f"/api/v1/prescriptions/{prescription['id']}/review", json={
            "approved": approved, "operator": "演示审核员", "comment": "时间回归测试",
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_paused_clock_records_actual_receipt_time_and_persists_it(self):
        before = datetime.now(timezone.utc)
        first, second = self.create("TIME-1"), self.create("TIME-2")
        after = datetime.now(timezone.utc)
        self.assertEqual(first["created_at"], second["created_at"])
        self.assertNotEqual(first["created_real_time"], second["created_real_time"])
        for p in (first, second):
            recorded = datetime.fromisoformat(p["created_real_time"])
            self.assertLessEqual(before, recorded)
            self.assertLessEqual(recorded, after)
            event, = self.app.state.service.store.events(entity_id=p["id"])
            self.assertEqual(p["created_real_time"], event["real_time"])
        reopened = Store(self.dsn).read()["prescriptions"]
        self.assertEqual(reopened[first["id"]]["created_real_time"], first["created_real_time"])
        page = self.client.get("/api/v1/prescriptions").json()
        self.assertEqual(page["items"][0]["created_real_time"], first["created_real_time"])
        self.assertEqual(self.client.get("/api/v1/prescriptions/" + first["id"]).json(), first)

    def test_paused_clock_records_actual_approval_and_rejection_times_and_persists_them(self):
        prescriptions = [self.create("APPROVE"), self.create("REJECT")]
        store = self.app.state.service.store
        clock = store.read()["clock"]
        for prescription, approved in zip(prescriptions, (True, False)):
            with self.subTest(approved=approved):
                before = datetime.now(timezone.utc)
                reviewed = self.review(prescription, approved)
                after = datetime.now(timezone.utc)
                review = reviewed["review"]
                recorded = datetime.fromisoformat(review["real_time"])
                self.assertLessEqual(before, recorded)
                self.assertLessEqual(recorded, after)
                self.assertEqual(review["sim_time"], clock["now"])
                self.assertEqual(reviewed["status"], "approved" if approved else "rejected")
                event, = store.events(entity_id=prescription["id"], event_type="prescription.reviewed")
                self.assertEqual(review["real_time"], event["real_time"])
                self.assertEqual(Store(self.dsn).read()["prescriptions"][prescription["id"]], reviewed)
                self.assertEqual(self.client.get("/api/v1/prescriptions/" + prescription["id"]).json(), reviewed)
        self.assertEqual(store.read()["clock"], clock)

    def test_demo_reviews_record_their_actual_event_times(self):
        before = datetime.now(timezone.utc)
        response = self.client.post("/api/v1/simulation/scenarios", json={"count": 3})
        after = datetime.now(timezone.utc)
        self.assertEqual(response.status_code, 201, response.text)
        store = self.app.state.service.store
        state = store.read()
        for batch_id in response.json()["batch_ids"]:
            prescription_id = state["batches"][batch_id]["prescription_id"]
            review = state["prescriptions"][prescription_id]["review"]
            recorded = datetime.fromisoformat(review["real_time"])
            self.assertLessEqual(before, recorded)
            self.assertLessEqual(recorded, after)
            event, = store.events(entity_id=prescription_id, event_type="prescription.reviewed")
            self.assertEqual(review["real_time"], event["real_time"])

    def test_legacy_review_times_restore_from_original_events_without_changing_other_data(self):
        approved = self.review(self.create("LEGACY-APPROVED"))
        rejected = self.review(self.create("LEGACY-REJECTED"), approved=False)
        current = self.review(self.create("CURRENT-REVIEW"))
        unknown = self.review(self.create("UNKNOWN-REVIEW"))
        pending = self.create("PENDING")
        store = self.app.state.service.store
        with store.transaction() as (s, emit):
            for prescription in (approved, rejected):
                del s["prescriptions"][prescription["id"]]["review"]["real_time"]
                emit("prescription.reviewed", prescription["id"], approved=True, operator="later duplicate event")
            orphan = s["prescriptions"].pop(unknown["id"])
            orphan["review"].pop("real_time")
            orphan["id"] = "rx_without_review_event"
            s["prescriptions"][orphan["id"]] = orphan
        before = store.read()
        expected = store.read()
        for prescription in (approved, rejected):
            expected["prescriptions"][prescription["id"]]["review"]["real_time"] = prescription["review"]["real_time"]
        restored = Store(self.dsn).read()
        self.assertEqual(restored, expected)
        self.assertEqual(restored["prescriptions"][current["id"]], current)
        self.assertEqual(restored["prescriptions"][pending["id"]]["review"], None)
        self.assertNotIn("real_time", restored["prescriptions"][orphan["id"]]["review"])
        self.assertEqual(restored["clock"], before["clock"])
        self.assertEqual(restored["last_event_id"], before["last_event_id"])
        self.assertEqual(Store(self.dsn).read(), restored)

    def test_legacy_times_restore_from_first_creation_event_without_fabricating_missing_times(self):
        legacy, current, unknown = self.create("LEGACY"), self.create("CURRENT"), self.create("UNKNOWN")
        store = self.app.state.service.store
        with store.transaction() as (s, emit):
            del s["prescriptions"][legacy["id"]]["created_real_time"]
            orphan = s["prescriptions"].pop(unknown["id"])
            orphan.pop("created_real_time")
            orphan["id"] = "rx_without_creation_event"
            s["prescriptions"][orphan["id"]] = orphan
            emit("prescription.created", legacy["id"], external_no="later duplicate event")
        before = store.read()
        restored = Store(self.dsn).read()
        self.assertEqual(restored["prescriptions"][legacy["id"]]["created_real_time"], legacy["created_real_time"])
        self.assertEqual(restored["prescriptions"][current["id"]], current)
        self.assertNotIn("created_real_time", restored["prescriptions"][orphan["id"]])
        self.assertEqual(restored["clock"], before["clock"])
        self.assertEqual(restored["last_event_id"], before["last_event_id"])
        self.assertEqual(Store(self.dsn).read(), restored)
