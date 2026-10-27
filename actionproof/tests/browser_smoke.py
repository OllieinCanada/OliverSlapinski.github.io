"""Optional real-browser QA. Install playwright==1.62.0 and its Chromium first."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts"
OUTPUT.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto((ROOT / "actionproof-demo.html").as_uri())
    page.wait_for_selector("#matrix tr")
    assert page.locator("#matrix tr").count() == 8
    assert page.locator("#verdict").inner_text() == "UNSAFE"
    assert page.locator("#effects").inner_text() == "2"
    assert page.evaluate("window.scrollY") == 0
    assert page.locator("#adapter-matrix tr").count() == 8
    assert "8 experiments verified" in page.locator("#adapter-status").inner_text()
    with page.expect_download() as evidence_download:
        page.locator("#adapter-download").click()
    evidence = json.loads(Path(evidence_download.value.path()).read_text())
    assert evidence["model"] == "real-http-sqlite"
    concurrency = next(case for case in evidence["cases"] if case["id"] == "concurrent-key")
    assert concurrency["concurrent_clients"] == 20
    assert concurrency["effect_count"] == 1
    assert any(case["kind"] == "unsafe-control" for case in evidence["cases"])

    page.select_option("#strategy", "guarded")
    assert page.locator("#verdict").inner_text() == "COMPLETED"
    assert page.locator("#effects").inner_text() == "1"
    assert page.locator("#attempts").inner_text() == "1"
    page.select_option("#scenario", "key-expired")
    assert page.locator("#verdict").inner_text() == "UNKNOWN"
    assert page.locator("#attempts").inner_text() == "1"

    page.select_option("#scenario", "target-drift")
    page.select_option("#strategy", "observe")
    assert page.locator("#safety").inner_text() == "Violated"
    page.select_option("#strategy", "guarded")
    assert page.locator("#verdict").inner_text() == "REJECTED SAFELY"
    assert page.locator("#effects").inner_text() == "0"

    page.select_option("#scenario", "delayed-ui")
    page.select_option("#strategy", "observe")
    assert page.locator("#outcome").inner_text() == "Unknown"
    page.locator("#budget").fill("8")
    assert page.locator("#outcome").inner_text() == "Success"
    assert "8 logical ticks" in page.locator("#corpus-note").inner_text()

    # A result cell must navigate to the corresponding experiment.
    page.get_by_role("button", name="Inspect Committed. Response lost. with Blind retry: Unsafe", exact=True).click()
    assert page.locator("#scenario").input_value() == "lost-ack"
    assert page.locator("#strategy").input_value() == "retry"
    total = int(page.locator("#step").get_attribute("max"))
    page.locator("#back").click()
    assert page.locator("#trace li").count() == total - 1
    page.locator("#step").fill("1")
    assert page.locator("#trace li").count() == 1
    page.locator("#play").click()
    page.wait_for_function("document.querySelectorAll('#trace li').length > 1")
    page.locator("#play").click()

    with page.expect_download() as download_info:
        page.locator("#download").click()
    trace = json.loads(Path(download_info.value.path()).read_text())
    assert trace["scenario"] == "lost-ack"
    assert trace["violations"] == ["duplicate-effect", "false-success"]

    page.locator("#run").click()
    page.evaluate("window.scrollTo(0,0)")
    page.screenshot(path=str(OUTPUT / "desktop.png"), full_page=True)
    for width in [320, 393, 768]:
        page.set_viewport_size({"width": width, "height": 852})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), f"Overflow at {width}px"
        assert page.locator("#run").is_visible()
        if width == 393:
            page.screenshot(path=str(OUTPUT / "mobile.png"), full_page=True)
    page.screenshot(path=str(OUTPUT / "tablet.png"), full_page=True)
    assert errors == [], errors
    browser.close()
    print("Browser QA passed: controls, replay, measured adapter evidence, downloads, and 320/393/768/1440px layouts.")
