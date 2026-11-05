import tempfile
import unittest
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import create_app
from app import engine

ROOT = Path(__file__).resolve().parent.parent


class BackendTests(unittest.TestCase):
    def setUp(self):
        test_root = ROOT / "data" / "tests"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="run-", dir=test_root)
        self.assertEqual(Path(self.temp.name).resolve().parent, test_root.resolve())
        self.db = Path(self.temp.name) / "test.db"
        self.app = create_app(self.db, api_key="", enable_runner=False, enable_debug_step=True)
        self.client = TestClient(self.app).__enter__()
        self.sequence = 0

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def post(self, path, body=None, status=200):
        result = self.client.post("/api/v1" + path, json=body)
        self.assertEqual(result.status_code, status, result.text)
        return result.json()

    def get(self, path):
        result = self.client.get("/api/v1" + path)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def prescription(self, herbs=None, priority=0, **overrides):
        self.sequence += 1
        data = {"external_no": f"RX-{self.sequence}", "patient_code": "SIM-001", "priority": priority,
                "herbs": herbs or [{"name": "演示A", "grams_per_dose": 10}],
                "recipe": {"soak_seconds": 10, "heat_seconds": 5, "first_decoct_seconds": 20,
                           "second_decoct_seconds": 0, "pre_decoct_seconds": 10, "late_add_seconds": 5}}
        data.update(overrides)
        return self.post("/prescriptions", data, 201)

    def batch(self, **kwargs):
        p = self.prescription(**kwargs)
        self.post(f"/prescriptions/{p['id']}/review", {"approved": True, "operator": "测试员"})
        return self.post("/batches", {"prescription_id": p["id"]}, 201)

    def step(self, seconds):
        return self.post("/simulation/step", {"seconds": seconds})

    def fetch_batch(self, b):
        return self.get(f"/batches/{b['id']}")

    def test_health_and_schema(self):
        self.assertEqual(self.client.get("/health").json()["status"], "ok")
        schema = self.client.get("/openapi.json").json()
        self.assertIn("/api/v1/simulation/step", schema["paths"])
        self.assertEqual(self.get("/workflow")["reference_title"], "北京本草方源煎药中心应用案例")

    def test_default_single_decoction_takes_user_specified_minutes(self):
        b = self.batch(recipe={"second_decoct_seconds": 0})
        expected = {
            "dispensing": 600, "verification": 300, "transport": 300,
            "water_fill": 180, "soaking": 300, "first_decoct": 900,
            "filtering": 180, "packaging": 300, "labeling": 300,
            "quality_check": 180, "distribution": 180, "residue": 120, "cleaning": 180,
        }
        self.assertEqual({step["code"]: step["duration_seconds"] for step in b["steps"]}, expected)
        self.assertEqual(b["planned_processing_seconds"], 67 * 60)
        self.step(67 * 60 - 1)
        self.assertNotEqual(self.fetch_batch(b)["status"], "completed")
        self.step(1)
        done = self.fetch_batch(b)
        self.assertEqual(done["status"], "completed")
        self.assertEqual(done["completed_at"] - done["started_at"], 67 * 60)

    def test_repeated_operations_and_packaging_use_fixed_station_times(self):
        scene = self.post("/simulation/scenarios", {"count": 3}, 201)
        expected_by_kind = {
            "dispenser": 600, "verification": 300, "conveyor": 300, "water": 180,
            "soaking": 300, "decocter": 900, "filter": 180, "packer": 300,
            "labeler": 300, "quality": 180, "dispatch": 180, "residue": 120, "washer": 180,
        }
        for batch_id in scene["batch_ids"]:
            b = self.get(f"/batches/{batch_id}")
            for step in b["steps"]:
                self.assertEqual(step["duration_seconds"], expected_by_kind[step["device_kind"]], step["code"])
            self.assertNotIn("heating", [step["code"] for step in b["steps"]])
            self.assertNotIn("second_heating", [step["code"] for step in b["steps"]])
        large = self.batch(doses=30, bags_per_dose=4)
        self.assertEqual(next(step["duration_seconds"] for step in large["steps"] if step["code"] == "packaging"), 300)

    def test_real_time_defaults_and_debug_step_disabled(self):
        normal = create_app(self.db, api_key="", enable_runner=False, enable_debug_step=False)
        with TestClient(normal) as client:
            self.assertFalse(client.get("/api/v1/workflow").json()["debug_step_enabled"])
            self.assertEqual(client.get("/api/v1/simulation").json()["clock"]["speed"], 1)
            for speed in (0.5, 10, 60):
                self.assertEqual(client.post("/api/v1/simulation/start", json={"speed": speed}).status_code, 422)
            disabled = client.post("/api/v1/simulation/step", json={"seconds": 600})
            self.assertEqual(disabled.status_code, 409)
            self.assertEqual(disabled.json()["error"]["code"], "debug_step_disabled")
            started = client.post("/api/v1/simulation/start", json={})
            self.assertEqual(started.status_code, 200)
            self.assertEqual(started.json()["speed"], 1)
            client.post("/api/v1/simulation/pause")

    def test_real_time_dispensing_boundary_and_pause(self):
        b = self.batch()
        service = self.app.state.service
        with patch("app.service.time.monotonic", return_value=1000):
            service.clock("start", 1)
        with patch("app.service.time.monotonic", return_value=1599):
            service.auto_tick()
        running = service.batch(b["id"])
        self.assertEqual(running["current_stage"], "dispensing")
        self.assertEqual(running["steps"][0]["elapsed_seconds"], 599)
        with patch("app.service.time.monotonic", return_value=1600):
            service.auto_tick()
            service.clock("pause")
        finished = service.batch(b["id"])
        self.assertEqual(finished["steps"][0]["finished_at"], 600)
        self.assertEqual(finished["current_stage"], "verification")
        with patch("app.service.time.monotonic", return_value=2200):
            service.auto_tick()
        self.assertEqual(service.snapshot()["clock"]["now"], 600)
        self.assertEqual(service.batch(b["id"])["steps"][1]["elapsed_seconds"], 0)

    def test_live_operations_settle_time_before_changing_state(self):
        batch = self.batch()
        batch_path = f"/batches/{batch['id']}"
        with patch("app.service.time") as wall_time:
            wall_time.monotonic.return_value = 1000
            self.post("/simulation/start", {})
            wall_time.monotonic.return_value = 1002
            paused = self.post(f"{batch_path}/pause", {})
            self.assertEqual(paused["steps"][0]["elapsed_seconds"], 2)
            wall_time.monotonic.return_value = 1005
            resumed = self.post(f"{batch_path}/resume", {})
            device = resumed["steps"][0]["device_id"]
            wall_time.monotonic.return_value = 1006
            self.post(f"/devices/{device}/fault", {})
            wall_time.monotonic.return_value = 1010
            self.post(f"/devices/{device}/repair", {})
            self.assertEqual(self.get(batch_path)["steps"][0]["elapsed_seconds"], 3)
            wall_time.monotonic.return_value = 1012
            self.post("/simulation/pause")
            self.assertEqual(self.get(batch_path)["steps"][0]["elapsed_seconds"], 5)

    def test_paused_clock_does_not_dispatch_and_resource_count_excludes_paused(self):
        scenario = self.post("/simulation/scenarios", {"count": 8}, 201)
        waiting_path = f"/batches/{scenario['batch_ids'][-2]}"
        self.post("/devices/washer-01/offline", {})
        self.assertTrue(all(b["pot_id"] is None for b in self.get("/simulation")["batches"]))
        self.step(1)
        snapshot = self.get("/simulation")
        self.assertEqual(snapshot["summary"]["waiting_batches"], 1)
        self.assertEqual(self.get("/dashboard")["devices"], snapshot["devices"])
        paused = self.post(f"{waiting_path}/pause", {})
        self.assertIsNone(paused["pot_id"])
        self.assertEqual(self.get("/dashboard")["waiting_batches"], 0)

    def test_telemetry_limits_periodic_samples_and_keeps_stage_boundaries(self):
        batch = self.batch()
        for seconds in (1, 1, 3, 1, 594):
            self.step(seconds)
        points = self.get(f"/batches/{batch['id']}/telemetry")["items"]
        self.assertEqual([(p["sim_time"], p["payload"]["stage"]) for p in points], [
            (0, "dispensing"), (5, "dispensing"), (600, "dispensing"), (600, "verification"),
        ])

    def test_review_and_duplicate_guards(self):
        p = self.prescription()
        self.post("/batches", {"prescription_id": p["id"]}, 409)
        self.post("/prescriptions", {k: p[k] for k in ["external_no", "patient_code", "herbs"]}, 409)
        self.post(f"/prescriptions/{p['id']}/review", {"approved": False, "operator": "测试员"})
        self.post(f"/prescriptions/{p['id']}/review", {"approved": True, "operator": "测试员"}, 409)
        self.post("/batches", {"prescription_id": p["id"]}, 409)
        b = self.batch()
        self.post("/batches", {"prescription_id": b["prescription_id"]}, 409)

    def test_validation(self):
        self.post("/simulation/step", {"seconds": -1}, 422)
        self.post("/simulation/start", {"speed": 99999}, 422)
        self.post("/prescriptions", {"external_no": " ", "patient_code": "A", "herbs": []}, 422)
        self.post("/prescriptions", {"external_no": "A", "patient_code": "A", "herbs": [
            {"name": "A", "grams_per_dose": 10, "method": "late_add"}],
            "recipe": {"first_decoct_seconds": 5, "late_add_seconds": 10}}, 422)
        self.post("/devices", {"name": "fake", "kind": "unknown"}, 422)
        response = self.client.get("/api/v1/batches/missing")
        self.assertEqual(response.status_code, 404)

    def test_full_flow_and_clean_pot(self):
        b = self.batch()
        self.step(10000)
        done = self.fetch_batch(b)
        self.assertEqual(done["status"], "completed")
        self.assertTrue(done["dispatched"])
        self.assertEqual(done["produced_bags"], 6)
        self.assertEqual(done["progress_percent"], 100)
        self.assertEqual(done["remaining_processing_seconds"], 0)
        self.assertTrue(all(s["status"] == "completed" for s in done["steps"]))
        self.assertTrue(all(d["batch_id"] is None for d in self.get("/devices")["items"]))
        trace = self.get(f"/trace/{b['trace_code']}?limit=1000")
        types = [e["type"] for e in trace["batch_events"]]
        self.assertIn("pot.cleaned", types)
        self.assertIn("product.dispatched", types)
        self.assertEqual(self.get("/dashboard")["dispatched_bags"], 6)

    def test_pre_late_and_two_decoctions(self):
        b = self.batch(herbs=[{"name": "先煎A", "grams_per_dose": 10, "method": "pre_decoct"},
                              {"name": "后下B", "grams_per_dose": 5, "method": "late_add"}],
                       recipe={"soak_seconds": 10, "heat_seconds": 5, "pre_decoct_seconds": 10,
                               "first_decoct_seconds": 20, "second_decoct_seconds": 15, "late_add_seconds": 5})
        self.step(10000)
        done = self.fetch_batch(b)
        self.assertTrue(done["late_added"])
        self.assertIn("pre_decoct", [s["code"] for s in done["steps"]])
        self.assertIn("second_decoct", [s["code"] for s in done["steps"]])
        events = self.get(f"/events?entity_id={b['id']}&limit=1000")["items"]
        late = [e for e in events if e["type"] == "ingredient.late_added"]
        self.assertEqual(len(late), 1)
        first = next(s for s in done["steps"] if s["code"] == "first_decoct")
        self.assertEqual(late[0]["sim_time"], first["finished_at"] - 5)

    def test_priority_and_exclusive_resources(self):
        low = self.batch(priority=0)
        high = self.batch(priority=10)
        other = self.batch(priority=5)
        for _ in range(5):
            self.batch(priority=1)
        self.step(1)
        self.assertIsNotNone(self.fetch_batch(high)["pot_id"])
        self.assertIsNotNone(self.fetch_batch(other)["pot_id"])
        self.assertIsNone(self.fetch_batch(low)["pot_id"])
        for _ in range(12):
            self.step(50)
            snapshot = self.get("/simulation")
            assigned = [s["device_id"] for b in snapshot["batches"] for s in b["steps"] if s["status"] == "running"]
            self.assertEqual(len(assigned), len(set(assigned)))
        self.step(10000)
        self.assertEqual(self.get("/batches?status=completed")["total"], 8)

    def test_seven_dispensers_and_eighth_batch_waiting(self):
        batches = [self.batch() for _ in range(8)]
        self.step(599)
        running = [self.fetch_batch(batch) for batch in batches]
        started = [batch for batch in running if batch["pot_id"] is not None]
        self.assertEqual(len(started), 7)
        stations = [batch["steps"][0]["device_id"] for batch in started]
        self.assertEqual(len(set(stations)), 7)
        self.assertTrue(all(batch["steps"][0]["elapsed_seconds"] == 599 for batch in started))
        self.assertIn("工位", running[-1]["waiting_reason"])
        self.assertIsNone(running[-1]["pot_id"])
        self.step(1)
        eighth = self.fetch_batch(batches[-1])
        self.assertIsNotNone(eighth["pot_id"])
        self.assertEqual(eighth["current_stage"], "dispensing")
        self.assertEqual(eighth["steps"][0]["elapsed_seconds"], 0)
        self.step(1)
        self.assertEqual(self.fetch_batch(batches[-1])["steps"][0]["elapsed_seconds"], 1)

    def test_fifty_pots_are_exclusive_until_cleanup_finishes(self):
        scenario = self.post("/simulation/scenarios", {"count": 50}, 201)
        first_id = scenario["batch_ids"][0]
        waiting = self.batch()
        self.step(7 * 600)  # The eighth dispensing wave starts before any batch completes.
        views = {batch["id"]: batch for batch in self.get("/simulation")["batches"]}
        reserved = [batch["pot_id"] for batch in views.values() if batch["pot_id"] is not None]
        self.assertEqual(len(reserved), 50)
        self.assertEqual(len(set(reserved)), 50)
        self.assertIsNone(views[waiting["id"]]["pot_id"])
        self.assertIn("洁净煎药锅", views[waiting["id"]]["waiting_reason"])
        freed_pot = views[first_id]["pot_id"]
        self.post(f"/batches/{first_id}/cancel", {})
        self.step(299)
        self.assertIsNone(self.fetch_batch(waiting)["pot_id"])
        self.step(1)
        self.assertEqual(self.get(f"/batches/{first_id}")["status"], "cancelled")
        self.assertEqual(self.fetch_batch(waiting)["pot_id"], freed_pot)

    def test_device_fault_freezes_then_resumes(self):
        b = self.batch()
        self.step(10)
        started = self.fetch_batch(b)
        device = started["steps"][0]["device_id"]
        self.post(f"/devices/{device}/fault", {"reason": "断电演示"})
        self.step(1000)
        frozen = self.fetch_batch(b)
        self.assertEqual(frozen["steps"][0]["elapsed_seconds"], 10)
        self.assertIn("设备不可用", frozen["waiting_reason"])
        alarm = self.get("/alarms?status=active")["items"][0]
        self.post(f"/alarms/{alarm['id']}/acknowledge", {})
        self.assertEqual(self.get("/alarms?status=active")["total"], 1)
        self.post(f"/devices/{device}/repair", {})
        self.step(10000)
        self.assertEqual(self.fetch_batch(b)["status"], "completed")
        self.assertEqual(self.get("/alarms?status=active")["total"], 0)

    def test_pot_fault_freezes_entire_batch(self):
        b = self.batch()
        self.step(10)
        pot = self.fetch_batch(b)["pot_id"]
        self.post(f"/devices/{pot}/fault", {})
        self.step(50)
        self.assertEqual(self.fetch_batch(b)["steps"][0]["elapsed_seconds"], 10)
        self.post(f"/devices/{pot}/repair", {})
        self.step(5)
        self.assertEqual(self.fetch_batch(b)["steps"][0]["elapsed_seconds"], 15)

    def test_batch_pause_retains_resources(self):
        b = self.batch()
        self.step(10)
        pot = self.fetch_batch(b)["pot_id"]
        self.post(f"/batches/{b['id']}/pause", {})
        self.step(1000)
        paused = self.fetch_batch(b)
        self.assertEqual(paused["steps"][0]["elapsed_seconds"], 10)
        self.assertEqual(paused["pot_id"], pot)
        self.post(f"/batches/{b['id']}/resume", {})
        self.step(10000)
        self.assertEqual(self.fetch_batch(b)["status"], "completed")

    def test_cancel_dirty_pot_must_wash(self):
        b = self.batch()
        self.step(10)
        pot = self.fetch_batch(b)["pot_id"]
        self.post(f"/batches/{b['id']}/cancel", {})
        self.assertTrue(next(d for d in self.get("/devices")["items"] if d["id"] == pot)["batch_id"])
        self.step(299)
        self.assertNotEqual(self.fetch_batch(b)["status"], "cancelled")
        self.step(1)
        done = self.fetch_batch(b)
        self.assertEqual(done["status"], "cancelled")
        self.assertFalse(done["dispatched"])
        self.assertEqual(done["produced_bags"], 0)
        self.assertIsNone(next(d for d in self.get("/devices")["items"] if d["id"] == pot)["batch_id"])

    def test_cancel_before_dispatch_uses_no_pot(self):
        b = self.batch()
        result = self.post(f"/batches/{b['id']}/cancel", {})
        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["pot_id"])

    def test_large_batch_waits_for_sufficient_capacity(self):
        b = self.batch(doses=30, herbs=[{"name": "A", "grams_per_dose": 1000}])
        self.step(100)
        waiting = self.fetch_batch(b)
        self.assertIn("容量", waiting["waiting_reason"])
        self.assertIsNone(waiting["pot_id"])
        self.post("/devices", {"name": "大容量演示锅", "kind": "pot", "capacity_ml": 500000}, 201)
        self.step(1)
        self.assertIsNotNone(self.fetch_batch(b)["pot_id"])

    def test_offline_busy_device_rejected(self):
        b = self.batch()
        self.step(1)
        device = self.fetch_batch(b)["steps"][0]["device_id"]
        self.post(f"/devices/{device}/offline", {}, 409)
        self.post("/devices/washer-01/offline", {})
        self.post("/devices/washer-01/online", {})

    def test_state_and_events_survive_restart(self):
        b = self.batch()
        self.step(25)
        before = self.fetch_batch(b)
        event_id = self.get("/simulation")["last_event_id"]
        other = create_app(self.db, api_key="", enable_runner=False)
        with TestClient(other) as client:
            after = client.get(f"/api/v1/batches/{b['id']}").json()
            self.assertEqual(after, before)
            self.assertGreaterEqual(client.get("/api/v1/simulation").json()["last_event_id"], event_id)

    def test_pagination_and_telemetry(self):
        b = self.batch()
        self.step(10000)
        first = self.get("/events?limit=3")
        second = self.get(f"/events?limit=3&after_id={first['next_after_id']}")
        self.assertGreater(second["items"][0]["id"], first["items"][-1]["id"])
        self.assertEqual(len(self.get("/batches?limit=1")["items"]), 1)
        points = self.get(f"/batches/{b['id']}/telemetry?limit=1000")["items"]
        self.assertGreater(len(points), 5)
        self.assertTrue(all(25 <= e["payload"]["temperature_c"] <= 100 for e in points))

    def test_atomic_rollback(self):
        store = self.app.state.service.store
        before = store.read()
        with self.assertRaisesRegex(RuntimeError, "abort"):
            with store.transaction() as (s, emit):
                s["clock"]["now"] = 999
                emit("fake", "fake")
                raise RuntimeError("abort")
        self.assertEqual(store.read(), before)

    def test_concurrent_duplicate_submission(self):
        data = {"external_no": "SAME", "patient_code": "SIM", "herbs": [{"name": "A", "grams_per_dose": 10}]}
        with ThreadPoolExecutor(max_workers=4) as pool:
            codes = list(pool.map(lambda _: self.client.post("/api/v1/prescriptions", json=data).status_code, range(4)))
        self.assertEqual(sorted(codes), [201, 409, 409, 409])

    def test_auto_run_blocks_manual_step(self):
        self.post("/simulation/start", {"speed": 1})
        self.post("/simulation/step", {"seconds": 1}, 409)
        self.post("/simulation/pause")
        self.assertFalse(self.get("/simulation")["clock"]["running"])

    def test_scenario(self):
        data = self.post("/simulation/scenarios", {"count": 5}, 201)
        self.assertEqual(len(data["batch_ids"]), 5)
        self.step(86400)
        self.assertEqual(self.get("/dashboard")["batch_counts"]["completed"], 5)

    def test_api_key_and_websocket(self):
        secure = create_app(self.db, api_key="test-secret", enable_runner=False)
        with TestClient(secure) as client:
            self.assertEqual(client.get("/api/v1/dashboard").status_code, 401)
            self.assertEqual(client.get("/api/v1/dashboard", headers={"X-API-Key": "test-secret"}).status_code, 200)
            with client.websocket_connect("/ws/simulation") as ws:
                ws.send_json({"api_key": "test-secret"})
                message = ws.receive_json()
                self.assertEqual(message["type"], "snapshot")
            with self.assertRaises(WebSocketDisconnect) as caught:
                with client.websocket_connect("/ws/simulation") as ws:
                    ws.send_json({"api_key": "wrong"})
                    ws.receive_json()
            self.assertEqual(getattr(caught.exception, "code", None), 1008)

    def test_partitioned_steps_match_single_advance(self):
        import copy
        self.post("/simulation/scenarios", {"count": 5}, 201)
        initial = self.app.state.service.store.read()
        large, small = copy.deepcopy(initial), copy.deepcopy(initial)
        events_large, events_small = [], []
        def collect(target, state):
            return lambda kind, entity, **payload: target.append((state["clock"]["now"], kind, entity, payload))
        engine.advance(large, 12000, collect(events_large, large))
        for _ in range(120):
            engine.advance(small, 100, collect(events_small, small))
        self.assertEqual(large, small)
        # Telemetry samples depend on requested step boundaries; production events do not.
        self.assertEqual([e for e in events_large if e[1] != "telemetry.point"],
                         [e for e in events_small if e[1] != "telemetry.point"])

    def test_completed_batch_ignores_later_pot_fault(self):
        b = self.batch()
        self.step(10000)
        pot = self.fetch_batch(b)["pot_id"]
        self.post(f"/devices/{pot}/fault", {})
        self.assertIsNone(self.fetch_batch(b)["waiting_reason"])

    def test_restart_pauses_running_clock_without_offline_progress(self):
        self.step(10)
        with self.app.state.service.store.transaction() as (s, emit):
            s["clock"]["running"] = True
            s["clock"]["speed"] = 60
        restarted = create_app(self.db, api_key="", enable_runner=False)
        with TestClient(restarted) as client:
            clock = client.get("/api/v1/simulation").json()["clock"]
            self.assertFalse(clock["running"])
            self.assertEqual(clock["now"], 10)
            self.assertEqual(clock["speed"], 1)

    def test_auto_runner_advances_and_idle_websocket_clock_updates(self):
        running_app = create_app(self.db, api_key="", enable_runner=True)
        with TestClient(running_app) as client:
            with client.websocket_connect("/ws/simulation") as ws:
                first = ws.receive_json()
                self.assertEqual(first["data"]["clock"]["now"], 0)
                client.post("/api/v1/simulation/start", json={"speed": 1})
                latest = None
                for _ in range(5):
                    message = ws.receive_json()
                    if message["type"] == "snapshot" and message["data"]["clock"]["now"] > 0:
                        latest = message
                        break
                self.assertIsNotNone(latest)
                client.post("/api/v1/simulation/pause")
                now = client.get("/api/v1/simulation").json()["clock"]["now"]
                time.sleep(0.3)
                self.assertEqual(client.get("/api/v1/simulation").json()["clock"]["now"], now)


if __name__ == "__main__":
    unittest.main()
