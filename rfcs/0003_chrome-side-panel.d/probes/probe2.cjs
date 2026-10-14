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
    const id = await browser.installExtension(__dirname + "/dist");
    const base = `chrome-extension://${id}/`;
    const isBg = t =>
      t.type() === "service_worker" && t.url() === base + "index.js";
    await sleep(1500);
    let w = await (await browser.waitForTarget(isBg)).worker();
    const ev = async s => {
      try {
        return await Promise.race([
          w.evaluate(s),
          sleep(8000).then(() => "TIMEOUT"),
        ]);
      } catch (e) {
        return "EVAL ERR " + e.message;
      }
    };
    const [page] = await browser.pages();
    const ext = (await browser.extensions()).get(id);
    const winId = await ev(`chrome.windows.getLastFocused().then(w => w.id)`);
    const panelTargets = () =>
      browser
        .targets()
        .filter(t => t.url().includes("view=sidebar"))
        .map(t => t.type());
    const dump = async label => {
      await sleep(1500);
      console.log(`--- ${label}`);
      console.log(
        " log:",
        JSON.stringify(await ev(`globalThis.__probe.log.splice(0)`)),
      );
      console.log(" panel targets:", JSON.stringify(panelTargets()));
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
    const stop = async () => {
      await page.goto("about:blank", {waitUntil: "load"});
      const t = browser.targets().find(isBg);
      await (await t.worker()).close();
      const end = Date.now() + 15000;
      while (browser.targets().includes(t) && Date.now() < end)
        await sleep(100);
      console.log(" stopped:", !browser.targets().includes(t));
    };
    const rewatch = async () => {
      w = await (await browser.waitForTarget(isBg, {timeout: 10000})).worker();
    };

    for (let i = 0; i < 50 && (await ev("!!globalThis.model")) !== true; i++)
      await sleep(200);
    console.log(
      "set opts:",
      await ev(
        `model.options.sync.set({browser_action_show: "none", browser_action_stash: "none"}).then(() => "ok")`,
      ),
    );
    for (const d of [0, 50, 500]) {
      await ev(`globalThis.__mode = "delay${d}"`);
      (await page.bringToFront(), await page.triggerExtensionAction(ext));
      await sleep(d);
      await dump(`warm action click, open after ${d} ms`);
      await closePanel();
    }
    await ev(`globalThis.__mode = undefined`);

    // Does an open side panel keep the worker alive / does stop work?
    (await page.bringToFront(), await page.triggerExtensionAction(ext));
    await dump("warm click to open panel before stop");
    await stop();
    await sleep(1000);
    console.log(
      " worker target present 1s after stop with panel open:",
      !!browser.targets().find(isBg),
    );
    await rewatch().catch(e => console.log(" rewatch err", e.message));
    await closePanel();

    // Cold wake, sync open in top-level listener.
    await stop();
    await page.goto("data:text/html,<title>sync</title>sync");
    (await page.bringToFront(), await page.triggerExtensionAction(ext));
    await sleep(2500);
    await rewatch();
    await dump("COLD click, sync open in top-level listener");
    await closePanel();

    for (const d of [300, 1500]) {
      await stop();
      await page.goto(`data:text/html,delay${d}`);
      (await page.bringToFront(), await page.triggerExtensionAction(ext));
      await sleep(d + 2500);
      await rewatch();
      await dump(`COLD click, open ${d} ms later`);
      await closePanel();
    }

    // setPanelBehavior
    await page.goto("data:text/html,noopen");
    console.log(
      "setPanelBehavior:",
      await ev(
        `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).then(() => "ok", e => "ERR " + e.message)`,
      ),
    );
    (await page.bringToFront(), await page.triggerExtensionAction(ext));
    await dump("click with openPanelOnActionClick (warm)");
    await closePanel();
    await stop();
    await page.goto("data:text/html,noopen");
    (await page.bringToFront(), await page.triggerExtensionAction(ext));
    await sleep(2500);
    await rewatch();
    await dump("click with openPanelOnActionClick (COLD)");
    console.log(
      " behavior persisted across restart:",
      await ev(`chrome.sidePanel.getPanelBehavior().then(JSON.stringify)`),
    );
    await closePanel();
    await ev(
      `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: false})`,
    );

    // enabled:false
    console.log(
      "setOptions enabled:false:",
      await ev(
        `chrome.sidePanel.setOptions({enabled: false}).then(() => "ok", e => "ERR " + e.message)`,
      ),
    );
    await page.goto("data:text/html,sync");
    (await page.bringToFront(), await page.triggerExtensionAction(ext));
    await dump("click with enabled:false");
    await ev(`chrome.sidePanel.setOptions({enabled: true})`);

    // close() without gesture works? already tested via ev. Popup + side panel interplay
    console.log(
      "setPopup then click:",
      await ev(
        `chrome.action.setPopup({popup: "stash-list.html?view=popup"}).then(() => "ok")`,
      ),
    );
    (await page.bringToFront(),
      await page
        .triggerExtensionAction(ext)
        .catch(e => console.log("trigger err", e.message)));
    await dump("click with popup set");
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error("FATAL", e);
  process.exit(1);
});
