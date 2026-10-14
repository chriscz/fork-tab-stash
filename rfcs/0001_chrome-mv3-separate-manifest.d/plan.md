# Chrome MV3 Support via a Generated Manifest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [RFC 0001](../0001_chrome-mv3-separate-manifest.md). Section references such as "§2a" point into it.

**Goal:** Build Tab Stash for Chrome from a separate Manifest V3 manifest, keeping the Firefox MV2 build and its behaviour unchanged.

**Architecture:**

- **Shared background.** `src/index.ts` stays the single background entry point for both browsers.
- **Listeners at load time.** Waking listeners register synchronously through a small `deferredListener` helper, which queues events until the model has loaded.
- **IndexedDB stores.** The store services register before the first `await` and open their databases lazily.
- **Chrome-only paths.** Daily GC via an alarm, and MV3 menu contexts. These are gated so the Firefox MV2 build never runs them.
- **Chrome manifest.** The existing `patch-manifest-for-chrome.js` emits MV3, so the Chrome manifest stays generated from `assets/manifest.json`.

**Tech Stack:** TypeScript, Vue 3 reactivity, Vite (lib build for the background), mocha + chai + fake-indexeddb for tests, `idb`, `webextension-polyfill` 0.12, GNU make, Node 22 (via the `bin/dev` Docker wrapper).

## Global Constraints

- `assets/manifest.json` must not change. Verify with `git diff master -- assets/manifest.json`, which must print nothing.
- **Firefox behaviour must not change.** Handlers that open the sidebar or a popup must still call `show_something()` / `commands.*` before their first `await` when the model is loaded (`src/index.ts:159-161`).
- The Chrome manifest sets `"minimum_chrome_version": "148"`.
- No new npm dependencies.
- **How to run things.** Run every command through `bin/dev run <cmd>` from the repo root. The container has Node 22 and all build tools. Example: `bin/dev run make`.
- **Every commit:**
  - is a Conventional Commit with scope `rfc-0001`, for example `refactor(rfc-0001): ...`;
  - passes `bin/dev run make`, which type-checks, builds Firefox and Chrome, runs the tests and checks Prettier and i18n;
  - ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, as `AGENTS.md` requires.
- **Commit order.** Commits form a Gerrit-style stack in task order, and each must stand on its own.
- **Comments.** New code comments explain why. They don't reference the RFC: upstream readers won't have it, and the commit scope carries the link.
- **Deviations.** If a task cannot follow this plan without contradicting the RFC, the implementer stops and reports. The controller updates the RFC in its own `docs(rfc-0001): ...` commit before the code commit.
- **Prettier.** If `make` fails only on Prettier, run `bin/dev run make fix-style` and re-run `bin/dev run make`.

## File Structure

| File                                        | Change | Responsibility                                                             |
| ------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `src/datastore/kvs/service.ts`              | modify | IndexedDB-backed store service; now accepts a pending database             |
| `src/datastore/kvs/service.test.ts`         | modify | Tests for the above, including requests made before the DB opens           |
| `src/service-model.ts`                      | modify | Builds the background model; registers store services before any `await`   |
| `src/util/index.ts`                         | modify | Adds `deferredListener` next to the other event helpers (`asyncEvent`)     |
| `src/util/index.test.ts`                    | modify | Tests for `deferredListener`                                               |
| `src/index.ts`                              | modify | Background entry: load-time listeners, `action` alias, Chrome GC and menus |
| `patch-manifest-for-chrome.js`              | modify | Generates Chrome's MV3 manifest from `assets/manifest.json`                |
| `Makefile`                                  | modify | `build-chrome-dbg`, new `build-chrome-rel` and `pkg-chrome`                |
| `README.md`                                 | modify | Describe the Chrome build                                                  |
| `rfcs/0001_chrome-mv3-separate-manifest.md` | modify | Task 6 records validation results                                          |

## Commit stack

