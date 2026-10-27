"""Record a captioned, approximately 90-second walkthrough of the real build."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts"
OUTPUT.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900}, record_video_dir=str(OUTPUT / "video"), record_video_size={"width": 1440, "height": 900})
    page = context.new_page()
    page.goto((ROOT / "actionproof-demo.html").as_uri())
    page.wait_for_selector("#adapter-matrix tr")
    page.evaluate("""() => {
      const caption = document.createElement('div'); caption.id = 'demo-caption';
      caption.style.cssText = 'position:fixed;z-index:10000;left:5%;right:5%;bottom:20px;background:#152521;color:#f6f4eb;padding:18px 24px;font:18px/1.5 system-ui;border:1px solid #a5ba87;border-radius:5px;box-shadow:0 8px 30px #0004';
      document.body.append(caption);
    }""")
    started = time.monotonic()

    def caption(text):
        page.locator("#demo-caption").evaluate("(element, text) => element.textContent = text", text)

    def until(seconds):
        page.wait_for_timeout(max(0, (started + seconds - time.monotonic()) * 1000))

    page.locator("#lab").scroll_into_view_if_needed()
    caption("A timeout is not evidence of failure. Here the first approval committed; blind retry commits it again. The agent still reports success.")
    until(18)
    page.select_option("#strategy", "guarded")
    caption("Reconcile before claiming success. The original receipt proves one committed effect. Under a status outage, a retained operation key can deduplicate a retry.")
    until(27)
    page.select_option("#scenario", "read-outage")
    until(36)
    page.select_option("#scenario", "key-expired")
    caption("Safety is not completion. When the deduplication guarantee expires and evidence is unavailable, the safe outcome is unknown—not another write.")
    until(54)
    page.locator("#adapter").scroll_into_view_if_needed()
    caption("Beyond simulation: real HTTP disconnects, a process exit after SQLite commit, restart, and 20 concurrent clients. The harness reads the database directly.")
    until(72)
    caption("Two controls intentionally reproduce unsafe effects. Download the evidence and inspect its tested commit. No model or external financial system is called.")
    until(90)
    video = page.video
    context.close()
    video.save_as(str(OUTPUT / "actionproof-walkthrough.webm"))
    browser.close()
    print("Recorded captioned walkthrough: artifacts/actionproof-walkthrough.webm")
