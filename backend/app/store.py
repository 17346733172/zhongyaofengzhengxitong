"""SQLite snapshot + append-only events committed in the same transaction."""

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .workflow import initial_state


class Store:
    def __init__(self, path):
        self.path = str(Path(path).resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.revision = 0
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS simulation_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sim_time REAL NOT NULL, real_time TEXT NOT NULL,
                    type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id, id);
            """)
            db.execute("INSERT OR IGNORE INTO simulation_state VALUES (1, ?)",
                       (json.dumps(initial_state(), ensure_ascii=False),))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA busy_timeout=15000")
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.lock:
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                state = json.loads(db.execute("SELECT payload FROM simulation_state WHERE id=1").fetchone()[0])
                if state["schema_version"] != 1:
                    raise RuntimeError("数据库版本不兼容")
                pending = []

                def emit(event_type, entity_id, **payload):
                    pending.append((state["clock"]["now"], datetime.now(timezone.utc).isoformat(),
                                    event_type, entity_id, json.dumps(payload, ensure_ascii=False, allow_nan=False)))

                yield state, emit
                db.execute("UPDATE simulation_state SET payload=? WHERE id=1",
                           (json.dumps(state, ensure_ascii=False, allow_nan=False),))
                db.executemany("INSERT INTO events(sim_time, real_time, type, entity_id, payload) VALUES (?,?,?,?,?)", pending)
            self.revision += 1

    def read(self):
        with self.connect() as db:
            db.execute("BEGIN")
            state = json.loads(db.execute("SELECT payload FROM simulation_state WHERE id=1").fetchone()[0])
            state["last_event_id"] = db.execute("SELECT COALESCE(MAX(id),0) FROM events").fetchone()[0]
            return state

    def events(self, after_id=0, limit=100, entity_id=None, event_type=None):
        query = "SELECT * FROM events WHERE id > ?"
        args = [after_id]
        if entity_id:
            query += " AND entity_id = ?"
            args.append(entity_id)
        if event_type:
            query += " AND type = ?"
            args.append(event_type)
        query += " ORDER BY id LIMIT ?"
        args.append(limit)
        with self.connect() as db:
            rows = db.execute(query, args).fetchall()
        return [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]
