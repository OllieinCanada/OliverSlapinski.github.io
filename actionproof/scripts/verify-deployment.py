"""Read-only verification of a public Render deployment and its measured data."""
import argparse
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class EvidenceParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.parts = []

    def handle_starttag(self, tag, attributes):
        self.inside = tag == "script" and dict(attributes).get("id") == "adapter-evidence"

    def handle_endtag(self, tag):
        if tag == "script":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.parts.append(data)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def verify_deployment(origin, expected_commit):
    parsed = urlsplit(origin)
    require(parsed.scheme == "https" and parsed.hostname and parsed.hostname.endswith(".onrender.com"), "Expected an HTTPS Render origin")
    require(not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ["", "/"], "Expected an origin without credentials or path")
    origin = origin.rstrip("/")
    observed = []

    def fetch(path, mime):
        with urlopen(Request(origin + path, headers={"User-Agent": "ActionProof-Deployment-Check/0.2"}), timeout=30) as response:
            require(response.status == 200, f"{path}: expected HTTP 200")
            require(response.headers.get_content_type() in mime, f"{path}: unexpected MIME type")
            data = response.read(2_000_001)
            require(len(data) <= 2_000_000, "Response exceeded inspection limit")
            observed.append({"path": path, "status": response.status, "content_type": response.headers.get_content_type()})
            return data.decode("utf-8")

    html = fetch("/", {"text/html"})
    require("Beyond simulation: disconnect, restart, retry." in html, "Real adapter section is missing")
    for path in ["/engine.mjs", "/app.mjs"]:
        fetch(path, {"text/javascript", "application/javascript"})
    fetch("/styles.css", {"text/css"})
    evidence = json.loads(fetch("/adapter-evidence.json", {"application/json"}))
    parser = EvidenceParser()
    parser.feed(html)
    require(json.loads("".join(parser.parts)) == evidence, "HTML and downloaded evidence disagree")
    require(evidence["source_commit"] == expected_commit, "Deployment report came from a different commit")
    require(evidence["model"] == "real-http-sqlite" and evidence["case_count"] == 8, "Unexpected report")
    cases = {case["id"]: case for case in evidence["cases"]}
    require(len(cases) == 8 and all(case["checks_passed"] for case in cases.values()), "Incomplete experiment checks")
    require(cases["concurrent-key"]["concurrent_clients"] == 20 and cases["concurrent-key"]["effect_count"] == 1, "Concurrent-key evidence missing")
    require(cases["crash-restart"]["process_restart_observed"] is True and cases["crash-restart"]["effect_count"] == 1, "Restart evidence missing")
    require(cases["lost-response-unkeyed"]["effect_count"] == 2 and cases["wrong-target-control"]["wrong_target_count"] == 1, "Unsafe controls missing")
    return {"url": origin, "verified_at": datetime.now(timezone.utc).isoformat(), "source_commit": expected_commit, "requests": observed, "measured_cases": 8, "checks_passed": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = verify_deployment(args.url, args.commit)
    encoded = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    print(encoded)


if __name__ == "__main__":
    main()
