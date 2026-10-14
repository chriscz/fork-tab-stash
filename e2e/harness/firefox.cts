// Firefox adapter for the end-to-end driver.  Firefox's WebDriver BiDi ignores
// extension pages (Mozilla bug 1755014): it sends no load, console or error
// events for them and runs no preload scripts there, so Puppeteer's page API
// doesn't work.  This adapter navigates and evaluates with raw BiDi commands,
// snapshots tabs from the chrome (browser UI) context because BiDi refuses to
// screenshot privileged pages, reads errors from Firefox's console service,
// and restarts the add-on through its add-on manager.
// --remote-allow-system-access is what allows the last three and navigation
// to moz-extension:// URLs.

const puppeteer = require("puppeteer");

const ADDON_ID = "tab-stash@condordes.net";
// Firefox gives each add-on a random moz-extension:// host per profile; this
// pins it so the adapter knows the URL of the extension's pages.
const ADDON_UUID = "6b1e2b9c-6c5e-4a8f-9a57-3d3c0e5f7a10";
const BASE_URL = `moz-extension://${ADDON_UUID}/`;

async function launchAdapter({dist}: {dist: string}) {
  const browser = await puppeteer.launch({
    browser: "firefox",
    headless: true,
    args: ["--remote-allow-system-access"],
    extraPrefsFirefox: {
      "extensions.webextensions.uuids": JSON.stringify({
        [ADDON_ID]: ADDON_UUID,
      }),
      "intl.locale.requested": "en-US",
    },
  });
  const bidi = async (method: string, params: object) =>
    (await browser.connection.send(method, params)).result;
  const evaluateIn = async (context: string, expression: string) => {
    const r = await bidi("script.evaluate", {
      expression,
      target: {context},
      awaitPromise: true,
    });
    if (r.type === "exception") throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const chromeContext = async () =>
    (
      await bidi("browsingContext.getTree", {
        "moz:scope": "chrome",
        maxDepth: 0,
      })
    ).contexts[0].context;

  // Anything that fails from here on must close the browser, or it keeps node
  // running.
  let context: string;
  // The URL open() last navigated the test's tab to, so screenshot() can find
  // that tab among any other extension pages that are open.
  let openedUrl = "";
  try {
    // webExtension.install is a temporary install, like about:debugging, so the
    // add-on needn't be signed.
    const id = await browser.installExtension(dist);
    if (id !== ADDON_ID)
      throw new Error(`Installed ${id}, expected ${ADDON_ID}`);

    // Use the tab Firefox starts with, so the window holds only the tabs a test
    // opens itself; "stash all" would also stash an extra blank tab.
    const tree = await bidi("browsingContext.getTree", {maxDepth: 0});
    if (tree.contexts.length !== 1) {
      throw new Error(
        `Expected one tab at start, found ${tree.contexts.length}`,
      );
    }
    context = tree.contexts[0].context;
    await bidi("browsingContext.setViewport", {
      context,
      viewport: {width: 1000, height: 700},
    });
  } catch (e) {
    await browser.close();
    throw e;
  }

  return {
    async open(page: string) {
      openedUrl = BASE_URL + page;
      await bidi("browsingContext.navigate", {
        context,
        url: openedUrl,
        wait: "complete",
      });
    },

    // Evaluates js (an expression, possibly a promise) in the page and returns
    // its JSON-serialisable value.
    async eval(js: string) {
      const json = await evaluateIn(
        context,
        `(async () => JSON.stringify(await (${js})) ?? "null")()`,
      );
      return JSON.parse(json);
    },

    async screenshot(): Promise<Buffer> {
      const url: string = await evaluateIn(
        await chromeContext(),
        `(async () => {
          const b = gBrowser.browsers.find(b => b.currentURI.spec === ${JSON.stringify(openedUrl)});
          const bmp = await b.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
          const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext("2d").drawImage(bmp, 0, 0);
          return c.toDataURL("image/png");
        })()`,
      );
      return Buffer.from(url.split(",")[1], "base64");
    },

    // Uncaught errors from any of the extension's scripts (pages, background,
    // sidebar), as Firefox's console records them.
    async errors(): Promise<string[]> {
      return JSON.parse(
        await evaluateIn(
          await chromeContext(),
          `JSON.stringify(Services.console.getMessageArray()
            .filter(m => m instanceof Ci.nsIScriptError
              && !(m.flags & Ci.nsIScriptError.warningFlag)
              && m.sourceName.startsWith(${JSON.stringify(BASE_URL)}))
            .map(m => m.sourceName + ": " + m.errorMessage))`,
        ),
      );
    },

    // Whether the add-on's background page has loaded its model.  Firefox's
    // background is a persistent page, which the test's extension page can
    // reach directly.  While the test's tab isn't showing one of the
    // extension's pages, it has no `browser`, so the answer is false.
    async backgroundLoaded(): Promise<boolean> {
      return await evaluateIn(
        context,
        `!!globalThis.browser?.extension?.getBackgroundPage()?.model`,
      );
    },

    // Clicks the add-on's toolbar button in the window holding the test's
    // tab, through browserActionFor(extension).triggerAction(window): the
    // call Firefox's own "_execute_browser_action" shortcut makes, with the
    // same effect as a click on the button.  It opens the button's popup if
    // one is set, or else sends browserAction.onClicked with the window's
    // active tab, and Firefox delivers that event as user input.  The window
    // must be the focused one, as it is in the headless browser.
    async clickToolbarButton() {
      await evaluateIn(
        await chromeContext(),
        `(async () => {
          const {ExtensionParent} = ChromeUtils.importESModule(
            "resource://gre/modules/ExtensionParent.sys.mjs");
          const ext = ExtensionParent.GlobalManager.getExtension(${JSON.stringify(ADDON_ID)});
          if (!ext) throw new Error(${JSON.stringify(`Add-on ${ADDON_ID} isn't running`)});
          const win = [...Services.wm.getEnumerator("navigator:browser")].find(w =>
            w.gBrowser.browsers.some(b => b.currentURI.spec === ${JSON.stringify(openedUrl)}));
          if (!win) throw new Error("No window holds the test's tab");
          await ExtensionParent.apiManager.global.browserActionFor(ext).triggerAction(win);
        })()`,
      );
    },

    // Right-clicks the tab showing `url` and picks `label` from the context
    // menu, opening the submenu Firefox groups an add-on's items into.  The
    // menu is the browser's own, so the item must really be there, and the
    // add-on gets menus.onClicked as user input, as it does from a real click.
    // Each wait for a menu to open or close gives up after `timeout` ms, and
    // a failure closes the menu so it doesn't stay open for later steps.
    async clickTabMenuItem(url: string, label: string, timeout: number) {
      await evaluateIn(
        await chromeContext(),
        `(async () => {
          const url = ${JSON.stringify(url)}, label = ${JSON.stringify(label)};
          const tab = gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec === url);
          if (!tab) throw new Error("No tab shows " + url);
          const menu = document.getElementById("tabContextMenu");
          const event = (popup, type, what) => {
            let timer;
            return Promise.race([
              new Promise(r => popup.addEventListener(type, r, {once: true})),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(what)), ${timeout});
              }),
            ]).finally(() => clearTimeout(timer));
          };
          try {
            // The menu acts on the tab its trigger event targets, and on the
            // selected tab when there is none, so hand it an event that has
            // been dispatched on the tab.
            const trigger = new Event("e2e-tab-menu");
            tab.dispatchEvent(trigger);
            const opened = event(menu, "popupshown", "The tab menu didn't open");
            menu.openPopup(tab, "after_start", 0, 0, true, false, trigger);
            await opened;
            if (TabContextMenu.contextTab !== tab) {
              throw new Error("The tab menu opened for another tab than " + url);
            }
            const items = [...menu.querySelectorAll("menuitem")]
              .filter(m => !m.hidden && !m.disabled && m.hasAttribute("label"));
            const item = items.find(m => m.getAttribute("label") === label);
            if (!item) {
              throw new Error("No menu item " + JSON.stringify(label) + " in the tab's context menu, only "
                + JSON.stringify(items.map(m => m.getAttribute("label"))));
            }
            const popup = item.parentElement;
            if (popup !== menu) {
              const subOpened = event(popup, "popupshown", "The tab menu's submenu didn't open");
              popup.parentElement.openMenu(true);
              await subOpened;
            }
            const closed = event(menu, "popuphidden", "The tab menu didn't close");
            popup.activateItem(item);
            await closed;
          } finally {
            if (menu.state !== "closed") menu.hidePopup();
          }
        })()`,
      );
    },

    // Closes the sidebar, as its close button does.  Firefox opens an
    // add-on's sidebar when it is installed.
    async closeSidebar() {
      await evaluateIn(
        await chromeContext(),
        `(() => {
          SidebarController.hide();
          if (SidebarController.isOpen) throw new Error("The sidebar didn't close");
        })()`,
      );
    },

    // Restarts the extension's background by reloading the add-on, which
    // keeps the profile and so its storage and IndexedDB.  Firefox closes an
    // add-on's tabs when it unloads, and closing the only tab would close the
    // browser, so the test's tab leaves the extension first; the driver
    // reopens its page.  The reload goes through the add-on manager rather
    // than browser.runtime.reload(), which would need an extension page left
    // open to call it and returns before the add-on is back.
    async restartBackground() {
      await bidi("browsingContext.navigate", {
        context,
        url: "about:blank",
        wait: "complete",
      });
      openedUrl = "";
      await evaluateIn(
        await chromeContext(),
        `(async () => {
          const {AddonManager} = ChromeUtils.importESModule(
            "resource://gre/modules/AddonManager.sys.mjs");
          const addon = await AddonManager.getAddonByID(${JSON.stringify(ADDON_ID)});
          if (!addon) throw new Error(${JSON.stringify(`Add-on ${ADDON_ID} is not installed`)});
          await addon.reload();
          return true;
        })()`,
      );
    },

    close: () => browser.close(),
  };
}

module.exports = {launchAdapter};
