// Firefox adapter for the end-to-end driver.  Firefox's WebDriver BiDi ignores
// extension pages (Mozilla bug 1755014): it sends no load, console or error
// events for them and runs no preload scripts there, so Puppeteer's page API
// doesn't work.  This adapter navigates and evaluates with raw BiDi commands,
// snapshots tabs from the chrome (browser UI) context because BiDi refuses to
// screenshot privileged pages, and reads errors from Firefox's console
// service.  --remote-allow-system-access is what allows the last two and
// navigation to moz-extension:// URLs.

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
      await bidi("browsingContext.navigate", {
        context,
        url: BASE_URL + page,
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
          const b = gBrowser.browsers.find(b => b.currentURI.spec.startsWith(${JSON.stringify(BASE_URL)}));
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

    close: () => browser.close(),
  };
}

module.exports = {launchAdapter};