| Task | Commit subject                                                                 | RFC           |
| ---- | ------------------------------------------------------------------------------ | ------------- |
| 1    | `refactor(rfc-0001): register IndexedDB store services before the first await` | §2c, §2d      |
| 2    | `refactor(rfc-0001): register background listeners synchronously at load`      | §2a, §2e      |
| 3    | `feat(rfc-0001): generate a Manifest V3 manifest for Chrome`                   | §1            |
| 4    | `feat(rfc-0001): run Chrome's daily GC from an alarm`                          | §3c           |
| 5    | `feat(rfc-0001): create context menus with MV3 contexts on Chrome`             | §3a           |
| 6    | `docs(rfc-0001): record Chrome and Firefox validation results`                 | Phase 0, 1, 3 |

§3b (re-applying popup mode) needs no code. `src/index.ts` already calls `setupPopup()` every time it runs, and on Chrome it runs on every wake.

---

### Task 1: Register IndexedDB store services before the first await

**Files:**

- Modify: `src/datastore/kvs/service.ts` (static `open`, constructor, every `this._db` use)
- Modify: `src/datastore/kvs/service.test.ts`
- Modify: `src/service-model.ts:13-41`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `Service.open<K, V>(db_name: string, store_name: string): Service<K, V>` is now **synchronous**; it used to return a `Promise`.
  - `new Service<K, V>(db: IDBPDatabase | Promise<IDBPDatabase>, store_name: string)`.
  - `service_model()` calls `listen()` for all three stores before its first `await`.

- [ ] **Step 1: Write the failing test**

In `src/datastore/kvs/service.test.ts`, add `import type {IDBPDatabase} from "idb";` below the existing `import {openDB} from "idb";`. Then add this block inside `describe("datastore/kvs/service", ...)`, directly after the `describe("implements KeyValueStore", ...)` line:

```ts
it("serves requests made before the database finishes opening", async () => {
  NS.registry.reset_testonly();
  let opened!: (db: IDBPDatabase) => void;
  const svc = new Service<string, string>(
    new Promise<IDBPDatabase>(r => (opened = r)),
    "test",
  );

  const written = svc.set([{key: "early", value: "bird"}]);
  opened(
    await openDB("test-pending-open", 1, {
      upgrade(db) {
        db.createObjectStore("test");
      },
    }),
  );
  await written;
  await events.next(svc.onSet);

  expect(await svc.get(["early"])).to.deep.equal([
    {key: "early", value: "bird"},
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bin/dev run make check-tests`
Expected: FAIL. Either ts-node reports a type error, because the `Service` constructor does not accept a `Promise<IDBPDatabase>`, or the test fails with `this._db.transaction is not a function`.

- [ ] **Step 3: Make the service accept a pending database**

In `src/datastore/kvs/service.ts`, replace the whole `static open(...)` method (inside the `/* c8 ignore start */ ... /* c8 ignore stop */` block) with:

```ts
  static open<K extends Proto.Key, V extends Proto.Value>(
    db_name: string,
    store_name: string,
  ): Service<K, V> {
    // Opening is lazy so the caller can register the service (and accept
    // connections) before the database is ready.
    return new Service(openPersistentDB(db_name, store_name), store_name);
  }
```

Then add this function at the bottom of the file, outside the class:

```ts
/* c8 ignore start -- opens a live IndexedDB, usable only in prod */
async function openPersistentDB(
  db_name: string,
  store_name: string,
): Promise<IDBPDatabase> {
  // Magical incantation to make sure the browser doesn't spontaneously
  // delete our store.  persist() doesn't exist in service workers (Chrome
  // MV3), where the unlimitedStorage permission prevents eviction instead.
  //
  if (
    "persist" in navigator.storage &&
    !(await navigator.storage.persisted())
  ) {
    await navigator.storage.persist();
  }

  return await openDB(db_name, 1, {
    upgrade(db, oldVersion, newVersion, txn) {
      db.createObjectStore(store_name);
    },
  });
}
/* c8 ignore stop */
```

Change the field and the constructor:

```ts
  private _db: Promise<IDBPDatabase>;
```

```ts
  constructor(db: IDBPDatabase | Promise<IDBPDatabase>, store_name: string) {
    this.name = store_name;
    this.onSet = event("KVS.Service.onSet", this.name);
    this.onSyncLost = event("KVS.Service.onSyncLost", this.name);
    this._db = Promise.resolve(db);
  }
```

