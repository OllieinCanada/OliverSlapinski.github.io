"""Atomic receipt and effect persistence. No network or external write capability."""
import json
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass

TOKEN = re.compile(r"[A-Za-z0-9._:-]{1,128}\Z")


class ProtocolError(ValueError):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def token(value, field):
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise ProtocolError(400, "invalid_" + field)
    return value


def validate_command(command):
    if not isinstance(command, dict) or set(command) - {"operation_id", "expected_target"}:
        raise ProtocolError(400, "invalid_command")
    token(command.get("operation_id"), "operation_id")
    if "expected_target" in command:
        token(command["expected_target"], "expected_target")


@dataclass(frozen=True)
class Result:
    receipt: dict
    replayed: bool


class Store:
    def __init__(self, path):
        self.path = str(path)
        with closing(self.connect()) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS state (
                    name TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                INSERT OR IGNORE INTO state VALUES ('target', 'invoice-1042');
                CREATE TABLE IF NOT EXISTS effects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT NOT NULL,
                    target TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS operations (
                    key TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    effect_id INTEGER NOT NULL UNIQUE REFERENCES effects(id)
                );
            """)

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    def approve(self, command, key=None):
        validate_command(command)
        if key is not None:
            token(key, "idempotency_key")
        fingerprint = json.dumps(command, sort_keys=True, separators=(",", ":"))
        connection = self.connect()
        try:
            # The target check, side effect, and key/receipt binding share one
            # SQLite writer transaction. A client-side snapshot is not a guard.
            connection.execute("BEGIN IMMEDIATE")
            if key is not None:
                existing = connection.execute(
                    "SELECT fingerprint, effect_id FROM operations WHERE key = ?", (key,)
                ).fetchone()
                if existing:
                    if existing["fingerprint"] != fingerprint:
                        raise ProtocolError(409, "idempotency_key_conflict")
                    receipt = self._receipt(connection, existing["effect_id"])
                    connection.commit()
                    return Result(receipt, True)
            target = connection.execute("SELECT value FROM state WHERE name = 'target'").fetchone()[0]
            if "expected_target" in command and command["expected_target"] != target:
                raise ProtocolError(409, "target_mismatch")
            effect_id = connection.execute(
                "INSERT INTO effects(operation_id, target) VALUES (?, ?)",
                (command["operation_id"], target),
            ).lastrowid
            if key is not None:
                connection.execute(
                    "INSERT INTO operations(key, fingerprint, effect_id) VALUES (?, ?, ?)",
                    (key, fingerprint, effect_id),
                )
            receipt = self._receipt(connection, effect_id)
            connection.commit()
            return Result(receipt, False)
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _receipt(connection, effect_id):
        row = connection.execute("SELECT * FROM effects WHERE id = ?", (effect_id,)).fetchone()
        return {"receipt_id": row["id"], "operation_id": row["operation_id"], "target": row["target"]}

    def lookup(self, key):
        token(key, "idempotency_key")
        connection = self.connect()
        try:
            row = connection.execute("SELECT effect_id FROM operations WHERE key = ?", (key,)).fetchone()
            return self._receipt(connection, row[0]) if row else None
        finally:
            connection.close()
