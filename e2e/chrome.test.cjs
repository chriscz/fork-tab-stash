// End-to-end test of the Chrome (Manifest V3) build in a real browser.
//
// Chrome stops an idle extension service worker at any time and starts it
// again on the next event, re-running the whole background script.  This test
// stops the worker, wakes it by opening the stash list, and checks that the
// daily "gc" alarm survives the restart unchanged and the page loads cleanly.
//
// Run it with `make check-e2e-chrome` (builds dist-chrome/ first).  It needs
// Puppeteer and Chrome for Testing from install-test-deps.sh, which the dev
// Docker image already has: `bin/dev run make check-e2e-chrome`.
// The e2e tests are supported only in that image (on macOS, use Colima or a
// similar Docker runtime).

const {test} = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const puppeteer = require("puppeteer");

const EXTENSION_DIR = path.resolve(__dirname, "..", "dist-chrome");
const TIMEOUT_MS = 30_000;

const isBackground = t =>
  t.type() === "service_worker" && t.url().endsWith("/index.js");

// Polls fn() until it returns a truthy value or the timeout runs out.
async function poll(fn, what, timeout = TIMEOUT_MS) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

const getGcAlarm = worker => worker.evaluate(() => chrome.alarms.get("gc"));

test("the gc alarm survives a service worker restart", async () => {
  const browser = await puppeteer.launch({
    headless: true, // new headless; the old one can't load extensions
    pipe: true, // loading unpacked extensions goes over the CDP pipe
    enableExtensions: [EXTENSION_DIR],
    // The container has no user namespaces for the sandbox and a small /dev/shm
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const firstTarget = await browser.waitForTarget(isBackground, {
      timeout: TIMEOUT_MS,
    });
    const extensionId = new URL(firstTarget.url()).host;
    const firstWorker = await firstTarget.worker();

    // The background creates the alarm as the last step of starting up.
    const {scheduledTime} = await poll(
      () => getGcAlarm(firstWorker),
      "the gc alarm",
    );

    await firstWorker.close();
    await poll(
      () => !browser.targets().includes(firstTarget),
      "the service worker to stop",
    );

    // The stash list connects to the background's stores, which wakes it.
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(e));
    await page.goto(`chrome-extension://${extensionId}/stash-list.html`);

    const secondTarget = await browser.waitForTarget(
      t => isBackground(t) && t !== firstTarget,
      {timeout: TIMEOUT_MS},
    );
    const secondWorker = await secondTarget.worker();

    // There's no signal for when the restarted background has finished
    // starting up, so give it a few seconds to (wrongly) replace the alarm.
    const end = Date.now() + 5_000;
    while (Date.now() < end) {
      const alarm = await getGcAlarm(secondWorker);
      assert.ok(alarm, "the gc alarm disappeared after the restart");
      assert.equal(
        alarm.scheduledTime,
        scheduledTime,
        "waking the service worker rescheduled the gc alarm",
      );
      await new Promise(r => setTimeout(r, 250));
    }

    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
