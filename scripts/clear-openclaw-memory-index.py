import argparse
import json
import os
from pathlib import Path
import sqlite3
import stat


CLEAR_TABLES = (
    "memory_index_chunks_fts",
    "memory_index_chunks",
    "memory_index_sources",
    "memory_index_meta",
    "memory_embedding_cache",
)


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def count_rows(connection: sqlite3.Connection, table: str) -> int:
    return connection.execute(
        f"SELECT COUNT(*) FROM {quote_identifier(table)}"
    ).fetchone()[0]


def is_reparse_point(path: str) -> bool:
    if os.path.islink(path):
        return True
    is_junction = getattr(os.path, "isjunction", None)
    if is_junction is not None and is_junction(path):
        return True
    attributes = getattr(os.lstat(path), "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return bool(attributes & reparse_flag)


def assert_no_reparse_components(path: str) -> str:
    normalized = os.path.abspath(path)
    candidate = Path(normalized)
    current = Path(candidate.anchor)
    for part in candidate.parts[1:]:
        current /= part
        current_text = str(current)
        if not os.path.lexists(current_text):
            continue
        if is_reparse_point(current_text):
            raise RuntimeError(
                f"Symlink, junction, or reparse-point path component rejected: {current_text}"
            )
    return normalized


def resolve_safe_existing(path: str, expected: str) -> str:
    normalized = assert_no_reparse_components(path)
    if expected == "directory" and not os.path.isdir(normalized):
        raise RuntimeError(f"State-root directory does not exist: {normalized}")
    if expected == "file" and not os.path.isfile(normalized):
        raise RuntimeError(f"Database file does not exist: {normalized}")

    resolved = os.path.realpath(normalized, strict=True)
    assert_no_reparse_components(resolved)
    return resolved


def assert_contained(root: str, candidate: str) -> None:
    normalized_root = os.path.normcase(root)
    normalized_candidate = os.path.normcase(candidate)
    try:
        common = os.path.commonpath((normalized_root, normalized_candidate))
    except ValueError as error:
        raise RuntimeError(f"Database escaped state root: {candidate}") from error
    if common != normalized_root or normalized_candidate == normalized_root:
        raise RuntimeError(f"Database escaped state root: {candidate}")


def discover_databases(roots: list[str]) -> list[tuple[str, str]]:
    databases: list[tuple[str, str]] = []
    seen_roots: set[str] = set()
    seen_databases: set[str] = set()

    for root in roots:
        resolved_root = resolve_safe_existing(root, "directory")
        root_key = os.path.normcase(resolved_root)
        if root_key in seen_roots:
            raise RuntimeError(f"Duplicate OpenClaw state root: {resolved_root}")
        seen_roots.add(root_key)

        agents_path = os.path.join(resolved_root, "agents")
        if not os.path.lexists(agents_path):
            continue
        agents_path = resolve_safe_existing(agents_path, "directory")
        assert_contained(resolved_root, agents_path)

        with os.scandir(agents_path) as agent_entries:
            for agent_entry in agent_entries:
                agent_path = agent_entry.path
                if is_reparse_point(agent_path):
                    raise RuntimeError(
                        f"Symlink, junction, or reparse-point agent path rejected: {agent_path}"
                    )
                if not agent_entry.is_dir(follow_symlinks=False):
                    continue

                database_path = os.path.join(
                    agent_path, "agent", "openclaw-agent.sqlite"
                )
                if not os.path.lexists(database_path):
                    continue
                resolved_database = resolve_safe_existing(database_path, "file")
                assert_contained(resolved_root, resolved_database)
                database_key = os.path.normcase(resolved_database)
                if database_key in seen_databases:
                    raise RuntimeError(
                        f"Duplicate OpenClaw memory-index database: {resolved_database}"
                    )
                seen_databases.add(database_key)
                databases.append((resolved_root, resolved_database))

    return sorted(databases, key=lambda item: os.path.normcase(item[1]))


def existing_clear_tables(connection: sqlite3.Connection) -> set[str]:
    existing_tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    return {table for table in CLEAR_TABLES if table in existing_tables}


def open_read_only(path: str) -> sqlite3.Connection:
    uri = Path(path).as_uri() + "?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=10)


def validate_database(root: str, path: str) -> dict:
    safe_root = resolve_safe_existing(root, "directory")
    safe_path = resolve_safe_existing(path, "file")
    assert_contained(safe_root, safe_path)
    before_bytes = os.path.getsize(safe_path)
    before_mtime_ns = os.stat(safe_path).st_mtime_ns

    connection = open_read_only(safe_path)
    try:
        tables = existing_clear_tables(connection)
        rows = {
            table: count_rows(connection, table)
            for table in CLEAR_TABLES
            if table in tables
        }
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite quick_check failed for {safe_path}: {integrity}")
    finally:
        connection.close()

    if os.path.getsize(safe_path) != before_bytes or os.stat(safe_path).st_mtime_ns != before_mtime_ns:
        raise RuntimeError(f"Validate-only inspection changed the database: {safe_path}")
    return {
        "path": safe_path,
        "bytes": before_bytes,
        "rows": rows,
        "quickCheck": integrity,
        "wouldClear": sum(rows.values()),
        "writesPerformed": False,
    }


def clear_database(root: str, path: str) -> dict:
    safe_root = resolve_safe_existing(root, "directory")
    safe_path = resolve_safe_existing(path, "file")
    assert_contained(safe_root, safe_path)
    before_bytes = os.path.getsize(safe_path)
    connection = sqlite3.connect(safe_path, timeout=10)
    try:
        tables = existing_clear_tables(connection)
        before = {
            table: count_rows(connection, table)
            for table in CLEAR_TABLES
            if table in tables
        }

        connection.execute("BEGIN IMMEDIATE")
        try:
            for table in CLEAR_TABLES:
                if table in tables:
                    connection.execute(f"DELETE FROM {quote_identifier(table)}")
            if "memory_index_chunks_fts" in tables:
                connection.execute(
                    "INSERT INTO memory_index_chunks_fts(memory_index_chunks_fts) "
                    "VALUES('rebuild')"
                )
            all_tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
            if "memory_index_state" in all_tables:
                connection.execute(
                    "UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1"
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise

        after = {
            table: count_rows(connection, table)
            for table in CLEAR_TABLES
            if table in tables
        }
        if any(after.values()):
            raise RuntimeError(f"Memory index rows remain in {safe_path}: {after}")

        connection.execute("VACUUM")
        connection.execute("PRAGMA optimize")
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite quick_check failed for {safe_path}: {integrity}")

        return {
            "path": safe_path,
            "beforeBytes": before_bytes,
            "afterBytes": os.path.getsize(safe_path),
            "removedRows": before,
            "remainingRows": after,
            "quickCheck": integrity,
            "writesPerformed": True,
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate paths and report target rows without writing.",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Explicitly clear only the allowlisted memory-index tables.",
    )
    parser.add_argument(
        "roots",
        nargs="+",
        help="Explicit OpenClaw state roots whose agent memory indexes are targeted.",
    )
    args = parser.parse_args()

    database_paths = discover_databases(args.roots)
    if args.validate_only:
        report = [validate_database(root, path) for root, path in database_paths]
        schema_version = "zhixia.openclaw_memory_index_clear_validation.v1"
    else:
        report = [clear_database(root, path) for root, path in database_paths]
        schema_version = "zhixia.openclaw_memory_index_clear_receipt.v1"

    print(
        json.dumps(
            {
                "schemaVersion": schema_version,
                "validateOnly": args.validate_only,
                "databases": report,
                "rawSessionsTouched": False,
                "taskLedgerTouched": False,
                "nonMemoryTablesTargeted": False,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
