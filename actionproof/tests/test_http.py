import unittest

from adapter.benchmark import local_lab, run_benchmark


class HTTPTests(unittest.TestCase):
    def test_real_fault_corpus(self):
        report = run_benchmark()
        self.assertEqual(report["model"], "real-http-sqlite")
        self.assertEqual(report["case_count"], 8)
        self.assertTrue(all(case["checks_passed"] for case in report["cases"]))
        self.assertEqual(sum(case["kind"] == "unsafe-control" for case in report["cases"]), 2)

    def test_duplicate_json_keys_are_rejected_without_an_effect(self):
        with local_lab() as lab:
            status, response = lab.request("POST", "/approve", raw=b'{"operation_id":"a","operation_id":"b"}')
            self.assertEqual((status, response["error"]), (400, "invalid_json"))
            self.assertEqual(lab.effects(), [])

    def test_oversized_body_is_rejected_before_a_write(self):
        with local_lab() as lab:
            status, response = lab.request("POST", "/approve", raw=b"x" * 4097)
            self.assertEqual(status, 413)
            self.assertEqual(response["error"], "invalid_body_size")
            self.assertEqual(lab.effects(), [])

    def test_receipt_lookup_and_unknown_routes(self):
        with local_lab() as lab:
            self.assertEqual(lab.request("GET", "/operations/missing")[0], 404)
            self.assertEqual(lab.request("GET", "/effects")[0], 404)
            self.assertEqual(lab.request("GET", "/healthz")[0], 200)

    def test_empty_key_is_not_treated_as_unkeyed(self):
        with local_lab() as lab:
            status, response = lab.approve(key="")
            self.assertEqual((status, response["error"]), (400, "invalid_idempotency_key"))
            self.assertEqual(lab.effects(), [])


if __name__ == "__main__":
    unittest.main()