Then update every use of the database. There are exactly five, in `get`, `getStartingFrom`, `getEndingAt`, `set` and `deleteAll`. Each one currently reads:

```ts
const txn = this._db.transaction(
```

Change each one to:

```ts
const txn = (await this._db).transaction(
```

All five are already inside `async` functions. Leave the arguments as they are.

- [ ] **Step 4: Register the services before the first await**

In `src/service-model.ts`, replace everything from `const kvs = await resolveNamed({` through the three `listen(...)` lines with:

```ts
// Register the store services before the first await, so a page that
// connects to a freshly-started (Chrome MV3) service worker finds them
// listening.
const kvs = {
  deleted_items: KVSService.open<string, M.DeletedItems.SourceValue>(
    "deleted_items",
    "deleted_items",
  ),
  favicons: KVSService.open<string, M.Favicons.Favicon>("favicons", "favicons"),
  bookmark_metadata: KVSService.open<
    string,
    M.BookmarkMetadata.BookmarkMetadata
  >("bookmark-metadata", "bookmark-metadata"),
};
listen("deleted_items", kvs.deleted_items);
listen("favicons", kvs.favicons);
listen("bookmark-metadata", kvs.bookmark_metadata);

const sources = await resolveNamed({
  browser_settings: M.BrowserSettings.Model.live(),
  options: M.Options.Model.live(),
  tabs: M.Tabs.Model.from_browser("background"),
  containers: M.Containers.Model.from_browser(),
  bookmarks: M.Bookmarks.Model.from_browser(),
  deleted_items: new M.DeletedItems.Model(kvs.deleted_items),
});
```

The rest of the function, from `const model = new M.Model({` onward, stays unchanged.

- [ ] **Step 5: Run the full build and tests**

Run: `bin/dev run make`
Expected: exit 0, with the new test passing and the existing count plus one (622 passing).

- [ ] **Step 6: Commit**

