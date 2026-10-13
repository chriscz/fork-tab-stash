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
type SeedFolder = {title: string; pages: number[]};

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

// Pins the page's current date (no-argument `new Date()`) at `iso`, so the
// names Tab Stash generates from it, like new folders' names, render the same
// on every run.  Date.now() keeps running, because Tab Stash times its own
// waits with it (e.g. src/model/bookmarks.ts:616) and they never end on a
// frozen clock.  It covers the page only: bookmarks' dateAdded still comes from
// the browser's real clock.  It is installed after the page has loaded, so
// dates computed during the page's first render use the real clock.
const clockJs = (iso: string) => `(() => {
  if (globalThis.__e2eClock) return;
  const T = Date.parse(${JSON.stringify(iso)});
  const Real = Date;
  class FrozenDate extends Real {
    constructor(...a) { if (a.length === 0) super(T); else super(...a); }
  }
  globalThis.Date = FrozenDate;
  globalThis.__e2eClock = true;
})()`;

class Driver {
  adapter: any;
  server: any;
  clock?: string;
  version: string;
  page = "stash-list.html";

  constructor(adapter: any, server: any, dist: string, clock?: string) {
    this.adapter = adapter;
    this.server = server;
    this.clock = clock;
    this.version = JSON.parse(
      fs.readFileSync(path.join(dist, "manifest.json"), "utf8"),
    ).version;
  }

  pageUrls(n: number): string[] {
    const {port} = this.server.address();
    return Array.from(
      {length: n},
      (_, i) => `http://127.0.0.1:${port}/page/${i + 1}`,
    );
  }

  async open(page: string): Promise<void> {
    this.page = page;
    await this.adapter.open(page);
    if (this.clock) await this.adapter.eval(clockJs(this.clock));
  }

  eval(js: string): Promise<any> {
    return this.adapter.eval(js);
  }

  async waitFor(js: string, what = js, timeout = TIMEOUT_MS): Promise<any> {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await this.eval(js);
      if (value) return value;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await new Promise(r => setTimeout(r, 100));
    }
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
    await this
      .eval(`document.querySelector(${sel}).dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true,
      altKey: ${!!mods.alt}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift},
    }))`);
  }

  // Opens n local pages as background tabs in the page's window and waits for
  // them to load, so their titles are known.
  async openPages(n: number): Promise<void> {
    const urls = this.pageUrls(n);
    for (const url of urls) {
      await this.eval(
        `browser.tabs.create({url: ${JSON.stringify(url)}, active: false})`,
      );
    }
    const list = JSON.stringify(urls);
    await this.waitFor(
      `browser.tabs.query({currentWindow: true}).then(ts => ${list}.every(u =>
        ts.some(t => t.url === u && t.status === "complete")))`,
      `${n} pages to load`,
    );
  }

  // The stash's folders, top to bottom, as {title, urls}.
  stash(): Promise<Array<{title: string; urls: string[]}>> {
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

  // Tabs in the page's window, in tab order.
  tabs(
    query: object = {},
  ): Promise<
    Array<{id: number; url: string; hidden: boolean; active: boolean}>
  > {
    return this
      .eval(`browser.tabs.query(${JSON.stringify({...query, currentWindow: true})})
      .then(ts => ts.map(t => ({id: t.id, url: t.url, hidden: !!t.hidden, active: t.active})))`);
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
        for (const n of f.pages) {
          await browser.bookmarks.create({parentId: folder.id, title: "Page " + n, url: urls[n - 1]});
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
  async screenshot(): Promise<Buffer> {
    await new Promise(r => setTimeout(r, 500));
    return this.adapter.screenshot();
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
async function launch(
  browser: string,
  {dist, clock}: {dist: string; clock?: string},
) {
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
    h = new Driver(adapter, server, dist, clock);
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
