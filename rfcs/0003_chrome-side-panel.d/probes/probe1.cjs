// Historical: a probe of chrome.sidePanel run once on 2026-10-14, kept as the
// evidence behind ../research.md.  It is not part of the build or the test suite.
//
// It loads ./dist, an instrumented copy of the Chrome build that was not kept
// (research.md, "The instrumented build", describes it), into Chrome for
// Testing through Puppeteer, in the dev image.  To rerun it, rebuild that copy
// next to this file and run `node <this file>`.

const puppeteer = require("puppeteer");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"],
  });
  try {
    console.log("version", await browser.version());
    const id = await browser.installExtension(__dirname + "/dist");
    const base = `chrome-extension://${id}/`;
    const isBg = t =>
      t.type() === "service_worker" && t.url() === base + "index.js";
    await sleep(1500);
    const worker = async () => (await browser.waitForTarget(isBg)).worker();
    let w = await worker();
    const ev = async s => {
      try {
        return await w.evaluate(s);
      } catch (e) {
        return "EVAL ERR " + e.message;
      }
    };
    console.log(
      "api",
      await ev(`JSON.stringify({
      chromeSP: Object.keys(chrome.sidePanel ?? {}),
      browserSP: typeof browser !== "undefined" ? Object.keys(browser.sidePanel ?? {}) : "no browser global",
      onOpened: !!chrome.sidePanel.onOpened, close: typeof chrome.sidePanel.close })`),
    );
    console.log(
      "getOptions",
      await ev(`chrome.sidePanel.getOptions({}).then(JSON.stringify)`),
    );
    console.log(
      "getPanelBehavior",
      await ev(`chrome.sidePanel.getPanelBehavior().then(JSON.stringify)`),
    );
    console.log(
      "getLayout",
      await ev(
        `chrome.sidePanel.getLayout ? chrome.sidePanel.getLayout().then(JSON.stringify) : "none"`,
      ),
    );
    const [page] = await browser.pages();
    const ext = (await browser.extensions()).get(id);
    const winId = await ev(`chrome.windows.getLastFocused().then(w => w.id)`);
    console.log("windowId", winId);
    const panelTargets = () =>
      browser
        .targets()
        .filter(t => t.url().includes("view=sidebar"))
        .map(t => t.type() + " " + t.url());
    const contexts = () =>
      ev(
        `chrome.runtime.getContexts({}).then(c => JSON.stringify(c.map(x => [x.contextType, x.documentUrl, x.windowId, x.tabId])))`,
      );
    const dump = async label => {
      await sleep(1500);
      console.log(`--- ${label}`);
      console.log(
        " log:",
        JSON.stringify(await ev(`globalThis.__probe.log.splice(0)`)),
      );
      console.log(" targets:", JSON.stringify(panelTargets()));
      console.log(" contexts:", await contexts());
    };
    const closePanel = async () => {
      console.log(
        " close:",
        await ev(
          `chrome.sidePanel.close({windowId: ${winId}}).then(() => "ok", e => "ERR " + e.message)`,
        ),
      );
      await sleep(800);
    };

    // 1. No gesture.
    console.log(
      "1 no-gesture open:",
      await ev(
        `chrome.sidePanel.open({windowId: ${winId}}).then(() => "ok", e => "ERR " + e.message)`,
      ),
    );
    await dump("after no-gesture open");

    // 2. Warm worker, toolbar click, sync open.
    await page.goto("about:blank#sync");
    await page.triggerExtensionAction(ext);
    await dump("warm action click, sync open");

    // Inspect the panel page if it exists.
    const pt = browser.targets().find(t => t.url().includes("view=sidebar"));
    if (pt) {
      console.log(" panel target type:", pt.type());
      try {
        const pp = await pt.asPage();
        await sleep(1500);
        console.log(
          " panel page:",
          await pp.evaluate(
            `JSON.stringify({href: location.href, w: innerWidth, h: innerHeight, view: document.documentElement.dataset.view, list: !!document.querySelector("main.stash-list"), tabsGetCurrent: null, winType: null})`,
          ),
        );
        console.log(
          " panel getCurrent tab:",
          await pp.evaluate(
            `chrome.tabs.getCurrent().then(t => JSON.stringify(t ?? null))`,
          ),
        );
        console.log(
          " panel windows.getCurrent:",
          await pp.evaluate(`chrome.windows.getCurrent().then(w => w.id)`),
        );
        console.log(
          " panel getContexts self:",
          await pp.evaluate(
            `chrome.runtime.getContexts({documentUrls:[location.href]}).then(c => JSON.stringify(c.map(x => x.contextType)))`,
          ),
        );
      } catch (e) {
        console.log(" panel page err", e.message);
      }
    }
    await closePanel();
    await dump("after close");

    // 3. Delayed opens (simulate await before open).
    for (const d of [50, 500, 1500, 5000]) {
      await page.goto("about:blank#delay" + d);
      await page.triggerExtensionAction(ext);
      await sleep(d);
      await dump(`warm action click, open after ${d} ms`);
      await closePanel();
    }

    // 4. Context menu dispatch() (harness path).
    await page.goto("about:blank#sync");
    console.log(
      "4 dispatch:",
      await ev(
        `chrome.tabs.query({active:true}).then(([tab]) => { chrome.contextMenus.onClicked.dispatch({menuItemId: "1:show_tab", editable:false, frameId:0, pageUrl: tab.url}, tab); return "dispatched"; })`,
      ),
    );
    await dump("menu dispatch(), sync open");
    await closePanel();

    // 5. Cold wake: stop the worker, then click.
    const stopWorker = async () => {
      const cdp = await page.createCDPSession();
      await cdp.send("ServiceWorker.enable");
      const t = browser.targets().find(isBg);
      const versions = [];
      cdp.on("ServiceWorker.workerVersionUpdated", e =>
        versions.push(...e.versions),
      );
      await sleep(500);
      for (const v of versions)
        if (v.scriptURL === base + "index.js" && v.runningStatus === "running")
          await cdp
            .send("ServiceWorker.stopWorker", {versionId: v.versionId})
            .catch(e => console.log("stop err", e.message));
      await cdp.detach();
      await sleep(1000);
      console.log(
        " worker running after stop?",
        !!browser.targets().find(isBg),
      );
    };
    await page.goto("about:blank#sync");
    await stopWorker();
    await page.triggerExtensionAction(ext);
    await sleep(2000);
    w = await worker();
    await dump("COLD action click, sync open at top-level listener");
    await closePanel();

    await page.goto("about:blank#delay1500");
    await stopWorker();
    await page.triggerExtensionAction(ext);
    await sleep(3000);
    w = await worker();
    await dump("COLD action click, open 1500ms later");
    await closePanel();

    // 6. setPanelBehavior openPanelOnActionClick.
    console.log(
      "6 setPanelBehavior:",
      await ev(
        `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).then(() => "ok", e => "ERR " + e.message)`,
      ),
    );
    await page.goto("about:blank#noopen");
    await page.triggerExtensionAction(ext);
    await dump("action click with openPanelOnActionClick");
    await closePanel();
    await ev(
      `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: false})`,
    );

    // 7. Per-tab options / enabled false.
    console.log(
      "7 setOptions enabled:false:",
      await ev(
        `chrome.sidePanel.setOptions({enabled: false}).then(() => "ok", e => "ERR " + e.message)`,
      ),
    );
    await page.goto("about:blank#sync");
    await page.triggerExtensionAction(ext);
    await dump("action click with enabled:false");
    await ev(`chrome.sidePanel.setOptions({enabled: true})`);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error("FATAL", e);
  process.exit(1);
});
