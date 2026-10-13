// End-to-end test of the Firefox (Manifest V2) build in a real browser.
//
// It installs dist/ (or $E2E_DIST) as a temporary (so unsigned) add-on, opens
// the stash list at its moz-extension:// URL and checks that the page starts
// up.
//
// Firefox's WebDriver BiDi ignores extension pages (Mozilla bug 1755014): it
// sends no load, console or error events for them and doesn't run preload
// scripts in them, so Puppeteer's page.goto() never resolves and "pageerror"
// never fires.  The test therefore navigates with raw BiDi commands, inspects
// the page with script.evaluate (which does work), and reads uncaught errors
// from Firefox's own console service in a chrome (browser UI) context.
//
// Run it with `make check-e2e-firefox` (builds dist/ first).  It needs
// Puppeteer and Firefox from install-test-deps.sh, which the dev Docker image
// already has: `bin/e2e test --browser=firefox`, or with `--ref=<commit>` to
// test another commit's build.
// The e2e tests are supported only in that image (on macOS, use Colima or a
// similar Docker runtime).

const {test} = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const puppeteer = require("puppeteer");

// E2E_DIST points at another build, e.g. the one check-e2e-ref makes.
const EXTENSION_DIR = path.resolve(process.env.E2E_DIST ?? "dist");
const ADDON_ID = "tab-stash@condordes.net";
// Firefox gives each add-on a random moz-extension:// host per profile; this
// pins it so the test knows the URL of the extension's pages.
const ADDON_UUID = "6b1e2b9c-6c5e-4a8f-9a57-3d3c0e5f7a10";
const PAGE_URL = `moz-extension://${ADDON_UUID}/stash-list.html`;
const TIMEOUT_MS = 30_000;

test("the extension installs and its stash list starts up", async () => {
  const browser = await puppeteer.launch({
    browser: "firefox",
    headless: true,
    // Without this, BiDi only navigates to http(s), file and blob URLs, and
    // can't evaluate scripts in chrome contexts.
    args: ["--remote-allow-system-access"],
    extraPrefsFirefox: {
      "extensions.webextensions.uuids": JSON.stringify({
        [ADDON_ID]: ADDON_UUID,
      }),
    },
  });
  try {
    const bidi = async (method, params) =>
      (await browser.connection.send(method, params)).result;

    // Sends BiDi's webExtension.install, which Firefox treats as a temporary
    // install (like about:debugging), so the add-on needn't be signed.
    assert.equal(await browser.installExtension(EXTENSION_DIR), ADDON_ID);

    const {context} = await bidi("browsingContext.create", {type: "tab"});
    await bidi("browsingContext.navigate", {
      context,
      url: PAGE_URL,
      wait: "complete",
    });

    const evaluateIn = async (target, expression) => {
      const r = await bidi("script.evaluate", {
        expression,
        target: {context: target},
        awaitPromise: true,
      });
      if (r.type === "exception") throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const evaluate = expression => evaluateIn(context, expression);

    assert.equal(await evaluate("location.href"), PAGE_URL);

    // The page mounts its Vue app only after it has connected to the
    // background's stores, so this also shows the background is running.
    const end = Date.now() + TIMEOUT_MS;
    while (!(await evaluate(`!!document.querySelector("main.stash-list")`))) {
      if (Date.now() > end) throw new Error("The stash list never rendered");
      await new Promise(r => setTimeout(r, 100));
    }

    // Errors may be logged shortly after the page renders; give them a moment.
    await new Promise(r => setTimeout(r, 3_000));

    // Uncaught errors from any of the extension's scripts (this page, the
    // background page, the sidebar), as Firefox's console records them.
    const chrome = await bidi("browsingContext.getTree", {
      "moz:scope": "chrome",
      maxDepth: 0,
    });
    const errors = await evaluateIn(
      chrome.contexts[0].context,
      `JSON.stringify(Services.console.getMessageArray()
        .filter(m => m instanceof Ci.nsIScriptError
          && !(m.flags & Ci.nsIScriptError.warningFlag)
          && m.sourceName.startsWith("moz-extension://${ADDON_UUID}/"))
        .map(m => m.sourceName + ": " + m.errorMessage))`,
    );
    assert.deepEqual(JSON.parse(errors), []);

    // Tab Stash records the errors it catches itself in globalThis.error_log.
    assert.deepEqual(
      JSON.parse(
        await evaluate("JSON.stringify(error_log.map(e => e.summary))"),
      ),
      [],
    );
  } finally {
    await browser.close();
  }
});
