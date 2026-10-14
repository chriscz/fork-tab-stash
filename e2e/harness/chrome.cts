// Chrome adapter for the end-to-end driver.  Chrome drives extension pages
// through Puppeteer's ordinary page API over CDP, so this needs no browser
// internals.  The background is a service worker that Chrome may stop and
// start again at any time; restartBackground() stops it on purpose.

const puppeteer = require("puppeteer");

// The page context menu's items, by id, with the message key of each one's
// label, as src/index.ts creates them for Chrome (ids start with "1:").
const MENU_ITEMS = {
  "1:show_tab": "showStashedTabsMenu",
  "1:stash_all": "stashTabsMenu",
  "1:stash_pinned": "stashPinnedTabsMenu",
  "1:stash_one": "stashThisTabMenu",
  "1:stash_one_newgroup": "stashThisTabToNewGroupMenu",
  "1:copy_all": "copyTabsToStashMenu",
  "1:copy_one": "copyThisTabToStashMenu",
  "1:options": "optionsMenu",
};

// Settles as `promise` does, or fails once `ms` have passed, so a protocol
// call that never answers can't hang the test past its timeout.
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${what}`)),
        Math.max(ms, 0),
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

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
  let id = "";
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
    id = await browser.installExtension(dist);
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
  // A request to start the stopped service worker, while one is under way.
  let starting: Promise<void> | undefined;
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

    // Whether the extension's service worker is running and has loaded its
    // model.  A stopped worker is started first, as an event for it would
    // be; the driver polls this, so a start already under way isn't asked
    // for again.  Each call gives up after `timeout` ms.
    async backgroundLoaded(timeout: number): Promise<boolean> {
      const target = browser.targets().find(isBackground);
      if (!target) {
        starting ??= (async () => {
          const cdp = await page.createCDPSession();
          try {
            await cdp.send("ServiceWorker.enable");
            await cdp.send("ServiceWorker.startWorker", {scopeURL: baseUrl});
          } finally {
            await cdp.detach();
          }
        })().finally(() => {
          starting = undefined;
        });
        await within(starting, timeout, "starting the service worker");
        return false;
      }
      const worker = await target.worker();
      return !!(await within(
        worker?.evaluate(`!!globalThis.model`).catch(() => false),
        timeout,
        "the service worker to answer",
      ));
    },

    // Clicks the extension's toolbar button for the test's tab with CDP's
    // Extensions.triggerAction (experimental), which Puppeteer exposes as
    // page.triggerExtensionAction().  Chrome then does what a click on the
    // button does: it opens the button's popup if one is set, or else wakes
    // the service worker if it is stopped and sends action.onClicked with
    // the page's tab.
    async clickToolbarButton(timeout: number) {
      const end = Date.now() + timeout;
      const ext = (
        await within(browser.extensions(), timeout, "the list of extensions")
      ).get(id);
      if (!ext) throw new Error(`Extension ${id} isn't installed`);
      await within(
        page.triggerExtensionAction(ext),
        end - Date.now(),
        "the toolbar button's click",
      );
    },

    // Chrome doesn't let extensions add to the tab's context menu, so Tab
    // Stash's items for it appear in the page's context menu instead, and
    // CDP can't open that menu.  This sends the event Chrome would send
    // when the item is picked, with contextMenus.onClicked.dispatch() in the
    // service worker.  dispatch() is undocumented, skips Chrome's own menu,
    // and doesn't count as user input.  Chrome has no API to list an
    // extension's menu items, so MENU_ITEMS names the ones Tab Stash creates
    // for pages, and contextMenus.update() checks that the item exists.
    async clickTabMenuItem(url: string, label: string, timeout: number) {
      const end = Date.now() + timeout;
      const target = browser.targets().find(isBackground);
      const worker = await target?.worker();
      if (!worker)
        throw new Error("The extension's service worker isn't running");
      const dispatch = worker.evaluate(`(async () => {
        const url = ${JSON.stringify(url)}, label = ${JSON.stringify(label)};
        const items = ${JSON.stringify(MENU_ITEMS)};
        const tab = (await chrome.tabs.query({})).find(t => t.url === url);
        if (!tab) throw new Error("No tab shows " + url);
        const labels = Object.values(items).map(k => chrome.i18n.getMessage(k));
        const id = Object.keys(items).find(id => chrome.i18n.getMessage(items[id]) === label);
        if (!id) {
          throw new Error("No menu item " + JSON.stringify(label)
            + " in the page's context menu, only " + JSON.stringify(labels));
        }
        await chrome.contextMenus.update(id, {});
        chrome.contextMenus.onClicked.dispatch(
          {menuItemId: id, editable: false, frameId: 0, pageUrl: tab.url}, tab);
      })()`);
      await within(dispatch, end - Date.now(), "the menu item's click");
    },

    // Chrome has no sidebar, so there is nothing to close.
    async closeSidebar() {},

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
