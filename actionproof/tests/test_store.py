import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from adapter.store import ProtocolError, Store

COMMAND = {"operation_id": "approve-invoice-1042", "expected_target": "invoice-1042"}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "effects.sqlite"
        self.store = Store(self.path)

    def rows(self):
        connection = sqlite3.connect(self.path)
        try:
            return connection.execute("SELECT operation_id, target FROM effects ORDER BY id").fetchall()
        finally:
            connection.close()

    def test_keyed_retry_returns_same_receipt_and_one_effect(self):
        original = self.store.approve(COMMAND, "key-1")
        replay = self.store.approve(COMMAND, "key-1")
        self.assertFalse(original.replayed)
        self.assertTrue(replay.replayed)
        self.assertEqual(original.receipt, replay.receipt)
        self.assertEqual(self.rows(), [("approve-invoice-1042", "invoice-1042")])

    def test_reopened_store_retains_durable_key_binding(self):
        original = self.store.approve(COMMAND, "key-1")
        reopened = Store(self.path)
        self.assertEqual(reopened.lookup("key-1"), original.receipt)
        self.assertTrue(reopened.approve(COMMAND, "key-1").replayed)
        self.assertEqual(len(self.rows()), 1)

    def test_changed_payload_conflicts_without_new_effect(self):
        self.store.approve(COMMAND, "key-1")
        with self.assertRaises(ProtocolError) as raised:
            self.store.approve({**COMMAND, "operation_id": "other-operation"}, "key-1")
        self.assertEqual((raised.exception.status, raised.exception.code), (409, "idempotency_key_conflict"))
        self.assertEqual(len(self.rows()), 1)

    def test_json_field_order_does_not_change_binding(self):
        first = self.store.approve(COMMAND, "key-1")
        second = self.store.approve(dict(reversed(list(COMMAND.items()))), "key-1")
        self.assertTrue(second.replayed)
        self.assertEqual(first.receipt, second.receipt)

    def test_target_mismatch_rolls_back_effect_and_key(self):
        with self.assertRaises(ProtocolError) as raised:
            self.store.approve({**COMMAND, "expected_target": "invoice-2088"}, "key-1")
        self.assertEqual(raised.exception.code, "target_mismatch")
        self.assertEqual(self.rows(), [])
        self.assertIsNone(self.store.lookup("key-1"))
        self.assertFalse(self.store.approve(COMMAND, "key-1").replayed)

    def test_key_replay_still_returns_original_receipt_after_target_changes(self):
        original = self.store.approve(COMMAND, "key-1")
        connection = sqlite3.connect(self.path)
        try:
            connection.execute("UPDATE state SET value = 'invoice-2088' WHERE name = 'target'")
            connection.commit()
        finally:
            connection.close()
        self.assertEqual(self.store.approve(COMMAND, "key-1").receipt, original.receipt)
        self.assertEqual(len(self.rows()), 1)

    def test_unkeyed_control_really_duplicates(self):
        self.store.approve(COMMAND)
        self.store.approve(COMMAND)
        self.assertEqual(len(self.rows()), 2)

    def test_20_writers_share_one_durable_receipt(self):
        with ThreadPoolExecutor(max_workers=20) as executor:
            results = list(executor.map(lambda _: self.store.approve(COMMAND, "key-1"), range(20)))
        self.assertEqual(sum(not result.replayed for result in results), 1)
        self.assertEqual({result.receipt["receipt_id"] for result in results}, {1})
        self.assertEqual(len(self.rows()), 1)

    def test_invalid_commands_do_not_write(self):
        for command in [None, [], {}, {"operation_id": 123}, {**COMMAND, "surprise": True}, {**COMMAND, "expected_target": None}]:
            with self.subTest(command=command), self.assertRaises(ProtocolError):
                self.store.approve(command, "key-1")
        for key in ["", "x" * 129, "not a key", 42]:
            with self.subTest(key=key), self.assertRaises(ProtocolError):
                self.store.approve(COMMAND, key)
        self.assertEqual(self.rows(), [])

    def test_unknown_key_has_no_receipt(self):
        self.assertIsNone(self.store.lookup("absent-key"))


if __name__ == "__main__":
    unittest.main()