```bash
git add src/datastore/kvs/service.ts src/datastore/kvs/service.test.ts src/service-model.ts
git commit -F - <<'EOF'
refactor(rfc-0001): register IndexedDB store services before the first await

KVSService.open() now returns immediately and opens its database in the
background; every store method waits for it. service_model() registers
the three store services before its first await, so they listen as soon
as the background script starts. persist() is only called where it
exists, since service workers lack it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Register background listeners synchronously at load

**Files:**

- Modify: `src/util/index.ts` (add `deferredListener` directly after `asyncEvent`, around line 166)
- Modify: `src/util/index.test.ts` (new `describe` inside `describe("util", ...)`)
- Modify: `src/index.ts` (imports, new top-level block before line 20, `show_popup`, the `contextMenus`/`browserAction`/`pageAction` listeners, `setTitle`)

**Interfaces:**

- Consumes: Task 1, through `service_model()`, whose services now register synchronously.
- Produces:
  - `export function deferredListener<L extends (...args: any[]) => any>(event: {addListener(l: L): void}): {handle(l: L): void}` in `src/util/index.ts`.
  - Top-level constants in `src/index.ts`: `action`, `onMenuClicked`, `onActionClicked` (possibly `undefined`) and `onPageActionClicked` (possibly `undefined`). Tasks 4 and 5 add more constants next to these.

- [ ] **Step 1: Write the failing tests**

Add this block at the end of `describe("util", function () { ... })` in `src/util/index.test.ts`, just before the final `});`:

```ts
describe("deferredListener()", () => {
  function fakeEvent<A extends any[]>() {
    const listeners: ((...a: A) => void)[] = [];
    return {
      addListener(l: (...a: A) => void) {
        listeners.push(l);
      },
      send(...a: A) {
        for (const l of listeners) l(...a);
      },
    };
  }

  it("replays events sent before a handler was attached, in order", () => {
    const ev = fakeEvent<[number]>();
    const d = M.deferredListener(ev);
    ev.send(1);
    ev.send(2);

    const seen: number[] = [];
    d.handle(n => seen.push(n));
    expect(seen).to.deep.equal([1, 2]);
  });

  it("delivers later events synchronously, after replaying early ones once", () => {
    const ev = fakeEvent<[number]>();
    const d = M.deferredListener(ev);
    ev.send(1);
    const seen: number[] = [];
    d.handle(n => seen.push(n));

    ev.send(2);
    // No await in between: Firefox only allows opening the sidebar from
    // a handler that runs in the same turn as the user's click.
    expect(seen).to.deep.equal([1, 2]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bin/dev run make check-tests`
Expected: FAIL. ts-node reports `Property 'deferredListener' does not exist`, or the tests fail with `M.deferredListener is not a function`.

- [ ] **Step 3: Implement `deferredListener`**

In `src/util/index.ts`, directly after the closing `}` of `asyncEvent`, add:

```ts
/** Adds a listener to `event` right away, but delivers events to a handler
 * attached later with `handle()`.  Events that arrive before then are queued
 * and replayed in order; after that, events reach the handler synchronously.
 *
 * A Chrome (MV3) service worker only receives the event that woke it if the
 * listener was added during the worker's first turn. */
export function deferredListener<L extends (...args: any[]) => any>(event: {
  addListener(l: L): void;
}): {handle(l: L): void} {
  let handler: L | undefined;
  const queued: Parameters<L>[] = [];

  event.addListener(((...args: Parameters<L>) => {
    if (handler) handler(...args);
    else queued.push(args);
  }) as L);

  return {
    handle(l: L) {
      handler = l;
      for (const args of queued.splice(0)) l(...args);
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bin/dev run make check-tests`
Expected: PASS (624 passing).

- [ ] **Step 5: Register the background's listeners at load time**

All edits are in `src/index.ts`.

5a. Add `deferredListener` to the existing import from `"./util/index.js"`, keeping the list alphabetical as Prettier's organize-imports plugin requires:

```ts
import {
  asyncEvent,
  backingOff,
  deferredListener,
  filterMap,
  nonReentrant,
  urlToOpen,
  $t,
} from "./util/index.js";
```

5b. Insert this block between the last import and the line `logErrorsFrom(async () => {`:

```ts
// The toolbar button's API is `action` under MV3 (Chrome) and `browserAction`
// under MV2 (Firefox).
const action = browser.action ?? browser.browserAction;

// A Chrome (MV3) service worker only receives the event that woke it if the
// listener was added synchronously at load.  Add them here; the handlers are
// attached below once the model has loaded.
const onMenuClicked = deferredListener(browser.contextMenus.onClicked);
const onActionClicked = action ? deferredListener(action.onClicked) : undefined;
const onPageActionClicked = browser.pageAction
  ? deferredListener(browser.pageAction.onClicked)
  : undefined;
```

5c. In `commands.show_popup` (around lines 177-184), replace the three `browser.browserAction.` prefixes with `action.`:

```ts
try {
  await action.setPopup({
    popup: "stash-list.html?view=popup",
  });
  await action.openPopup();
} finally {
  await action.setPopup({popup: ""});
}
```

5d. Replace the context-menu registration line:

```ts
  browser.contextMenus.onClicked.addListener((info, tab) => {
```

with:

```ts
  onMenuClicked.handle((info, tab) => {
```

The handler body stays unchanged.

5e. In the toolbar-button block (around line 322), make these replacements:

- `if (browser.browserAction) {` becomes `if (onActionClicked) {`.
- Inside `setupPopup()`, both `await browser.browserAction.setPopup({` lines become `await action.setPopup({`.
- `browser.browserAction.onClicked.addListener(` becomes `onActionClicked.handle(`.

The `asyncEvent(async tab => { ... })` argument stays unchanged.

5f. In the page-action block, change:

```ts
  if (browser.pageAction) {
    browser.pageAction.onClicked.addListener(
```

to:

```ts
  if (onPageActionClicked) {
    onPageActionClicked.handle(
```

5g. In the options listener that sets the title (around line 413), change:

```ts
      if (browser.browserAction) {
        await browser.browserAction.setTitle({
```

to:

```ts
      if (action) {
        await action.setTitle({
```

5h. Confirm nothing was missed:

Run: `grep -n "browser.browserAction\|contextMenus.onClicked.addListener\|pageAction.onClicked.addListener" src/index.ts`
Expected: exactly one hit, the alias line `const action = browser.action ?? browser.browserAction;`.

- [ ] **Step 6: Run the full build and tests**

Run: `bin/dev run make`
Expected: exit 0 (624 passing), and `git diff master -- assets/manifest.json` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/util/index.ts src/util/index.test.ts src/index.ts
git commit -F - <<'EOF'
refactor(rfc-0001): register background listeners synchronously at load

Add deferredListener(), which adds a listener immediately, queues
events until a handler is attached, then delivers them synchronously.
The background now adds its context-menu, toolbar-button and
page-action listeners at load, so a Chrome service worker receives the
event that woke it. Handlers still run in the same turn as the user's
click once the model is loaded, which Firefox requires to open the
sidebar. The toolbar button goes through an action/browserAction alias.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Generate a Manifest V3 manifest for Chrome

**Files:**

- Modify: `patch-manifest-for-chrome.js` (whole file, 26 lines)
- Modify: `Makefile` (variables near line 20; `build-chrome-dbg` at lines 137-143; new targets)
- Modify: `README.md:58`

**Interfaces:**

- Consumes: Tasks 1–2, so the background works as a service worker.
- Produces:
  - `make build-chrome-dbg` and `make build-chrome-rel` write an MV3 `dist-chrome/` whose manifest is generated from `assets/manifest.json`;
  - `make pkg-chrome` writes `releases/tab-stash-chrome-<version>.zip`.

The maintainer asked for the Chrome manifest to stay generated from `assets/manifest.json` by this script (PR #711, see `CLAUDE.md`). Do not add a second manifest file.

- [ ] **Step 1: Rewrite `patch-manifest-for-chrome.js`**

Replace the whole file with:

```js
// Generates Chrome's Manifest V3 manifest from the Firefox (MV2) one, so that
// changes to assets/manifest.json carry over to Chrome automatically.  Missing
// keys make this throw, which fails the build.

import manifest from "./assets/manifest.json" with {type: "json"};

manifest.manifest_version = 3;
// Chrome 148 exposes extension APIs natively as browser.*.
manifest.minimum_chrome_version = "148";
delete manifest.browser_specific_settings;

const permsToDrop = [
  "tabHide",
  "browserSettings",
  "contextualIdentities",
  "cookies",
];
manifest.permissions = manifest.permissions
  .filter(p => !permsToDrop.includes(p))
  .concat(["alarms"]);

const scripts = manifest.background.scripts;
if (scripts.length !== 1) {
  throw new Error(`expected exactly one background script`);
}
manifest.background = {service_worker: scripts[0]};

manifest.action = manifest.browser_action;
delete manifest.browser_action;
delete manifest.action.theme_icons;
delete manifest.action.browser_style;
if (!manifest.action.default_icon) {
  throw new Error(`browser_action.default_icon key not found`);
}
// Chrome doesn't support SVG icons; the build makes these PNGs.
for (const k in manifest.action.default_icon) {
  manifest.action.default_icon[k] = `icons/logo-${k}.png`;
}

delete manifest.page_action;
delete manifest.sidebar_action;

delete manifest.options_ui.browser_style;
manifest.options_ui.open_in_tab = true;

// Wrapping an undefined policy would not throw, so check it explicitly.
if (typeof manifest.content_security_policy !== "string") {
  throw new Error(`content_security_policy key missing`);
}
manifest.content_security_policy = {
  extension_pages: manifest.content_security_policy,
};

const commands = manifest.commands;
commands._execute_action = commands._execute_browser_action;
commands._execute_action.suggested_key.default = "Alt+Shift+T";
delete commands._execute_browser_action;
delete commands._execute_sidebar_action;
delete commands._execute_page_action;

console.log(JSON.stringify(manifest, undefined, 2));
```

- [ ] **Step 2: Check the generated manifest**

Run:

```bash
bin/dev run sh -c 'node patch-manifest-for-chrome.js > /tmp/after.json && node -e "
const m = JSON.parse(require(\"fs\").readFileSync(\"/tmp/after.json\"));
const v = JSON.parse(require(\"fs\").readFileSync(\"assets/manifest.json\")).version;
console.log(m.manifest_version, m.version === v, m.background.service_worker,
  JSON.stringify(m.action.default_icon), m.permissions.join(\",\"),
  Object.keys(m.commands).join(\",\"), typeof m.content_security_policy,
  [\"browser_action\",\"page_action\",\"sidebar_action\",\"browser_specific_settings\"].filter(k => k in m).length)
"'
```

Expected (one line):

```
3 true index.js {"16":"icons/logo-16.png","32":"icons/logo-32.png","64":"icons/logo-64.png"} sessions,tabs,tabGroups,bookmarks,contextMenus,storage,unlimitedStorage,alarms _execute_action object 0
```

- [ ] **Step 3: Update the Makefile**

3a. Below the line `DIST_PKG = $(RELEASE_DIR)/$(PACKAGE)-$(FULL_VERSION).zip` (line 20), add:

```make
CHROME_PKG = $(RELEASE_DIR)/$(PACKAGE)-chrome-$(FULL_VERSION).zip
```

3b. Leave the existing `build-chrome-dbg` rule as it is. Directly after its `.PHONY: build-chrome-dbg` line, add:

```make

build-chrome-rel: build-rel
	rsync -aHvx --delete --force dist/ dist-chrome/
	node ./patch-manifest-for-chrome.js >dist-chrome/manifest.json || (\
		rm -f dist-chrome/manifest.json; \
		exit 1 \
	)
.PHONY: build-chrome-rel
```

3c. Directly after the `pkg-webext` rule's `.PHONY: pkg-webext` line, add:

```make

pkg-chrome: clean-working-tree build-chrome-rel
	mkdir -p $(RELEASE_DIR)
	cd dist-chrome && zip -9rvo ../$(CHROME_PKG) `find . -type f`
.PHONY: pkg-chrome
```

Recipe lines must start with a tab character, as in the rest of the Makefile.

3d. In the `distclean` recipe, add `$(CHROME_PKG)` directly after `$(DIST_PKG)`, so `make distclean` also removes the Chrome zip.

- [ ] **Step 4: Update the README**

In `README.md`, replace line 58, keeping its 3-space indent (it is a sub-item of step 4):

```markdown
- `dist-chrome`: A highly-experimental port to Chrome (also unpacked)
```

with:

```markdown
- `dist-chrome`: A highly-experimental Manifest V3 port to Chrome 148 or
  newer (also unpacked). `make pkg-chrome` packs a release build of it.
```

- [ ] **Step 5: Run the full build**

Run: `bin/dev run make`, then `git diff master -- assets/manifest.json`.
Expected: `make` exits 0 (624 passing), `dist-chrome/manifest.json` contains `"manifest_version": 3`, and the diff prints nothing.

- [ ] **Step 6: Commit**

```bash
git add patch-manifest-for-chrome.js Makefile README.md
git commit -F - <<'EOF'
feat(rfc-0001): generate a Manifest V3 manifest for Chrome

Current Chrome refuses MV2 extensions. patch-manifest-for-chrome.js now
turns the Firefox manifest into an MV3 one: a service-worker background,
action instead of browser_action, an object CSP, _execute_action, PNG
toolbar icons (the SVG paths it emitted never existed), and alarms in
place of the Firefox-only permissions. The Chrome manifest stays
generated from assets/manifest.json. Add build-chrome-rel and
pkg-chrome targets.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Run Chrome's daily GC from an alarm

**Files:**

- Modify: `src/index.ts` (top-level block from Task 2; the hidden-tab GC block at about line 440; just before the GC block at the end of the file)

**Interfaces:**

- Consumes: `deferredListener` and the top-level block from Task 2.
- Produces: top-level `onAlarm`, `undefined` unless `browser.alarms` exists (Chrome only).

- [ ] **Step 1: Add the alarm listener at load**

Append to the top-level block added in Task 2, after `onPageActionClicked`:

```ts
// Chrome (MV3) only: the service worker restarts too often for timers, so
// daily GC runs from an alarm.  Firefox's manifest doesn't request "alarms",
// so this is undefined there.
const onAlarm = browser.alarms
  ? deferredListener(browser.alarms.onAlarm)
  : undefined;
```

- [ ] **Step 2: Skip the hidden-tab cleanup where tabs can't be hidden**

In the block that starts `logErrorsFrom(async () => {` followed by `let managed_urls = await model.bookmarks.urlsInStash();` (about line 440), insert a first line so it reads:

```ts
  logErrorsFrom(async () => {
    // Nothing to close where tabs can't be hidden, so skip walking the stash.
    if (!browser.tabs.hide) return;
    let managed_urls = await model.bookmarks.urlsInStash();
```

Leave the auto-discard `setTimeout` alone. On Chrome its timer dies with the worker, and it finds no hidden tabs anyway.

- [ ] **Step 3: Use an alarm for GC on Chrome**

Directly before the line `const gc = nonReentrant(() =>` near the end of the file, insert:

```ts
if (onAlarm) {
  onAlarm.handle(() => model.attempt(() => model.gc()));
  // create() replaces an existing alarm and restarts its period, and this
  // code runs on every wake, so only create it when it's missing.  The
  // first GC comes a minute later, e.g. after a fresh install.
  if (!(await browser.alarms.get("gc"))) {
    await browser.alarms.create("gc", {
      delayInMinutes: 1,
      periodInMinutes: 24 * 60,
    });
  }
  return;
}
```

Leave the existing GC code below it unchanged. Firefox runs it as before; Chrome returns before reaching it.

- [ ] **Step 4: Run the full build and tests**

Run: `bin/dev run make`
Expected: exit 0 (624 passing).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -F - <<'EOF'
feat(rfc-0001): run Chrome's daily GC from an alarm

A Chrome service worker restarts often, so a setTimeout loop would not
survive and the startup gc() would run on every wake. Where
browser.alarms exists (Chrome), GC runs from a daily alarm, created
only if missing so wakes don't reset it. The hidden-tab cleanup, which
walks the whole stash, is skipped where tabs can't be hidden. Firefox's
GC code is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Create context menus with MV3 contexts on Chrome

**Files:**

- Modify: `src/index.ts` (top-level block; `menu()` at about lines 66-101; just before the first `menu(` call at about line 112)

**Interfaces:**

- Consumes: the top-level block from Task 2.
- Produces: the top-level constant `MV3: boolean`.

- [ ] **Step 1: Add the MV3 flag**

In the top-level block from Task 2, directly after the `const action = ...` line, add:

```ts
// Firefox only exposes browser.action under MV3, and MV3 renames the toolbar
// button's menu context to "action".
const MV3 = !!browser.action;
```

- [ ] **Step 2: Map the toolbar context, and create the page-action menu only where page actions exist**

2a. In `function menu(idprefix, contexts, def)`, insert this as the first statement of the body, before the `// Only create menus in contexts this browser understands.` comment:

```ts
if (MV3) {
  contexts = contexts.map(c => (c === "browser_action" ? "action" : c));
}
```

2b. Wrap the third `menu(` call, the one with prefix `"3:"` and context `["page_action"]`, in a check, as the code already does for `browser.sidebarAction`:

```ts
if (browser.pageAction) {
  menu("3:", ["page_action"], [/* existing items, unchanged */]);
}
```

Keep the existing items exactly as they are; only the `if` and the indentation change.

- [ ] **Step 3: Re-create menus cleanly on every wake**

Directly before the first `menu(` call (the one with prefix `"1:"`), add:

```ts
// Chrome may keep menus across service-worker restarts, and creating an
// existing ID fails, so start from a clean slate.
if (MV3) await browser.contextMenus.removeAll();
```

- [ ] **Step 4: Run the full build and tests**

Run: `bin/dev run make`
Expected: exit 0 (624 passing).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -F - <<'EOF'
feat(rfc-0001): create context menus with MV3 contexts on Chrome

Under MV3 the toolbar button's menu context is "action", so map
browser_action to action before filtering by the browser's ContextType.
Create the page-action menu only where page actions exist, as the code
already does for the sidebar. Clear existing menus first under MV3,
since Chrome may keep them across service-worker restarts and rejects
duplicate IDs. Firefox's MV2 build is unaffected.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Validate in Firefox and Chrome, and record the results (human checkpoint)

A subagent cannot run this task: it needs real browsers on the user's machine. The controller hands both checklists to the user and records the results.

**Files:**

- Modify: `rfcs/0001_chrome-mv3-separate-manifest.md` (Open questions 3, 4, 7, 8, 9; a new "Validation results" subsection at the end of Rollout)

- [ ] **Step 1: Build both browsers' output**

Run: `bin/dev run make`
Expected: exit 0. `dist/` holds the Firefox build and `dist-chrome/` the Chrome build.

- [ ] **Step 2: Firefox checklist (RFC Phase 1)**

Load `dist/manifest.json` via `about:debugging` → This Firefox → **Load Temporary Add-on**. Then check:

- [ ] In the extension's console (`about:debugging` → Inspect), `browser.action` and `browser.alarms` both print `undefined`.
- [ ] The toolbar button opens the sidebar. Set "Toolbar button" to show the sidebar in options if needed.
- [ ] The tab context menu item "Show stashed tabs in sidebar" opens the sidebar.
- [ ] With the toolbar button set to popup mode, clicking it shows the popup.
- [ ] In a fresh profile, the first toolbar click shows the setup page.
- [ ] Stash a window, a single tab and a link from the context menu.
- [ ] Restore a stashed tab.
- [ ] Delete a stashed bookmark, then undelete it from Deleted Items.
- [ ] After restarting Firefox, Deleted Items still lists earlier deletions.
- [ ] Hidden tabs are discarded after the configured auto-discard interval. Set it low in options to test.

- [ ] **Step 3: Chrome checklist (RFC Phases 0 and 3)**

Load `dist-chrome/` via `chrome://extensions` → Developer mode → **Load unpacked**. Then check:

- [ ] No errors on `chrome://extensions`, and the toolbar icon renders.
- [ ] Every RFC Goal 1 item works from a cold start: stash all, stash the current tab, stash pinned tabs, copy to stash, restore, the stash list in a tab and in popup mode, deleted items and undelete.
- [ ] Every context menu item works, including the toolbar right-click menu.
- [ ] Stop the worker (`chrome://extensions` → "service worker" → DevTools → Application → Service workers → **Stop**). Then each of these works on the first try: the toolbar button in normal and popup mode, every context menu item, opening the stash list, and opening Deleted Items.
- [ ] After a forced stop, before clicking anything, check whether the context menus and the popup setting are still there (Open question 8).
- [ ] Stop the worker with the stash list open, then delete a bookmark. Deleted Items shows it.
- [ ] In the service worker console, `await chrome.alarms.get("gc")` returns an alarm. Its `scheduledTime` is unchanged after a stop and wake.
- [ ] **Measure for the RFC:**
  - Does an idle open stash list keep the worker alive past 30 s (Open question 3)? Watch the "service worker (inactive)" label.
  - What is the cold wake-to-action latency with about 500 tabs and 2,000 stashed bookmarks (Open question 4)? Time a context-menu stash after a forced stop.
  - Does the toolbar right-click menu appear (Open question 7)?
  - Does "show popup" from a context menu work after a forced stop (Open question 9)?

- [ ] **Step 4: Fix failures in the commit that caused them**

For any failure, fix it on top as a `fixup!` commit that targets the responsible task's commit:

```bash
git commit --fixup=<sha>
```

Ask the user before rewriting history with `git rebase --autosquash`.

If the fix contradicts the RFC, update the RFC first in a `docs(rfc-0001): ...` commit.

- [ ] **Step 5: Record the results in the RFC**

In `rfcs/0001_chrome-mv3-separate-manifest.md`:

- Add a `### Validation results` subsection at the end of `## Rollout`, listing each checklist item with pass or fail and the measured values.
- Mark Open questions 3, 4, 7, 8 and 9 as resolved, with the answers.

Then run `bin/dev run make check-style` and fix any Prettier issues with `bin/dev run make fix-style`.

- [ ] **Step 6: Commit**

```bash
git add rfcs/0001_chrome-mv3-separate-manifest.md
git commit -F - <<'EOF'
docs(rfc-0001): record Chrome and Firefox validation results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

The RFC stays `draft` until the maintainer approves it and the stack lands upstream (see `CLAUDE.md`, RFC process step 6).
