import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import create_app
from app.models import Herb
from app.service import DomainError, Service
from tests.postgres import test_schema


class CountUnitModelTests(unittest.TestCase):
    def test_legacy_gram_contract_and_count_contract_are_distinct(self):
        grams = Herb(name="演示称重饮片", grams_per_dose=9)
        self.assertEqual(grams.unit, "g")
        piece = Herb(name="演示计数饮片", unit="piece", quantity_per_dose=0.5)
        self.assertEqual(piece.quantity_per_dose, 0.5)
        self.assertIsNone(piece.grams_per_dose)

    def test_missing_or_invalid_quantity_cannot_create_a_herb(self):
        for fields in [{}, {"unit": "piece"}, {"unit": "g", "quantity_per_dose": 3},
                       {"grams_per_dose": 9, "quantity_per_dose": 3},
                       *[{"unit": "piece", "quantity_per_dose": n} for n in [0, -1, float("nan"), float("inf"), 1000001]]]:
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                Herb(name="演示饮片", **fields)

    def test_batch_guard_does_not_treat_pieces_as_grams(self):
        state = {"prescriptions": {"rx": {"status": "approved", "batch_id": None,
                 "herbs": [{"name": "演示计数饮片", "unit": "piece", "quantity_per_dose": 3}]}}}
        with self.assertRaises(DomainError) as caught:
            Service._batch(state, lambda *args, **kwargs: self.fail("must not emit"), "rx")
        self.assertEqual(caught.exception.code, "herb_weight_required")


class CountUnitApiTests(unittest.TestCase):
    def setUp(self):
        self.dsn = test_schema(self)
        self.app = create_app(self.dsn, api_key="", enable_runner=False, enable_debug_step=True)
        self.client = self.enterContext(TestClient(self.app))
        response = self.client.post("/api/v1/prescriptions", json={
            "external_no": "COUNT-TEST", "patient_code": "SIM-COUNT", "doses": 5,
            "herbs": [{"name": "演示计数饮片", "unit": "piece", "quantity_per_dose": 3},
                      {"name": "演示称重饮片", "grams_per_dose": 9}],
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.prescription = response.json()
        self.path = "/api/v1/prescriptions/" + self.prescription["id"]

    def test_unweighed_piece_quantity_is_saved_and_read_without_mass(self):
        saved = self.client.get(self.path).json()
        self.assertEqual(saved["status"], "pending_review")
        self.assertEqual(saved["herbs"][0]["quantity_per_dose"], 3)
        self.assertIsNone(saved["herbs"][0]["grams_per_dose"])
        from app.store import Store
        reloaded = Store(self.dsn).read()["prescriptions"][saved["id"]]
        self.assertEqual(reloaded["herbs"], saved["herbs"])

    def test_approval_needs_measured_mass_and_failed_review_is_atomic(self):
        body = {"approved": True, "operator": "测试员"}
        response = self.client.post(self.path + "/review", json=body)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["code"], "herb_weight_required")
        self.assertEqual(self.client.get(self.path).json(), self.prescription)
        for weight in [{"非本方饮片": 1}, {"演示称重饮片": 8}, {"演示计数饮片": 0}, {"演示计数饮片": -1}]:
            with self.subTest(weight=weight):
                response = self.client.post(self.path + "/review", json={**body, "herb_grams_per_dose": weight})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(self.client.get(self.path).json(), self.prescription)

    def test_review_preserves_piece_quantity_and_water_plan_uses_measured_mass(self):
        response = self.client.post(self.path + "/review", json={
            "approved": True, "operator": "测试员", "herb_grams_per_dose": {"演示计数饮片": 4.5},
        })
        self.assertEqual(response.status_code, 200, response.text)
        herb = response.json()["herbs"][0]
        self.assertEqual((herb["unit"], herb["quantity_per_dose"], herb["grams_per_dose"]), ("piece", 3, 4.5))
        response = self.client.post("/api/v1/batches", json={"prescription_id": self.prescription["id"]})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["water_plan"]["herb_mass_g"], 67.5)
        self.assertEqual(self.client.get(self.path).json()["review"]["herb_grams_per_dose"], {"演示计数饮片": 4.5})

    def test_rejection_does_not_require_mass(self):
        response = self.client.post(self.path + "/review", json={"approved": False, "operator": "测试员"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "rejected")
        self.assertIsNone(response.json()["herbs"][0]["grams_per_dose"])
