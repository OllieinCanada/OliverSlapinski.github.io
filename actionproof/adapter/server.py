"""Loopback-only synthetic approval server with explicit one-shot fault modes."""
import argparse
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

from .store import ProtocolError, Store

MAX_BODY = 4096


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_key")
        result[key] = value
    return result


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, address, store, fault="none"):
        super().__init__(address, Handler)
        self.store = store
        self.fault = fault
        self.fault_lock = threading.Lock()
        self.fault_used = False

    def take_fault(self):
        with self.fault_lock:
            if self.fault_used:
                return "none"
            self.fault_used = True
            return self.fault


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass

    def send_json(self, status, payload):
        data = json.dumps(payload, sort_keys=True).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def do_GET(self):
        if self.path == "/healthz":
            self.send_json(200, {"status": "ok", "model": "local-synthetic-adapter"})
        elif self.path.startswith("/operations/"):
            try:
                receipt = self.server.store.lookup(unquote(self.path[len("/operations/"):]))
                self.send_json(200 if receipt else 404, {"receipt": receipt})
            except ProtocolError as error:
                self.send_json(error.status, {"error": error.code})
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/approve":
            self.send_json(404, {"error": "not_found"})
            return
        try:
            # Reject ambiguous framing rather than interpret two different
            # message boundaries on a persistent connection.
            lengths = self.headers.get_all("Content-Length", [])
            keys = self.headers.get_all("Idempotency-Key", [])
            if len(lengths) != 1 or len(keys) > 1 or self.headers.get("Transfer-Encoding"):
                raise ProtocolError(400, "invalid_framing")
            try:
                length = int(lengths[0])
            except ValueError:
                raise ProtocolError(400, "invalid_content_length") from None
            if not 0 < length <= MAX_BODY:
                raise ProtocolError(413, "invalid_body_size")
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ProtocolError(400, "incomplete_body")
            command = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
            result = self.server.store.approve(command, keys[0] if keys else None)
        except ProtocolError as error:
            self.send_json(error.status, {"error": error.code})
            return
        except (ValueError, UnicodeError):
            self.send_json(400, {"error": "invalid_json"})
            return
        # Store.approve has committed and closed its connection before this
        # boundary. These are real disconnect/process-exit faults, not statuses
        # returned by a mocked transport.
        fault = self.server.take_fault() if not result.replayed else "none"
        if fault == "crash-after-commit":
            os._exit(86)
        if fault == "drop-after-commit":
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
            return
        self.send_json(200 if result.replayed else 201, {"receipt": result.receipt, "replayed": result.replayed})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--fault", choices=["none", "drop-after-commit", "crash-after-commit"], default="none")
    args = parser.parse_args()
    server = Server(("127.0.0.1", args.port), Store(args.db), args.fault)
    print(json.dumps({"host": "127.0.0.1", "port": server.server_port}), flush=True)
    try:
        server.serve_forever(poll_interval=0.05)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
