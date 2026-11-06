import os
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo


def test_schema(test):
    dsn = os.environ.get("DECOCTION_TEST_DATABASE_URL")
    if not dsn:
        test.skipTest("请设置 DECOCTION_TEST_DATABASE_URL 指向独立 PostgreSQL 测试库")
    schema = sql.Identifier(f"decoction_test_{uuid4().hex}")
    with psycopg.connect(dsn, connect_timeout=5) as db:
        db.execute(sql.SQL("CREATE SCHEMA {}").format(schema))

    def cleanup():
        with psycopg.connect(dsn, connect_timeout=5) as db:
            db.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(schema))

    test.addCleanup(cleanup)
    return make_conninfo(dsn, options=f"-c search_path={schema.as_string()}")
