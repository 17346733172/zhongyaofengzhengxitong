import json
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

import psycopg

from app.store import Store, import_sqlite
from app.workflow import initial_state
from tests.postgres import test_schema


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.dsn = test_schema(self)
        temp = self.enterContext(TemporaryDirectory(prefix="decoction-sqlite-"))
        self.source = Path(temp) / "仿真源.db"
        self.sqlite = self.enterContext(closing(sqlite3.connect(self.source)))
        self.sqlite.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA wal_autocheckpoint=0;
            CREATE TABLE simulation_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, sim_time REAL NOT NULL,
                real_time TEXT NOT NULL, type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL
            );
        """)
        self.state = initial_state()
        self.state["prescriptions"] = {"rx_z": {"external_no": "演示一"}, "rx_a": {"external_no": "演示二"}}
        self.state["batches"] = {"batch_z": {"prescription_id": "rx_z", "pot_id": "pot-01"}}
        self.state["clock"]["now"] = 3.25
        self.sqlite.execute("INSERT INTO simulation_state VALUES (1, ?)", (json.dumps(self.state),))
        self.sqlite.executemany("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)", [
            (7, 1.0, "2026-11-05T00:00:00+00:00", "batch.created", "batch_z", '{"sequence": 1}'),
            (12, 3.25, "2026-11-05T00:00:01+00:00", "batch.started", "batch_z", '{"pot_id": "pot-01"}'),
            (19, 3.25, "2026-11-05T00:00:02+00:00", "temporary", "test", '{}'),
        ])
        self.sqlite.execute("DELETE FROM events WHERE id=19")
        self.sqlite.commit()

    def test_import_preserves_wal_state_order_and_event_cursor(self):
        wal = self.source.with_name(self.source.name + "-wal")
        original = self.source.read_bytes(), wal.read_bytes()
        result = import_sqlite(self.source, self.dsn)
        self.assertEqual((result["prescriptions"], result["batches"], result["events"], result["last_event_id"]),
                         (2, 1, 2, 12))
        store = Store(self.dsn)
        state = store.read()
        self.assertEqual(state.pop("last_event_id"), 12)
        self.assertEqual(state, self.state)
        self.assertEqual(list(state["prescriptions"]), ["rx_z", "rx_a"])
        event, = store.events(after_id=7, entity_id="batch_z")
        self.assertEqual((event["id"], event["sim_time"], event["real_time"], event["payload"]),
                         (12, 3.25, "2026-11-05T00:00:01+00:00", {"pot_id": "pot-01"}))
        with store.transaction() as (_, emit):
            emit("simulation.pause", "simulation")
        self.assertEqual(store.events(after_id=12)[0]["id"], 20)
        self.assertEqual((self.source.read_bytes(), wal.read_bytes()), original)
        with self.assertRaisesRegex(ValueError, "已初始化"):
            import_sqlite(self.source, self.dsn)
        self.assertEqual(store.read()["last_event_id"], 20)

    def test_failed_event_import_rolls_back_and_can_retry(self):
        self.sqlite.execute("UPDATE events SET payload='invalid' WHERE id=12")
        self.sqlite.commit()
        with self.assertRaises(psycopg.errors.InvalidTextRepresentation):
            import_sqlite(self.source, self.dsn)
        self.sqlite.execute("UPDATE events SET payload='{}' WHERE id=12")
        self.sqlite.commit()
        self.assertEqual(import_sqlite(self.source, self.dsn)["events"], 2)
