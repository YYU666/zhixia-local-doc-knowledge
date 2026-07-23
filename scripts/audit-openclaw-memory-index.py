import argparse
import glob
import json
import os
import sqlite3


MEMORY_NAME_PARTS = (
    "memory",
    "chunk",
    "embedding",
    "promotion",
    "recall",
)


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def inspect_database(path: str) -> dict:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        objects = connection.execute(
            "SELECT name, type, sql FROM sqlite_master "
            "WHERE type IN ('table', 'view') ORDER BY name"
        ).fetchall()
        matches = []
        for name, object_type, schema in objects:
            lowered = name.lower()
            if not any(part in lowered for part in MEMORY_NAME_PARTS):
                continue
            try:
                count = connection.execute(
                    f"SELECT COUNT(*) FROM {quote_identifier(name)}"
                ).fetchone()[0]
            except sqlite3.DatabaseError as error:
                count = f"error: {error}"
            matches.append(
                {
                    "name": name,
                    "type": object_type,
                    "count": count,
                    "sql": schema,
                }
            )
        return {
            "path": path,
            "bytes": os.path.getsize(path),
            "objects": matches,
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "roots",
        nargs="+",
        help="OpenClaw state roots to inspect without modifying them.",
    )
    args = parser.parse_args()

    database_paths = []
    for root in args.roots:
        database_paths.extend(
            glob.glob(os.path.join(root, "agents", "*", "agent", "openclaw-agent.sqlite"))
        )

    report = [inspect_database(path) for path in sorted(set(database_paths))]
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
