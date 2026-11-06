"""One-time SQLite import. Run before starting the PostgreSQL-backed API."""

import argparse
import json
import sqlite3

import psycopg

from .store import import_sqlite


def main():
    parser = argparse.ArgumentParser(description="将已停止的 SQLite 仿真库或其备份导入空 PostgreSQL 数据库")
    parser.add_argument("source", help="SQLite 数据库文件路径")
    args = parser.parse_args()
    try:
        counts = import_sqlite(args.source)
    except (OSError, ValueError, RuntimeError, sqlite3.Error, psycopg.Error) as error:
        parser.exit(1, f"导入失败：{error}\n")
    print(json.dumps(counts, ensure_ascii=False))


if __name__ == "__main__":
    main()
