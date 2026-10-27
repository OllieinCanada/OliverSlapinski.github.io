"""Run real HTTP, process-restart, and SQLite experiments against a local lab."""
import argparse
import json
import os
import platform
import queue
import sqlite3
import subprocess
import sys
import tempfile
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from http.client import HTTPConnection, RemoteDisconnected
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMAND = {"operation_id": "approve-invoice-1042", "expected_target": "invoice-1042"}
KEY = "operation-1042"


def verify(condition, message):
    if not condition:
        raise AssertionError(message)


class Lab:
    def __init__(self, database):
        self.database = Path(database)
        self.process = None
        self.port = None

    def start(self, fault="none"):
        if self.process is not None and self.process.poll() is None:
            raise RuntimeError("server_already_running")
        self.process = subprocess.Popen(
            [sys.executable, "-m", "adapter.server", "--db", str(self.database), "--fault", fault],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        lines = queue.Queue()
        threading.Thread(target=lambda: lines.put(self.process.stdout.readline()), daemon=True).start()
        try:
            line = lines.get(timeout=10)
            if not line:
                self.process.wait(timeout=5)
                raise RuntimeError("Server failed before readiness: " + self.process.stderr.read()[-2000:])
            ready = json.loads(line)
            verify(ready["host"] == "127.0.0.1", "Server must bind only to loopback")
            self.port = ready["port"]
        except BaseException:
            self.close()
            raise
        return self

    def close(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            self.process.stdout.close()
            self.process.stderr.close()

    def request(self, method, path, body=None, key=None, raw=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        if key is not None:
            headers["Idempotency-Key"] = key
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        try:
            connection.request(method, path, data, headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def approve(self, command=None, key=KEY):
        return self.request("POST", "/approve", COMMAND if command is None else command, key)

    def effects(self):
        # Independent observation: read the database, never the HTTP handler's
        # success claim or Store's receipt serializer.
        connection = sqlite3.connect(self.database)
        try:
            rows = connection.execute("SELECT id, operation_id, target FROM effects ORDER BY id").fetchall()
            return [{"receipt_id": row[0], "operation_id": row[1], "target": row[2]} for row in rows]
        finally:
            connection.close()

    def set_target(self, target):
        # Harness-only fault injection. There is no public control endpoint.
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("UPDATE state SET value = ? WHERE name = 'target'", (target,))
            connection.commit()
        finally:
            connection.close()


@contextmanager
def local_lab(fault="none"):
    with tempfile.TemporaryDirectory(prefix="actionproof-") as directory:
        lab = Lab(Path(directory) / "effects.sqlite")
        try:
            lab.start(fault)
            yield lab
        finally:
            lab.close()


def expect_disconnect(lab, key=KEY):
    try:
        lab.approve(key=key)
    except (RemoteDisconnected, ConnectionResetError):
        return
    raise AssertionError("Expected a real transport disconnect after commit")


def record(lab, case, name, *, expected_effects, control=False, **facts):
    effects = lab.effects()
    verify(len(effects) == expected_effects, f"{case}: expected {expected_effects} effects, got {len(effects)}")
    wrong_target = sum(effect["target"] != "invoice-1042" for effect in effects)
    if not control:
        verify(wrong_target == 0, f"{case}: wrong-target effect")
        verify(len(effects) <= 1, f"{case}: duplicate effect")
    return {
        "id": case, "name": name, "kind": "unsafe-control" if control else "guarded",
        "checks_passed": True, "effect_count": len(effects), "wrong_target_count": wrong_target,
        "effects": effects, **facts,
    }


def run_benchmark():
    results = []
    with local_lab() as lab:
        status, response = lab.approve()
        verify(status == 201 and response["replayed"] is False, "Fresh keyed approval must commit")
        results.append(record(lab, "healthy", "Clean keyed commit", expected_effects=1, response_status=status))

    with local_lab("drop-after-commit") as lab:
        expect_disconnect(lab)
        verify(len(lab.effects()) == 1, "The first disconnected request must already be durable")
        status, response = lab.approve()
        verify(status == 200 and response["replayed"] is True, "Retry must return the original receipt")
        results.append(record(lab, "lost-response-keyed", "Response lost; keyed retry", expected_effects=1, transport_disconnected=True, replayed=True))

    with local_lab("drop-after-commit") as lab:
        expect_disconnect(lab, key=None)
        status, _ = lab.approve(key=None)
        verify(status == 201, "Unkeyed control must really issue a second write")
        results.append(record(lab, "lost-response-unkeyed", "Response lost; unkeyed control", expected_effects=2, control=True, transport_disconnected=True))

    with local_lab("crash-after-commit") as lab:
        pid_before = lab.process.pid
        expect_disconnect(lab)
        verify(lab.process.wait(timeout=5) == 86, "Injected crash must terminate the server")
        original = lab.effects()
        verify(len(original) == 1, "Committed SQLite effect must survive process exit")
        lab.close()
        lab.start()
        verify(lab.process.pid != pid_before, "Restart must use a new server process")
        status, lookup = lab.request("GET", "/operations/" + KEY)
        verify(status == 200 and lookup["receipt"]["receipt_id"] == original[0]["receipt_id"], "Receipt must survive restart")
        status, replay = lab.approve()
        verify(status == 200 and replay["receipt"] == lookup["receipt"], "Restarted retry must retain receipt identity")
        results.append(record(lab, "crash-restart", "Process exits after commit; restart", expected_effects=1, process_restart_observed=True, exit_code=86))

    with local_lab() as lab:
        clients = 20
        barrier = threading.Barrier(clients)

        def approve_together(_index):
            barrier.wait(timeout=10)
            return lab.approve()

        with ThreadPoolExecutor(max_workers=clients) as executor:
            responses = list(executor.map(approve_together, range(clients)))
        counts = Counter(status for status, _ in responses)
        receipt_ids = {response["receipt"]["receipt_id"] for _, response in responses}
        verify(counts == {201: 1, 200: 19}, "Exactly one concurrent request should create an effect")
        verify(len(receipt_ids) == 1, "Concurrent clients must receive the same durable receipt")
        results.append(record(lab, "concurrent-key", "20 concurrent clients; one key", expected_effects=1, concurrent_clients=clients, response_status_counts=dict(counts), distinct_receipts=1))

    with local_lab() as lab:
        lab.approve()
        status, response = lab.approve({"operation_id": "different-operation", "expected_target": "invoice-1042"})
        verify(status == 409 and response["error"] == "idempotency_key_conflict", "A key cannot be rebound to a different command")
        results.append(record(lab, "key-conflict", "Key reused for different payload", expected_effects=1, conflict_rejected=True, response_status=status))

    with local_lab() as lab:
        lab.set_target("invoice-2088")
        status, response = lab.approve()
        verify(status == 409 and response["error"] == "target_mismatch", "Target guard must reject before a side effect")
        results.append(record(lab, "target-guard", "Target drift; atomic precondition", expected_effects=0, response_status=status))

    with local_lab() as lab:
        lab.set_target("invoice-2088")
        status, _ = lab.approve({"operation_id": "approve-invoice-1042"}, key=None)
        verify(status == 201, "Unguarded control must actually execute")
        result = record(lab, "wrong-target-control", "Target drift; unguarded control", expected_effects=1, control=True)
        verify(result["wrong_target_count"] == 1, "Control must expose the wrong-target effect")
        results.append(result)

    return {
        "schema_version": 1, "model": "real-http-sqlite", "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_commit": os.environ.get("GITHUB_SHA") or os.environ.get("RENDER_GIT_COMMIT") or None,
        "runtime": {"python": platform.python_version(), "sqlite": sqlite3.sqlite_version},
        "case_count": len(results), "cases": results,
        "scope": "Local synthetic approvals; one SQLite database per case; no LLM or external system calls.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run_benchmark()
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as stream:
                temporary = stream.name
                stream.write(encoded)
            os.replace(temporary, args.output)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
        print(f"Verified {report['case_count']} real HTTP/SQLite cases; wrote {args.output}")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
