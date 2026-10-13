// The browser-neutral driver every suite uses (`h`).  Suites never talk to a
// browser's automation protocol: the few browser-specific primitives (open,
// eval, screenshot, errors) come from an adapter (firefox.cts), and
// everything else is built here on the page's own browser.* APIs, which are
// the same in every browser.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const TIMEOUT_MS = 30_000;
const STASH_ROOT = "Tab Stash";
const HIDDEN_MARKER = "hidden_by_tab_stash"; // src/model/tabs.ts

type Options = {sync?: object; local?: object};
type SeedFolder = {
  title: string;
  pages: Array<number | {title: string; url: string}>;
};
type Mask = string | [number, number, number, number];
const MASK_CLASS = "e2e-screenshot-mask";

// Serves /page/<n> as a tiny titled page, so tests have real, distinct tabs to
// stash without touching the network.
function startPageServer(): Promise<any> {
  const server = http.createServer((req: any, res: any) => {
    const m = /^\/page\/(\d+)$/.exec(req.url);
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
    res.end(`<!doctype html><title>Page ${m[1]}</title><h1>Page ${m[1]}</h1>`);
  });
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

class Driver {
  adapter: any;
  server: any;
  version: string;
  page = "stash-list.html";
  // Scratch space for a value one step records for a later one, e.g. a tab id
  // taken before an action.
  vars: Record<string, any> = {};
  messages: Record<string, {message: string}>;

  constructor(adapter: any, server: any, dist: string) {
    this.adapter = adapter;
    this.server = server;
    this.version = JSON.parse(
      fs.readFileSync(path.join(dist, "manifest.json"), "utf8"),
    ).version;
    this.messages = JSON.parse(
      fs.readFileSync(path.join(dist, "_locales/en/messages.json"), "utf8"),
    );
  }

  pageUrls(n: number): string[] {
    const {port} = this.server.address();
    return Array.from(
      {length: n},
      (_, i) => `http://127.0.0.1:${port}/page/${i + 1}`,
    );
  }

  pageUrl(n: number): string {
    return this.pageUrls(n)[n - 1];
  }

  async open(page: string): Promise<void> {
    this.page = page;
    await this.adapter.open(page);
  }

  eval(js: string): Promise<any> {
    return this.adapter.eval(js);
  }

  // Calls the async fn every 100 ms until it returns something truthy, and
  // returns that.
  async waitUntil<T>(
    fn: () => Promise<T>,
    what: string,
    timeout = TIMEOUT_MS,
  ): Promise<T> {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  waitFor(js: string, what = js, timeout = TIMEOUT_MS): Promise<any> {
    return this.waitUntil(() => this.eval(js), what, timeout);
  }

  // A synthetic click, which Tab Stash's @click.prevent.stop handlers accept.
  // Modifier keys: alt copies, ctrl opens in the background, shift flips the
  // tab-group choice.
  async click(
    selector: string,
    mods: {alt?: boolean; ctrl?: boolean; shift?: boolean} = {},
  ) {
    const sel = JSON.stringify(selector);
    await this.waitFor(
      `!!document.querySelector(${sel})`,
      `an element matching ${selector}`,
    );
    await this.eval(this.clickJs(`document.querySelector(${sel})`, mods));
  }

  // The JS that dispatches a synthetic click on the element `el` evaluates to.
  private clickJs(
    el: string,
    mods: {alt?: boolean; ctrl?: boolean; shift?: boolean},
  ) {
    return `${el}.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true,
      altKey: ${!!mods.alt}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift},
    }))`;
  }

  // Clicks `target` inside the row matching `rowSelector` whose .forest-title
  // text is `title`: first within the row itself (its toolbar and menu), then
  // within the children listed right after it.  CSS can't pick a row by its
  // text, and titles like "Page 1" appear in several lists at once.
  async clickInRow(
    rowSelector: string,
    title: string,
    target: string,
    mods: {alt?: boolean; ctrl?: boolean; shift?: boolean} = {},
  ) {
    const find = `(() => {
      const row = [...document.querySelectorAll(${JSON.stringify(rowSelector)})]
        .find(r => r.querySelector(".forest-title")?.textContent.trim() === ${JSON.stringify(title)});
      if (!row) return null;
      return row.querySelector(${JSON.stringify(target)})
        ?? row.nextElementSibling?.querySelector(${JSON.stringify(target)}) ?? null;
    })()`;
    await this.waitFor(`!!${find}`, `${target} in the row titled "${title}"`);
    await this.eval(this.clickJs(find, mods));
  }

  // clickInRow for a stash folder, found by its displayed title.
  clickInFolder(folder: string, target: string, mods = {}) {
    return this.clickInRow("div.forest-item.folder", folder, target, mods);
  }

  // Sets an input's value as typing would, and fires "input".
  async type(selector: string, text: string): Promise<void> {
    const sel = JSON.stringify(selector);
    await this.waitFor(
      `!!document.querySelector(${sel})`,
      `an input matching ${selector}`,
    );
    await this.eval(`(() => {
      const el = document.querySelector(${sel});
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event("input", {bubbles: true}));
    })()`);
  }

  // Presses a key on an element: keydown then keyup, as a real key press does.
  async press(selector: string, key: string): Promise<void> {
    const sel = JSON.stringify(selector);
    await this.waitFor(
      `!!document.querySelector(${sel})`,
      `an element matching ${selector}`,
    );
    await this.eval(`(() => {
      const el = document.querySelector(${sel});
      for (const type of ["keydown", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, {key: ${JSON.stringify(key)}, bubbles: true, cancelable: true}));
      }
    })()`);
  }

  // The English text of one of Tab Stash's messages, for selecting elements by
  // their title or label.  Placeholders like $1 are left as they are.
  message(key: string): string {
    const m = this.messages[key];
    if (!m) throw new Error(`No message "${key}"`);
    return m.message;
  }

  // Makes the test's own tab the active one again, e.g. after restoring tabs
  // activated others, so a screenshot shows a foreground page.
  async activate(): Promise<void> {
    await this.eval(
      `browser.tabs.getCurrent().then(t => browser.tabs.update(t.id, {active: true}))`,
    );
    await this.waitFor(
      `browser.tabs.getCurrent().then(t => t.active)`,
      "the test's tab to be active",
    );
  }

  // Opens local pages as background tabs in the page's window and waits for
  // them to load, so their titles are known.  A number n opens pages 1..n; a
  // list opens just those pages.
  async openPages(pages: number | number[]): Promise<void> {
    const nums =
      typeof pages === "number"
        ? Array.from({length: pages}, (_, i) => i + 1)
        : pages;
    const urls = nums.map(n => this.pageUrl(n));
    for (const url of urls) {
      await this.eval(
        `browser.tabs.create({url: ${JSON.stringify(url)}, active: false})`,
      );
    }
    const list = JSON.stringify(urls);
    await this.waitFor(
      `browser.tabs.query({currentWindow: true}).then(ts => ${list}.every(u =>
        ts.some(t => t.url === u && t.status === "complete")))`,
      `pages ${nums.join(", ")} to load`,
    );
  }

  // The stash's folders, top to bottom, as {title, urls}.  Reading can throw
  // ("node is null") while a folder is being created or changed, so retry for
  // a short time before giving up.
  async stash(): Promise<Array<{title: string; urls: string[]}>> {
    let lastError: unknown;
    try {
      return await this.waitUntil(
        async () => {
          try {
            return [await this.readStash()];
          } catch (e) {
            lastError = e;
            return undefined;
          }
        },
        "the stash to be readable",
        5000,
      ).then(r => r[0]);
    } catch (e) {
      throw new Error(`Could not read the stash: ${lastError ?? e}`);
    }
  }

  private readStash(): Promise<Array<{title: string; urls: string[]}>> {
    return this.eval(`(async () => {
      const [root] = (await browser.bookmarks.search({title: ${JSON.stringify(STASH_ROOT)}}))
        .filter(b => !b.url);
      if (!root) return [];
      const [tree] = await browser.bookmarks.getSubTree(root.id);
      return (tree.children ?? []).filter(c => !c.url).map(f => ({
        title: f.title,
        urls: (f.children ?? []).filter(c => c.url).map(c => c.url),
      }));
    })()`);
  }

  // Tabs in the page's window, in tab order.  `url` (a string or an array) is
  // matched exactly here rather than passed to browser.tabs.query, because
  // that treats it as a match pattern, and match patterns can't carry a port,
  // so the local test pages would match nothing.
  tabs(
    query: {url?: string | string[]; [key: string]: unknown} = {},
  ): Promise<
    Array<{id: number; url: string; hidden: boolean; active: boolean}>
  > {
    const {url, ...rest} = query;
    const urls = url === undefined ? null : [url].flat();
    return this
      .eval(`browser.tabs.query(${JSON.stringify({...rest, currentWindow: true})})
      .then(ts => ts
        .filter(t => ${JSON.stringify(urls)} === null || ${JSON.stringify(urls)}.includes(t.url))
        .map(t => ({id: t.id, url: t.url, hidden: !!t.hidden, active: t.active})))`);
  }

  // Whether Tab Stash marked this tab as hidden by itself (Firefox only: Chrome
  // has no session values).
  tabMarker(tabId: number): Promise<boolean> {
    return this
      .eval(`browser.sessions.getTabValue(${tabId}, ${JSON.stringify(HIDDEN_MARKER)})
      .then(v => v === true)`);
  }

  // Sets options and stash folders, then reloads the current page so it starts
  // from that state.  Options merge into the defaults set at launch.
  async seed(
    state: {options?: Options; stash?: SeedFolder[]} = {},
  ): Promise<void> {
    const urls = this.pageUrls(20);
    await this.eval(`(async () => {
      const opts = ${JSON.stringify(state.options ?? {})};
      for (const area of ["sync", "local"]) {
        if (!opts[area]) continue;
        const {options = {}} = await browser.storage[area].get("options");
        await browser.storage[area].set({options: {...options, ...opts[area]}});
      }
      const folders = ${JSON.stringify(state.stash ?? [])};
      if (folders.length === 0) return;
      let [root] = (await browser.bookmarks.search({title: ${JSON.stringify(STASH_ROOT)}}))
        .filter(b => !b.url);
      if (!root) root = await browser.bookmarks.create({title: ${JSON.stringify(STASH_ROOT)}});
      const urls = ${JSON.stringify(urls)};
      for (const f of folders) {
        const folder = await browser.bookmarks.create({parentId: root.id, title: f.title});
        for (const p of f.pages) {
          const b = typeof p === "number" ? {title: "Page " + p, url: urls[p - 1]} : p;
          await browser.bookmarks.create({parentId: folder.id, title: b.title, url: b.url});
        }
      }
    })()`);
    await this.open(this.page);
  }

  // The stash list renders a folder's children only once the folder has been
  // scrolled into view, so scroll each one in and wait for its children.
  async showAllFolders(): Promise<void> {
    await this.waitFor(
      `!!document.querySelector("main.stash-list")`,
      "the stash list",
    );
    await this.waitFor(
      `(() => {
        const folders = [...document.querySelectorAll("div.forest-item.folder")];
        for (const f of folders) f.scrollIntoView();
        return folders.every(f => f.nextElementSibling?.matches("ul.forest-children"));
      })()`,
      "every folder's children to render",
    );
    await this.eval(`window.scrollTo(0, 0)`);
  }

  // A PNG of the visible page, after a short settle so animations finish.
  // Masks black out parts that change from run to run, like the dates and
  // times Tab Stash shows, so the image still matches its golden byte for
  // byte.  The boxes are drawn in the page itself rather than painted onto the
  // image, so this works the same in every browser with no image library.
  async screenshot(opts: {mask?: Mask[]} = {}): Promise<Buffer> {
    await new Promise(r => setTimeout(r, 500));
    const masks = opts.mask ?? [];
    if (masks.length === 0) return this.adapter.screenshot();
    const cls = JSON.stringify(MASK_CLASS);
    try {
      const missing = await this.eval(`(() => {
        const rects = [];
        for (const m of ${JSON.stringify(masks)}) {
          if (Array.isArray(m)) {
            rects.push(m);
            continue;
          }
          const els = [...document.querySelectorAll(m)];
          if (els.length === 0) return m;
          for (const el of els) {
            const r = el.getBoundingClientRect();
            rects.push([r.x, r.y, r.width, r.height]);
          }
        }
        for (const [x, y, w, h] of rects) {
          // Round outwards, so anti-aliased edges of the text underneath
          // can't show past the box.
          const left = Math.floor(x), top = Math.floor(y);
          const box = document.createElement("div");
          box.className = ${cls};
          box.style.cssText = [
            "position: fixed",
            "left: " + left + "px",
            "top: " + top + "px",
            "width: " + (Math.ceil(x + w) - left) + "px",
            "height: " + (Math.ceil(y + h) - top) + "px",
            "background: #000",
            "z-index: 2147483647",
            "pointer-events: none",
          ].join(";");
          document.documentElement.appendChild(box);
        }
        return null;
      })()`);
      if (missing !== null)
        throw new Error(`Mask selector matched nothing: ${missing}`);
      return await this.adapter.screenshot();
    } finally {
      // A failed cleanup must not hide the error that got us here.
      try {
        await this.eval(
          `document.querySelectorAll("." + ${cls}).forEach(b => b.remove())`,
        );
      } catch {}
    }
  }

  // Restarts the extension's background (Firefox reloads the add-on), then
  // reopens the current page.  The page may not load while the extension is
  // still coming back, so each attempt reopens it and gives it a few seconds
  // to finish starting up; reopening sooner would cut its startup short.
  async restartBackground(): Promise<void> {
    await this.adapter.restartBackground();
    await this.waitUntil(async () => {
      try {
        await this.open(this.page);
        return await this.waitFor(
          `!!globalThis.the?.model`,
          "the page to start up",
          5000,
        );
      } catch {
        return false;
      }
    }, "the extension to come back after restarting its background");
  }

  // Errors from the browser's console plus those Tab Stash caught itself.
  async errors(): Promise<string[]> {
    const caught = await this.eval(
      `(globalThis.error_log ?? []).map(e => String(e.summary))`,
    );
    return [...(await this.adapter.errors()), ...caught];
  }

  async close(): Promise<void> {
    try {
      await this.adapter.close();
    } finally {
      this.server.close();
    }
  }
}

// Starts a browser with the build in `dist` installed, opens the stash list in
// its only tab, and sets options that keep tests deterministic: no
// restore-choice prompt, no close confirmation, no "what's new" notice.
async function launch(browser: string, {dist}: {dist: string}) {
  const server = await startPageServer();
  let adapter;
  try {
    const {launchAdapter} = require(`./${browser}.cts`);
    adapter = await launchAdapter({dist});
  } catch (e) {
    server.close();
    throw e;
  }
  // From here a failure must also close the browser and server, or they keep
  // node running.
  let h: any;
  try {
    h = new Driver(adapter, server, dist);
    await h.open("stash-list.html");
    // On a fresh install the background records last_notified_version by
    // rewriting the whole local options object from its own copy.  Seeding
    // before that lands would let it overwrite the options set here.  A timeout
    // here means the background didn't start (or no longer records its version
    // on a fresh start).
    await h.waitFor(
      `browser.storage.local.get("options")
        .then(o => o.options?.last_notified_version !== undefined)`,
      "the background to record its version",
    );
    await h.seed({
      options: {
        sync: {restore_folders_into: "target-window"},
        local: {
          confirm_close_open_tabs: false,
          last_notified_version: h.version,
        },
      },
    });
    return h;
  } catch (e) {
    try {
      await adapter.close();
    } finally {
      server.close();
    }
    throw e;
  }
}

module.exports = {launch};
