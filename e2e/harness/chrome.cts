// Chrome adapter for the end-to-end driver.  Chrome drives extension pages
// through Puppeteer's ordinary page API over CDP, so this needs no browser
// internals.  The background is a service worker that Chrome may stop and
// start again at any time; restartBackground() stops it on purpose.

const puppeteer = require("puppeteer");

async function launchAdapter({dist}: {dist: string}) {
  const browser = await puppeteer.launch({
    headless: true, // new headless; the old one can't load extensions
    pipe: true, // loading unpacked extensions goes over the CDP pipe
    enableExtensions: true,
    // The container has no user namespaces for the sandbox and a small
    // /dev/shm.  Golden screenshots are compared byte for byte, so every run
    // must rasterise the page the same way.  Without
    // --disable-partial-raster, which makes Chrome redraw whole tiles rather
    // than only their changed parts, anti-aliased edges and text differed by
    // a few colour levels between runs.  Other raster and GPU flags made no
    // difference.
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--lang=en-US",
      "--disable-partial-raster",
    ],
    env: {...process.env, LANG: "en_US.UTF-8", LANGUAGE: "en_US"},
  });

  // Uncaught exceptions and unhandled rejections from the extension's pages
  // and service worker, collected as they happen because CDP keeps no log to
  // read back later.  console.error() calls are left out, as in Firefox.
  const errors: string[] = [];
  let baseUrl = "";
  const watched = new WeakSet<object>();
  const watch = async (target: any) => {
    if (watched.has(target)) return;
    if (target.type() === "page") {
      // Every tab is watched, because a tab may start on about:blank and only
      // later load one of the extension's pages; an error counts if the tab
      // shows an extension page when it happens.  "pageerror" covers both
      // uncaught exceptions and unhandled rejections.
      watched.add(target);
      const p = await target.page();
      p?.on("pageerror", (e: Error) => {
        if (p.url().startsWith(baseUrl))
          errors.push(`${p.url()}: ${e.message}`);
      });
    } else if (
      target.type() === "service_worker" &&
      target.url().startsWith(baseUrl)
    ) {
      // Puppeteer's worker object reports nothing about exceptions, so listen
      // on its CDP session, where both uncaught exceptions and unhandled
      // rejections arrive as Runtime.exceptionThrown.  The session attaches
      // after the worker has started, but enabling Runtime replays exceptions
      // thrown before then.  Being attached also keeps Chrome from stopping
      // the worker when it is idle, so it stops only in restartBackground():
      // tests never see an idle stop.
      watched.add(target);
      const w = await target.worker();
      w.client.on("Runtime.exceptionThrown", (ev: any) =>
        errors.push(
          `${target.url()}: ${ev.exceptionDetails.exception?.description ?? ev.exceptionDetails.text}`,
        ),
      );
    }
  };

  // Anything that fails from here on must close the browser, or it keeps node
  // running.
  let page: any;
  try {
    // installExtension() returns the extension's id, which is also the host
    // of its chrome-extension:// URLs.
    const id: string = await browser.installExtension(dist);
    baseUrl = `chrome-extension://${id}/`;
    // A target that closes before it can be watched has no errors to report.
    browser.on("targetcreated", (t: any) => watch(t).catch(() => {}));
    for (const t of browser.targets()) await watch(t).catch(() => {});

    // Use the tab Chrome starts with, so the window holds only the tabs a test
    // opens itself; "stash all" would also stash an extra blank tab.
    const pages = await browser.pages();
    if (pages.length !== 1) {
      throw new Error(`Expected one tab at start, found ${pages.length}`);
    }
    page = pages[0];
    await page.setViewport({width: 1000, height: 700, deviceScaleFactor: 1});
  } catch (e) {
    await browser.close();
    throw e;
  }
  const isBackground = (t: any) =>
    t.type() === "service_worker" && t.url() === `${baseUrl}index.js`;

  return {
    async open(path: string) {
      await page.goto(baseUrl + path, {waitUntil: "load"});
    },

    // Evaluates js (an expression, possibly a promise) in the page and returns
    // its JSON-serialisable value.
    async eval(js: string) {
      const json = await page.evaluate(
        `(async () => JSON.stringify(await (${js})) ?? "null")()`,
      );
      return JSON.parse(json);
    },

    async screenshot(): Promise<Buffer> {
      return Buffer.from(await page.screenshot({type: "png"}));
    },

    async errors(): Promise<string[]> {
      return [...errors];
    },

    // Stops the extension's service worker, as Chrome does when it is idle.
    // The test's tab leaves the extension first, so no open page wakes the
    // worker straight back up; the driver reopens the page, which wakes it.
    // Closing the worker's target and detaching from it is what lets the
    // worker stop.
    async restartBackground() {
      await page.goto("about:blank", {waitUntil: "load"});
      const target = browser.targets().find(isBackground);
      if (!target)
        throw new Error("The extension's service worker isn't running");
      await (await target.worker()).close();
      const end = Date.now() + 30_000;
      while (browser.targets().includes(target)) {
        if (Date.now() > end) throw new Error("The service worker didn't stop");
        await new Promise(r => setTimeout(r, 100));
      }
    },

    close: () => browser.close(),
  };
}

module.exports = {launchAdapter};
