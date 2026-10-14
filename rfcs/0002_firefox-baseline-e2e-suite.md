# RFC 0002: A Firefox-baseline end-to-end test suite

- Status: draft
- Author(s): Chris Coetzee, Claude
- Date: 2026-10-13
- Links: [RFC 0001](0001_chrome-mv3-separate-manifest.md) (which runs this suite on Chrome); maintainer views in [maintainer-views.md](0001_chrome-mv3-separate-manifest.d/maintainer-views.md)

## Problem

Nothing tests Tab Stash's user-visible behaviour in a real browser, so we can't tell whether our changes regress Firefox, and we have no baseline to judge the Chrome build from RFC 0001 against. The 625 unit tests run against a mock browser (`src/mock/browser/`). The two end-to-end tests we have only check that each build starts.

## Background

**What we have.** Commit `5e98fbe` added Puppeteer 25.13.0, Chrome for Testing 155 and Firefox 157 to the dev Docker image (`install-test-deps.sh`), plus two smoke tests run by `make check-e2e`:

- `e2e/firefox.test.cjs` installs `dist/` as a temporary add-on and checks that the stash list renders with no errors.
- `e2e/chrome.test.cjs` stops the Chrome service worker and checks that the daily GC alarm survives.

On its first run the Chrome test found a real bug: Chrome rejected the dotted plural message keys, so the Chrome build hadn't loaded since September (fixed in `be0e7fc`).

**How Firefox can be driven.** Firefox's WebDriver BiDi ignores extension pages (Mozilla bug 1755014), so Puppeteer's page API doesn't work there:

- `page.goto()` never resolves, and `pageerror`, `console` events and preload scripts don't fire.
- What works, launched with `--remote-allow-system-access`:
  - raw `browsingContext.navigate` to the page's `moz-extension://` URL, which the test pins with the `extensions.webextensions.uuids` pref;
  - `script.evaluate` inside the page, which can query the DOM, dispatch events and call the page's own `browser.*` APIs;
  - reading Firefox's console service from a chrome context, to collect errors;
  - snapshotting a tab with Firefox's own `drawSnapshot` from the chrome context. BiDi's `captureScreenshot` refuses extension pages ("does not support browsing contexts in privileged scope"). We verified `drawSnapshot` against the stash list.
- What doesn't work:
  - clicking the toolbar button, context menus or the sidebar;
  - real user gestures;
  - Puppeteer's `triggerExtensionAction()`, which is CDP-only.

Chrome needs none of these workarounds: Puppeteer's `page.goto`, `page.evaluate`, `page.screenshot` and `pageerror` work on its extension pages over CDP. Its background is a service worker, which reports errors only on its own CDP session (`Runtime.exceptionThrown`).

**What the pages offer a test.** The code already exposes what we need:

- **Globals.** Every UI page sets `globalThis.the` (with `the.model`), `globalThis.app` and `globalThis.error_log` (`src/globals-ui.ts:40`, `src/launch-vue.ts:61`, `src/util/oops.ts:14`).
- **Synthetic clicks.** Action links use `@click.prevent.stop`, so a synthetic `el.click()` triggers them. `MouseEvent` modifier keys work too: Alt copies, Ctrl opens in the background, and Shift flips the tab-group choice.
- **URL parameters.** The stash list reads `?q=`, `?view=popup|sidebar|tab`, and `?action=import|export`.
- **Options ids.** On the options page, selects, text inputs and checkboxes use the storage key as their `id`. Radios use `<key>_<value>`, e.g. `#after_stashing_tab_close` (`src/options/index.vue`).

**Baseline against `master`.** We checked that this works in practice:

- **Build:** upstream `master` at `622bf3d` builds unmodified in our dev image, from a fresh clone.
- **Smoke test:** the existing Firefox test passes against that build.
- **Usage:** the suite can therefore be run first against that commit, to establish the baseline, and then against our branch.

**Upstream bugs found while surveying.** None of these may be encoded as expected behaviour; both are tracked in [`TASKS.md`](../TASKS.md):

- **Popup fall-through.** `show_something`'s `"popup"` case has no `break`, so showing the popup also opens the sidebar.
- **Options watchers.** The coupling watchers in `src/options/index.vue:528` watch top-level keys that don't exist, so they never fire. They are also redundant: the options that would trigger them are disabled.

## Goals

1. **A suite of end-to-end tests for core functionality.** It covers what a user can do from Tab Stash's own pages: stash, restore, delete and undelete, rename, search, options, and data surviving a background reload.
2. **Readable specs.** Every test has a plain-English `spec.yml` (Given / When / Then, plus notes). A person or an AI agent can implement, review and regenerate a test from it without reading code.
3. **A real baseline.** Every test passes against an unmodified upstream build (`622bf3d`) in Firefox before it's used to judge anything else. Its golden screenshots come from that build.
4. **Assertions on user-visible state.** Tests assert on what a user can see (the bookmark tree, open and hidden tabs, what the page shows), not on model internals. This follows Chrome's testing guidance ([end-to-end testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)).
5. **Browser-neutral tests.** Suites never touch a browser's automation protocol directly, so the same specs and suites can run on Chrome later by adding an adapter, not by rewriting tests.
6. **Runs where everything else does, fast and reliably.** It runs in the dev Docker image with one command (`bin/e2e test --browser=firefox`). Test time, excluding builds, is under five minutes. The whole suite passes three consecutive runs.

## Non-goals

- **Running the suite on Chrome.** That belongs to RFC 0001, which built the Chrome adapter and ran every spec's `browser: chrome` steps; its "Phase 3 parity results" record the outcome.
- **Things a page can't drive:** the toolbar button, context menus, keyboard shortcuts, the real sidebar, and drag-and-drop. They stay on the manual checklist. Drag-and-drop ends in the same `putItemsInFolder`/`putItemsInWindow` calls the buttons use.
- **Cross-OS rendering checks.** The maintainer wants Chrome checked on Windows, macOS and Linux; that's manual. This suite's screenshots compare the same browser, in the same image, against itself.
- **Clipboard export and copy.** These need a user gesture (`execCommand('copy')`).
- **Timed background jobs.** Auto-discard after 2 minutes and the daily GC are slow and nondeterministic, and are covered by unit tests or the existing Chrome alarm test.
- **Running in CI or on the host.** Like the existing e2e tests, the suite runs only in the dev Docker image.
- **Fixing upstream bugs it reveals.** Those go in `TASKS.md` and are fixed separately.

## Proposal

### 1. One spec and one suite per test

Each test lives in its own folder under `e2e/tests/`, named after its ID:

```
e2e/
  harness/
    runner.cts                # reads spec.yml, runs and checks the steps
    driver.cts                # the browser-neutral interface suites use
    firefox.cts               # Firefox adapter (BiDi workarounds live here)
    chrome.cts                # Chrome adapter (Puppeteer over CDP)
    fixtures.cts              # shared Given steps, e.g. "after E2"
  tests/
    e02-stash-all/
      spec.yml                # the source: plain-English Given / When / Then
      suite.cts               # one function per step, bound to spec.yml
      screenshots/firefox/    # golden images, generated from the baseline
        stash-list-after-stash.png
      screenshots/chrome/     # Chrome's goldens, from a pinned fork commit
        stash-list-after-stash.png
```

**`spec.yml` is the source of truth.** It states the scenario in plain English. The runner reads it, so the spec drives the test rather than just describing it.

```yaml
id: E02
title: Stash all open tabs
given:
  - Three local pages are open in the window, and the stash is empty.
when:
  - The user clicks "Stash all" in the open-tabs section of the stash list.
then:
  - A new folder appears at the top of "Tab Stash" with the three pages, in tab order.
  - step: The stash list shows the new folder, expanded, with its three tabs.
    screenshot:
      name: stash-list-after-stash
      mask:
        - div.forest-item.folder .forest-title # the folder's saved date and time
  - step: The three tabs are hidden and marked as hidden by Tab Stash.
    browser: firefox
  - step: The three tabs are closed.
    browser: chrome
  - The window still has one visible tab.
notes: |
  Folder names are "saved-<ISO time>"; assertions match the prefix, and the
  screenshot masks the folder's title, which shows that date and time.
  Hidden tabs carry the session value hidden_by_tab_stash (src/model/tabs.ts).
  Mutation check: comment out tabs.hide() in model/tabs.ts -> step 3 fails.
```

The format:

- **Fields:** `id`, `title`, `given`, `when`, `then`, `notes`, and optionally `browser` and `upstream-bug` (below).
- **Steps.** Every `given`, `when` and `then` entry is a plain string, or an object with a `step` and any of these keys:
  - **`browser`** (`firefox` or `chrome`) limits the step to that browser. This is how a spec states browser differences, right where they happen. A step without it applies to both browsers. A top-level `browser` limits the whole test (e.g. E21, since only Firefox has a sidebar).
  - **`screenshot`** captures the page after the step and compares it with a golden. Goldens are stored per browser, under `screenshots/<browser>/`. The value is one of:
    - `true`, which names the golden after the step's position, `then-<n>.png`, counting every `then` step from 1 whatever its `browser`, so the name is the same in both browsers;
    - a file name, stored as `<name>.png`;
    - an object `{name?, mask: [...]}`, where `name` works as above (default `then-<n>`) and `mask` lists regions to black out before comparing. Each entry is a CSS selector, which masks the bounding box of every matching element, or a rectangle `[x, y, w, h]` in CSS pixels of the 1000×700 viewport. Selectors follow layout changes, so prefer them; rectangles cover regions no selector targets cleanly. A selector that matches nothing is an error, so a mask can't silently stop working.
- **`notes`** is free text for whoever writes or maintains the suite: variations, timing traps, fragile selectors, upstream bugs to avoid relying on, and the test's **mutation check**. That is a one-line change to Tab Stash that makes the test fail, so anyone can re-run it later.

**`suite.cts` binds code to the spec's steps.** It supplies one function per step, keyed by the step's exact text, and nothing else. It has no ordering, no browser checks and no screenshot calls; the runner takes those from the spec. Each function checks its whole sentence:

```ts
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");
const assert = require("node:assert/strict");

module.exports = steps(__dirname, {
  "Three local pages are open in the window, and the stash is empty.":
    given.threeOpenPages,

  'The user clicks "Stash all" in the open-tabs section of the stash list.':
    async h => {
      await h.open("stash-list.html");
      await h.click(
        "nav.forest-toolbar > a[class="action stash"]",
      );
    },

  'A new folder appears at the top of "Tab Stash" with the three pages, in tab order.':
    async h => {
      const [folder] = await h.stash();
      assert.match(folder.title, /^saved-/);
      assert.deepEqual(folder.urls, h.pageUrls(3));
    },

  "The stash list shows the new folder, expanded, with its three tabs.":
    async h => {
      await h.showAllFolders(); // the runner screenshots after this step
    },

  "The three tabs are hidden and marked as hidden by Tab Stash.": async h => {
    const hidden = await h.tabs({hidden: true});
    assert.deepEqual(
      hidden.map(t => t.url),
      h.pageUrls(3),
    );
    for (const t of hidden) assert.equal(await h.tabMarker(t.id), true);
  },

  "The three tabs are closed.": async h =>
    assert.equal((await h.tabs({url: h.pageUrls(3)})).length, 0),

  "The window still has one visible tab.": async h =>
    assert.equal((await h.tabs({hidden: false})).length, 1),
});
```

The selector matches the class attribute exactly. `a.action.stash` alone matches about a dozen links (folder toolbars use `action stash here`, tab rows `action stash one`, and so on), but only the open-tabs toolbar's "stash all" has exactly `action stash` (`src/stash-list/window.vue:28-30`).

Suites are TypeScript, run by Node's built-in test runner (`node:test`, `node:assert/strict`). Node 22.23 in the dev image runs `.cts` files directly by stripping the types, with no build step (checked). The types are not checked: `tsconfig.json` only covers `src/`. They document the interface, and Prettier and real stack traces still apply. CommonJS keeps the `NODE_PATH` lookup for the globally installed test tools working.

### 2. The harness

**The step runner** (`runner.cts`). `steps(dir, functions)` loads `dir/spec.yml` with `js-yaml` and registers one `node:test` test per browser under test:

- **Order.** It runs every `given`, then every `when`, then every `then` step, in the spec's order, each as a named subtest (`E02 › then › The three tabs are hidden…`), so the output reads like the spec. If a `given` or `when` step fails, the remaining steps are skipped. Every `then` step runs, so one run reports every failed expectation.
- **Browsers.** It runs only the steps whose `browser` matches, or that have none.
- **Screenshots.** After a step with `screenshot`, it asks the driver for a PNG and compares it with the golden for the current browser, byte for byte. With `UPDATE_SCREENSHOTS=1`, it writes the golden instead.
- **Binding.** It checks that every step **for the browser under test** has exactly one function. It also checks that every function matches some step in the spec, of any browser. Duplicate step text within a spec is an error. So `browser: chrome` steps don't need functions until Chrome runs, and a reworded step fails until its suite is updated.

  Binding proves the names line up, not what each function checks. Whether a function checks its whole sentence is kept honest by review and by the mutation check recorded in `notes`.

- **Errors.** After the last step it asserts that the driver collected no errors.
- **Self-test.** The runner has its own `node:test` file. It checks that a missing function, an unused function, duplicate text and a failing `given` each fail.

`js-yaml` is pinned in `install-test-deps.sh` next to Puppeteer, so it stays a test-only tool and out of `package.json`. The runner loads it explicitly from the global install. The repo's own `node_modules` holds an unpinned copy that a dev dependency pulls in, and Node would otherwise prefer that copy over `NODE_PATH`, as the Phase A review found.

**The driver** (`driver.cts`) is the only API suites use. It fills in what Puppeteer can't do in each browser, so suites never call BiDi, CDP or Firefox internals (`Services`, `gBrowser`) themselves:

| Driver method                                                                                                                                                                                       | Firefox adapter                                                                                                                                                                                                                                             | Chrome adapter                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(page)` (the page may carry a query, e.g. `stash-list.html?q=x`); waits for the page to finish starting (`globalThis.app` is set)                                                              | raw BiDi `browsingContext.navigate` to the pinned `moz-extension://` URL                                                                                                                                                                                    | `page.goto("chrome-extension://<id>/…")`, with the id `installExtension()` returned                                                                                                                                                                                                                                                                                                           |
| `eval(js)`, `click(sel, mods?)`, `waitFor(js)`, `waitUntil(fn)` (both wait functions poll every 100 ms, up to 30 s)                                                                                 | BiDi `script.evaluate` in the page                                                                                                                                                                                                                          | `page.evaluate` in the page; clicks and waits are built on `eval` in the driver, as on Firefox                                                                                                                                                                                                                                                                                                |
| `openPages(n)` (pages 1 to n) or `openPages(list)` (just those pages), waiting for them to load; `pageUrls(n)`, `pageUrl(n)`                                                                        | background tabs on the local HTTP server                                                                                                                                                                                                                    | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `stash()`, `tabs(query)`, `tabMarker(id)`, `seed(state)`                                                                                                                                            | the page's own `browser.bookmarks`/`tabs`/`sessions`/`storage`                                                                                                                                                                                              | same, through `page.evaluate`. `tabs()` filters on `hidden` itself, since Chrome rejects it as a query key, and `tabMarker()` is false where `sessions.getTabValue` is missing                                                                                                                                                                                                                |
| `stash()` retries for up to 5 s, since reading fails while the model is mid-update; `tabs({url})` matches `url` (a string or a list) exactly, because match patterns can't carry a port             | done in the driver, over the page's `browser.bookmarks` and `browser.tabs`                                                                                                                                                                                  | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `showAllFolders()`                                                                                                                                                                                  | scrolls each folder into view, so lazy children render (`load-more.vue`)                                                                                                                                                                                    | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `visibleStashTitles()`                                                                                                                                                                              | titles of the stash folders and bookmarks the page shows, top to bottom, leaving out the open-tabs list                                                                                                                                                     | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `clickInRow(rowSel, title, target, mods?)`, `clickInFolder(title, target, mods?)`                                                                                                                   | a synthetic click on `target` in the row whose `.forest-title` is `title`, or in the children listed after it                                                                                                                                               | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `type(sel, text)`, `press(sel, key)`                                                                                                                                                                | sets an input's value and fires `input`; dispatches `keydown` then `keyup`                                                                                                                                                                                  | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `activate()`                                                                                                                                                                                        | makes the test's tab active again with `browser.tabs.update`                                                                                                                                                                                                | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `clickToolbarButton()`: the user clicks Tab Stash's toolbar button in the test's window; first waits for the background's model to load, since a click right after the extension starts can be lost | `browserActionFor(ext).triggerAction(window)` from the chrome context, the call Firefox's own `_execute_browser_action` shortcut makes: it opens a popup if one is set, or else sends `browserAction.onClicked` with the window's active tab, as user input | `page.triggerExtensionAction(ext)` (CDP's experimental `Extensions.triggerAction`): it opens a popup if one is set, or else wakes the service worker and sends `action.onClicked` with the page's tab. The wait before it, here and in `clickTabMenuItem()`, starts the service worker with CDP's `ServiceWorker.startWorker` if it has stopped                                               |
| `clickTabMenuItem(url, label)`: the user right-clicks the tab showing `url` and picks `label`; first waits for the background's model to load                                                       | opens the browser's tab context menu on that tab from the chrome context, opens the submenu holding the add-on's items, and activates the item; Firefox delivers `menus.onClicked` as user input                                                            | Chrome puts the same items in the page's context menu, which CDP can't open, so it calls the undocumented `contextMenus.onClicked.dispatch()` in the service worker with the item's id and the tab showing `url`. The item's id comes from a table of Tab Stash's page-menu items in the adapter, matched by label, and `contextMenus.update()` checks it exists. The event is not user input |
| `closeSidebar()`                                                                                                                                                                                    | `SidebarController.hide()` from the chrome context. Firefox opens an add-on's sidebar when it is installed                                                                                                                                                  | does nothing: Chrome has no sidebar                                                                                                                                                                                                                                                                                                                                                           |
| `popups()`, `sidebarOpen()`                                                                                                                                                                         | the page's own `browser.extension.getViews({type: "popup"})`, keeping popups whose page has started, and `browser.sidebarAction.isOpen({})`                                                                                                                 | same; `sidebarOpen()` is false where `sidebarAction` is missing                                                                                                                                                                                                                                                                                                                               |
| `message(key)`, `vars`                                                                                                                                                                              | the English text of a message from the build's `_locales/en/messages.json`; scratch space for a value one step records for a later one                                                                                                                      | same                                                                                                                                                                                                                                                                                                                                                                                          |
| `screenshot()`                                                                                                                                                                                      | `drawSnapshot` from the chrome context, encoded as PNG                                                                                                                                                                                                      | `page.screenshot()`                                                                                                                                                                                                                                                                                                                                                                           |
| `errors()`                                                                                                                                                                                          | Firefox's console service plus `error_log`                                                                                                                                                                                                                  | `pageerror` on extension pages and `Runtime.exceptionThrown` on each service-worker target, plus `error_log`                                                                                                                                                                                                                                                                                  |
| `restartBackground()`, then the driver reopens the page, retrying with 5 s per attempt; a timeout reports the last error                                                                            | moves the test's tab to `about:blank`, then reloads the add-on through the add-on manager from the chrome context (Open question 2)                                                                                                                         | moves the test's tab to `about:blank`, then closes the service worker's target and waits for it to go; reopening the page wakes the worker                                                                                                                                                                                                                                                    |
| `screenshot({mask})`: masks before capture                                                                                                                                                          | overlays fixed-position black boxes on the masked regions, captures, removes them                                                                                                                                                                           | same                                                                                                                                                                                                                                                                                                                                                                                          |

**The Chrome adapter** (`chrome.cts`) launches headless Chrome through Puppeteer, loads the build with `installExtension()`, and drives the single tab Chrome starts with, so a window holds only the tabs a test opens. It stays attached to the service worker to hear its errors, which also keeps Chrome from stopping the worker when idle; only `restartBackground()` stops it.

**Shared setup** (`fixtures.cts`). Common `given` steps live here as named functions: `threeOpenPages`, `stashedThreePages` ("after E2"), and `given.deletedFolder(h, title, pages)`, which seeds a folder and deletes it through its menu (E10, E19). Specs that start "after E2" bind to the fixture rather than depend on another test, so every test still runs on its own in a fresh browser.

**Known state.** `seed()` writes options and bookmarks before the page loads:

- `storage.sync` key `"options"`: `{restore_folders_into: "target-window"}`, which skips the restore-choice prompt.
- `storage.local` key `"options"`: `{confirm_close_open_tabs: false, last_notified_version: <the manifest version of the build under test>}`. The version suppresses the "what's new" notice, and is read from `$E2E_DIST/manifest.json` because the baseline and our branch differ.
- **Bookmarks:** the `Tab Stash` folder and its children, created with `browser.bookmarks`.

Tests about hiding tabs keep the default `after_stashing_tab: "hide"`.

**Determinism for screenshots.**

- **Fixed viewport:** 1000×700.
- **Fixed locale and timezone:** `TZ=UTC` and `intl.locale.requested=en-US` (Firefox) or `--lang=en-US` (Chrome).
- **Pinned rendering:** the browsers and fonts are pinned in the image. Chrome also runs with `--disable-partial-raster`; without it, anti-aliased edges and text differed by a few colour levels between runs.
- **Settle wait:** a short wait before each capture.
- **Masked regions** for anything that shows a time or date. Tab Stash renders the current date and time in places such as folder names (`Saved 10/13/2026, 2:04:31 PM`) and Deleted Items' day headers. Specs mask those regions rather than control the clock, so the real clock runs everywhere. The driver overlays the masks in the page itself, so it works the same in every browser and needs no image library.

### 3. The test catalogue

Each row seeds one `spec.yml`. Once the spec exists, the spec is the authority and this table is only an index. "On Chrome" lists the Chrome steps, which RFC 0001 ran and recorded in its "Phase 3 parity results"; "identical" means the same assertions apply.

| ID  | Scenario                                                      | Action (page UI)                                                                                                                                                                                                                          | Assertions (Firefox)                                                                                                                                                                          | On Chrome                                                                   |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| E1  | Extension installs and the stash list starts                  | open `stash-list.html`                                                                                                                                                                                                                    | `main.stash-list` renders; no errors (exists today)                                                                                                                                           | identical                                                                   |
| E2  | Stash all open tabs                                           | open 3 local pages; click "stash all" in the open-tabs toolbar                                                                                                                                                                            | a new `saved-…` folder at index 0 of "Tab Stash" with the 3 URLs in tab order; the 3 tabs are hidden with the `hidden_by_tab_stash` marker; one visible tab remains; screenshot (time masked) | the 3 tabs are closed; the rest identical                                   |
| E3  | Stash one tab, twice                                          | click "stash one" on two tab rows (scoped to the open-tabs list)                                                                                                                                                                          | both bookmarks land in the same default folder, because it's under 5 minutes old (`new_folder_timeout_min`)                                                                                   | the 2 tabs are closed; the rest identical                                   |
| E4  | Copy keeps tabs open                                          | Alt-click "stash all"                                                                                                                                                                                                                     | a new folder holding exactly the 3 URLs, in tab order (not the Tab Stash page); the original tabs are still visible and unmarked                                                              | identical                                                                   |
| E5  | Restore one bookmark reuses its hidden tab                    | `given.stashedThreePages`; click a bookmark's `a.forest-title`                                                                                                                                                                            | the hidden tab is shown again (same tab id, not a new tab); its marker is removed; the bookmark remains                                                                                       | a new tab opens with that URL and becomes active; the bookmark remains      |
| E6  | Restore a folder                                              | click the folder's restore action                                                                                                                                                                                                         | all URLs are open and visible; an already-open URL is reused, not duplicated; the bookmarks remain; screenshot (time masked)                                                                  | new tabs open; the rest identical                                           |
| E7  | Restore and remove                                            | click the folder's restore-and-remove action                                                                                                                                                                                              | tabs open; the folder is gone from "Tab Stash"; it is listed on `deleted-items.html`                                                                                                          | identical                                                                   |
| E8  | Delete a bookmark, then undo                                  | click a bookmark's remove action, then the undo notification                                                                                                                                                                              | the bookmark disappears, then returns to its original folder (undo appends it at the end: upstream promises only "approximately the same place")                                              | identical                                                                   |
| E9  | Deleting a folder lists it in Deleted Items                   | "Delete Group" in the folder menu                                                                                                                                                                                                         | the folder is gone from the stash; `deleted-items.html` lists it with its pages; screenshot (header date masked)                                                                              | identical                                                                   |
| E10 | Deleted items survive a background restart                    | delete a folder; `restartBackground()`                                                                                                                                                                                                    | `deleted-items.html` still lists it (IndexedDB persistence)                                                                                                                                   | identical, via a service-worker stop                                        |
| E11 | Rename a folder                                               | click the folder title, type, press Enter                                                                                                                                                                                                 | the bookmark folder's title has changed                                                                                                                                                       | identical                                                                   |
| E12 | Stashing a duplicate URL moves it                             | seed a folder with URL X; stash a tab with URL X into it                                                                                                                                                                                  | still exactly one bookmark for X                                                                                                                                                              | identical                                                                   |
| E13 | Search filters the stash                                      | open `stash-list.html?q=<term>`                                                                                                                                                                                                           | only matching folders and bookmarks are shown; the others are hidden or marked `.no-match`; screenshot (seeded data)                                                                          | identical                                                                   |
| E14 | Removing a stashed bookmark closes its hidden tab             | `given.stashedThreePages`; remove one bookmark with `browser.bookmarks.remove` (as in the Library)                                                                                                                                        | the matching hidden tab is closed by the background's bookmark-removal listener (`src/index.ts`, `close_removed_bookmarks`). `upstream-bug`: lands with its fix (Phase D)                     | not applicable: whole spec is `browser: firefox`                            |
| E15 | Pinned tabs are left out of "Stash all"                       | pin a tab (setup); stash all                                                                                                                                                                                                              | the pinned tab is skipped and stays open, pinned and visible                                                                                                                                  | identical                                                                   |
| E16 | Privileged URLs restore through the redirect page             | seed a bookmark for `about:robots`; restore it                                                                                                                                                                                            | a tab opens at `restore.html?url=about%3Arobots`                                                                                                                                              | Chrome stores `about:robots` as `chrome://robots/`, and that opens directly |
| E17 | Options persist                                               | select `#after_stashing_tab_close` on `options.html`; reload the page                                                                                                                                                                     | the radio is still selected, and `storage.local` has the value                                                                                                                                | identical                                                                   |
| E18 | The popup view renders                                        | open `stash-list.html?view=popup`                                                                                                                                                                                                         | renders with `html[data-view=popup]` and no errors; screenshot (seeded data)                                                                                                                  | identical                                                                   |
| E19 | Restore a folder from Deleted Items                           | given a deleted folder; click Restore on it in `deleted-items.html`                                                                                                                                                                       | the folder and its bookmarks are back; the entry is gone from Deleted Items                                                                                                                   | identical                                                                   |
| E20 | Pinned tabs are included when the option is on                | seed `stash_include_pinned: true`; pin a tab (setup); stash all                                                                                                                                                                           | all three tabs are stashed; the pinned tab is hidden and unpinned                                                                                                                             | the tabs are closed; the rest identical                                     |
| E21 | The sidebar view renders                                      | open `stash-list.html?view=sidebar`                                                                                                                                                                                                       | renders with `html[data-view=sidebar]` and no errors; screenshot (seeded data)                                                                                                                | not applicable: whole spec is `browser: firefox`                            |
| E22 | The toolbar button can't show the popup while it also stashes | seed the toolbar to stash all tabs and show a tab; open `options.html`                                                                                                                                                                    | the "popup" choice for what the toolbar button shows is disabled (`canBrowserActionShow()`)                                                                                                   | identical                                                                   |
| E23 | Showing the popup doesn't also open the sidebar               | with the toolbar and menus set to show the popup, pick "Stash This Tab" from a tab's context menu. No release offers the popup for menus, so the spec seeds it; the toolbar alone reaches the bug only once the button has lost its popup | the popup is shown and the sidebar stays closed. `upstream-bug` (Phase D)                                                                                                                     | not applicable: whole spec is `browser: firefox`                            |

Some scenarios act, check, and act again, e.g. delete a folder, see it listed, restore it. A spec runs every `given`, then every `when`, then every `then`, so such a scenario becomes two specs: E9 and E19, E15 and E20, E18 and E21. E17 checks persistence only, because showing the option's effect would need a second action.

### 4. Rules every test follows

- **Drive the UI, assert on the browser.** Actions go through the page's buttons, links and inputs. State comes from `browser.bookmarks`, `browser.tabs`, `browser.sessions` and `browser.storage`. Tests read the DOM only to check what the user sees.
- **Allowed non-UI actions.** Only these may bypass the UI, and each is a stand-in for something a user does outside Tab Stash's pages:
  - `seed()`, which sets up state;
  - `browser.bookmarks.remove` in E14, as the user would in the Library;
  - `restartBackground()` in E10;
  - pinning a tab in a `given` step (E15, E20), as the user would from the tab's menu;
  - seeding a bookmark with a custom URL (E16);
  - opening pages with `openPages()` in a `given` step, as the user would open tabs;
  - bringing the test's tab forward with `activate()`, as the user would by clicking it;
  - closing the sidebar with `closeSidebar()` in a `given` step (E23), as the user would with its close button;
  - clicking Tab Stash's toolbar button with `clickToolbarButton()`, as the user would; the browser itself decides what the click does;
  - picking an item from a tab's context menu with `clickTabMenuItem()` (E23), as the user would by right-clicking the tab. On Chrome this sends the menu's click event to the service worker directly, since CDP can't open the page's context menu.
- **Don't call `the.model` to perform an action.** That tests internals. The one allowed use is waiting for it to load.
- **Never call BiDi, CDP or browser internals from a suite.** Missing capabilities go into the adapters and the driver, once.
- **Assert on errors in every test**, through `errors()`.
- **Don't encode known upstream bugs.** Scenarios that would rely on one are left out until the bug is fixed; the bug is in `TASKS.md`.
- **Specs for upstream bugs this fork fixes.** When this fork fixes an upstream bug that changes what the user sees, the fix lands with a spec that proves it, and the spec says so with a top-level `upstream-bug:` naming the bug's heading in `TASKS.md`. Such a spec can't pass on the baseline, so:
  - on a reference build (`--ref`), the runner runs it as a node:test _todo_: its results are reported but don't fail the run;
  - on our branch it must pass like any other spec;
  - its notes record the step that fails on `622bf3d` and why. Reverting the fix is its mutation check;
  - a screenshot step must come after the step that fails on the buggy build, so a reference run can't write a golden of the bug. Its goldens come from the fixing commit, like Chrome's.
  - A fix with no visible effect gets a unit regression test instead.
- **Screenshots supplement state checks; they never replace them.** A page can look right while the bookmarks are wrong.

### 5. Running it, and proving the baseline

**The baseline** is upstream's own code, unmodified, at a pinned commit: **`622bf3d`**, the one verified in Background. A test is trusted only once it passes there: if it fails against upstream's untouched code, the test is wrong, not Tab Stash. The golden screenshots also come from that build, so our branch is compared with how upstream actually looks. We move the pinned commit on purpose, in its own commit, after pulling upstream and regenerating the goldens.

**`bin/e2e` is the entrypoint.** It's a small shell script, separate from `bin/dev` so that `bin/dev` stays a generic Docker wrapper. It turns a few flags into the right Makefile target and environment, and runs it in the dev image through `bin/dev run`:

```
bin/e2e test --browser=firefox                        # test this checkout
bin/e2e test --browser=firefox --ref=622bf3d          # build 622bf3d, test that
bin/e2e test --browser=firefox --ref=622bf3d --update-goldens   # regenerate goldens
bin/e2e test --browser=chrome                         # the same suite on Chrome
bin/e2e test --browser=chrome --ref=bd2efa4 --update-goldens    # Chrome goldens
bin/e2e help
```

- **`--browser` is required.**
- **`--ref=<commit>`** checks out and builds that commit (cached per commit), then runs _this_ checkout's tests against _that_ build. Any commit works: the pinned upstream one, an older commit of ours, or a branch.
- **`--update-goldens`** requires `--ref`, so goldens can't be regenerated from uncommitted or branch changes by accident.
- **Both browsers.** Both flags work for Firefox and Chrome. Firefox's goldens come from upstream `622bf3d`. Upstream has no Chrome build that loads, so Chrome's goldens come from a pinned commit of this fork (`bd2efa4`).
- **The Makefile targets stay the real logic,** so there's still one build system. `bin/e2e` only chooses among them.

Before and after, in the Makefile:

| Target              | Today                                         | After                                                                                                  |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `check-e2e`         | runs `check-e2e-chrome` + `check-e2e-firefox` | unchanged                                                                                              |
| `check-e2e-chrome`  | the Chrome smoke test                         | the smoke test (`e2e/chrome.test.cjs`), then the suites with `E2E_BROWSER=chrome E2E_DIST=dist-chrome` |
| `check-e2e-firefox` | `e2e/firefox.test.cjs`                        | the runner self-test plus `e2e/tests/*/suite.cts`; the smoke test becomes E1                           |
| `check-e2e-ref`     | —                                             | new: the suite in `E2E_BROWSER` (default `firefox`) against that browser's build of `E2E_REF`          |

```make
check-e2e-chrome: build-chrome-dbg
	node --test e2e/chrome.test.cjs
	TZ=UTC E2E_BROWSER=chrome E2E_DIST=dist-chrome node --test $(E2E_SPECS)

E2E_DIST ?= dist
# Narrows a run to some suites, e.g. E2E_SPECS='e2e/tests/e01-*/suite.cts'.
E2E_SPECS ?= e2e/tests/*/suite.cts

check-e2e-firefox: build-dbg
	TZ=UTC E2E_BROWSER=firefox E2E_DIST=$(E2E_DIST) node --test e2e/harness/runner.test.cts $(E2E_SPECS)

# Builds E2E_REF once per build target and runs this checkout's tests against
# that build in E2E_BROWSER (see the Makefile for the full comment).
E2E_BROWSER ?= firefox

check-e2e-ref:
	@test -n "$(E2E_REF)" || { echo "Set E2E_REF=<commit>" >&2; exit 1; }
	@case "$(E2E_BROWSER)" in \
	  firefox) build=build-dbg; out=dist ;; \
	  chrome) build=build-chrome-dbg; out=dist-chrome ;; \
	  *) echo "E2E_BROWSER must be firefox or chrome" >&2; exit 1 ;; \
	esac; \
	sha="$$(git rev-parse --verify --quiet "$(E2E_REF)^{commit}")" || { \
	  echo "E2E_REF does not resolve to a commit: $(E2E_REF)" >&2; exit 1; }; \
	dir="node_modules/.cache/e2e-ref/$$sha"; \
	test -e "$$dir/.e2e-built-$$build" || ( \
	  { test -d "$$dir/.git" || { rm -rf "$$dir" && git clone --quiet . "$$dir"; }; } && \
	  git -C "$$dir" checkout --quiet "$$sha" && \
	  $(MAKE) -C "$$dir" $$build && \
	  touch "$$dir/.e2e-built-$$build" ) && \
	TZ=UTC E2E_BROWSER=$(E2E_BROWSER) E2E_DIST="$$dir/$$out" node --test $(E2E_SPECS)
```

- **The reference build is cached** per commit hash, with a completion marker per build target, so a commit's Firefox and Chrome builds share one clone. `node_modules/` is gitignored, so Prettier and git ignore the cached clone. The first build of a commit takes a few minutes (`npm clean-install`); later runs reuse it.
- **Golden screenshots:** `bin/e2e test --browser=firefox --ref=622bf3d --update-goldens` writes them from the baseline build (it sets `UPDATE_SCREENSHOTS=1`). Our branch must then match them.
  - A branch that changes Firefox's UI on purpose regenerates the affected goldens in the same PR, and the reviewer approves the image diff.
  - Nothing in RFC 0001 should change Firefox's UI, so for now the goldens are always the baseline's.
  - Chrome's goldens live under `screenshots/chrome/` and come from `bin/e2e test --browser=chrome --ref=bd2efa4 --update-goldens`, since upstream has no Chrome build to take them from.
- **A test is accepted only if:**
  - it passes against the baseline (`--ref=622bf3d`), and the whole suite then passes three consecutive runs;
  - it passes against our branch (no Firefox regression);
  - its `notes` mutation check makes it fail.

## Alternatives considered

**Plain `node:test` titles, with no YAML.** `describe("E02 Stash all open tabs")` with `test("then: the three tabs are hidden …")` costs nothing: no parser, no runner, and no sentence written twice. It lost on two counts:

- **No standalone spec.** The scenario would exist only inside code, and you'd want a structured, readable spec as the source that a person or an AI agent can review without reading TypeScript.
- **No machine-read structure.** `browser` and `screenshot` (with its masks) would become ad-hoc `if`s in every suite instead of keys the runner acts on.

The cost we accept is each step's sentence appearing twice, once in the YAML and once as a key in the suite. `CLAUDE.md` prefers generating derived files to duplicating them; the runner's exact-match check is what keeps that duplication safe.

**A spec object exported from `suite.cts`.** This keeps the structure without a parser. But the spec and the code share a file, so the spec is no longer a separate, reviewable artifact, and the plain English sits among the code.

**Gherkin with Cucumber.** Feature files with Given/When/Then are the established form of this idea, and our binding has the same shape. But Cucumber brings its own runner, a Gherkin parser, and a step library shared across the whole suite, where one sentence can be reused, and so changed, by many tests. Binding each spec to its own suite keeps steps local. YAML lets a step carry structure (`browser`, `screenshot`) that Gherkin puts in tags or tables.

**Tangling the tests out of the spec (literate style).** The code would live in the YAML, as a `code:` block per step, and a script would generate `suite.cts`. Spec and code could never drift. But the code would lose Prettier and real stack traces, and the plain-English spec would be buried in code.

**Extracting the spec from the tests.** `suite.cts` would be the source, with structured comments (`// then [chrome, screenshot=x]: …`) that a script turns into a readable spec. No parser is needed, but the structure would be a comment convention that nothing enforces, the opposite of what we want from YAML.

**Screenshots as the only baseline.** Pure visual regression is quick to set up, but it can't see browser state: hidden tabs, bookmark contents and storage don't show on the page.

**A screenshot diff with a tolerance** (e.g. `pixelmatch`). It's more forgiving of anti-aliasing, but it adds a dependency and a threshold to tune. It also can't fix the real source of instability, which is text (timestamps), not pixels. Masks handle that.

**Controlling the clock instead of masking.** Phase A first froze `Date` in the page. That deadlocked Tab Stash, which times a 20 ms wait with `Date.now()` when it creates the stash folder (`src/model/bookmarks.ts:616`). A pin of only `new Date()` worked for E02, but it covered the page only and was installed after load, so Deleted Items' first-render headers escaped it. A system-level clock via libfaketime (`LD_PRELOAD`) would have covered everything. But Firefox 157 deadlocks in its first memory allocation under it, before it starts, with every option tried. Masks need neither.

**Selenium or WebdriverIO with geckodriver for Firefox.** These can install add-ons, but they hit the same BiDi limitation on extension pages, and they'd add a second driver next to Puppeteer. Puppeteer already installs the extension in Firefox (`browser.installExtension`, which sends BiDi's `webExtension.install`).

**Playwright.** Its Firefox can't load extensions, so it can't serve as a Firefox baseline.

**`web-ext run`.** It's already a dev dependency and launches Firefox with the extension, but it's a launcher, not a test runner.

**Testing through the model** (`the.model.*` or the background's `model`). This is quicker to write, but it tests internals and would pass with a broken UI. The unit tests already cover the model against a mock browser.

## Tradeoffs and risks

- **The Firefox adapter relies on browser internals.** `--remote-allow-system-access`, raw BiDi commands, the console service and `drawSnapshot` could all change between Firefox versions. Mitigations: the versions are pinned together in `install-test-deps.sh`, and all of it lives in one adapter file.
- **Synthetic clicks aren't real user gestures.** Anything that needs a gesture (opening the sidebar, clipboard copy, `openPopup`) can't be tested this way, so those paths stay manual.
- **Selectors are fragile.**
  - The action buttons are icon-only. Tests tell them apart by class combinations scoped to a container, with no ids or `data-` attributes.
  - Toolbars are hidden until hover (`styles/forest.less:62`). `el.click()` still works, but visibility can't be asserted.
  - An upstream UI refactor could break many tests at once. `data-test` attributes would fix this, but they touch upstream UI code (Open question 3).
- **Timing.** Folders render their children on intersection, search waits 250 ms, and the undo notification lasts 8 seconds. The driver polls with bounded waits. The three-run rule catches flakiness, at the cost of runtime.
- **Masked regions aren't checked.** A bug that only shows in a masked area, such as a wrong date format, passes the screenshot. State assertions still cover the data. Masks are kept to the smallest region that shows a time or date, preferably by selector.
- **Goldens churn and add binaries.** An intentional UI change invalidates the affected goldens, which then need regenerating and reviewing. So does a version bump, because the stash list's footer shows the version. Each PNG is about 15–20 KB.
- **Goldens are tied to the machine type.** Byte-for-byte goldens depend on software rendering and the Firefox build, so goldens made on x86_64 won't match an arm64 host, such as Colima on Apple silicon. Goldens are generated on x86_64. Running screenshot steps elsewhere needs its own goldens or a tolerance (Open questions).
- **Each sentence is written twice,** once in YAML and once in the suite. The runner catches mismatches, but rewording a step means editing two files.
- **The image grows slightly.** It's 2.67 GB today; this adds one test-only npm package (`js-yaml`). The suite is fork tooling, not proposed upstream unless the maintainer asks.

## Rollout

**Phase A: harness and three tests.**

- **Work:**
  - the runner, with its self-test;
  - the driver and the Firefox adapter;
  - `fixtures.cts`;
  - `js-yaml` in `install-test-deps.sh`;
  - `bin/e2e`, and the `check-e2e-firefox` and `check-e2e-ref` changes;
  - specs and suites for E1 (the smoke test, moved), E2 and E8, with E2's goldens generated from the baseline.
- **Proofs needed in this phase:**
  - Do exact screenshot matches hold across runs?
  - Does `js-yaml` resolve from `.cts` files?
  - Test time per test, measured to check the budget.
- **Exit criteria:** the runner self-test passes. E1, E2 and E8 pass against the baseline and against our branch, and the suite passes three consecutive runs. Each test's mutation check fails it.

**Phase B: the core scenarios** (E3–E7, E9, E11, E19), two or three tests per PR.

- **Exit criteria:** the same as Phase A.

**Phase C: the rest** (E10, E12–E18, E20, E21).

- **Fallback for E10:** if `restartBackground()` can't be made reliable on Firefox (Open question 2), E10 is dropped from this RFC and noted in `TASKS.md`.
- **E14 was deferred** (it lands in Phase D). It fails on upstream `622bf3d`: the background snapshots the stash's URLs at startup and refreshes them on bookmark change, move and remove, but not on create. A page stashed after startup is never in the snapshot, so removing its bookmark closes nothing. Making E14 pass would mean a `given` step that leans on the bug (e.g. renaming a bookmark first). The bug is in `TASKS.md`; E14 lands once the fix does, and it then serves as the fix's regression test.
- **Exit criteria:** the same as Phase A, and the whole suite's test time is under five minutes.

**Phase D: fixing the upstream bugs in `TASKS.md`.** Each bug is fixed in its own commit, with `[pre-existing]` at the end of its subject, with a test: a spec marked `upstream-bug` when the fix changes what the user sees (E04 gains a full check of the copied folder, E14 lands, E23 is new), or a unit regression test when it doesn't. The runner learns `upstream-bug` first.

- **E22 is a regression test, not an `upstream-bug` spec.** It checks the rule that made the options watchers redundant, and passes on `622bf3d`. The watchers are removed as dead code, checked by `make` only.
- **Exit criteria:** the same as Phase A, except that `upstream-bug` specs run as todo on the baseline, and each one's notes record the step that fails there.

### Phase A results

Recorded on 2026-10-13 at commit `d1aa9a0`.

- **Baseline:** `bin/e2e test --browser=firefox --ref=622bf3d` passed three consecutive runs, 19/19 checks each (E01, E02, E08 and their steps).
- **Our branch:** `bin/e2e test --browser=firefox` passed three consecutive runs, 28/28 each, including the runner's 9 self-tests.
- **Screenshots:** E02's golden, generated from `622bf3d`, matched byte for byte in six runs (three per build) during Task 5, and in all six exit runs.
- **Mutation checks**, each failing the expected step:
  - E01: deleting `dist/stash-list.js` fails "The stash list renders."
  - E02: an early return in `hide()` (`src/model/tabs.ts`) fails "The three tabs are hidden and marked as hidden by Tab Stash."
  - E08: removing `@activate="onDeleteNotifActivated"` (`src/stash-list/index.vue:41`) fails the restore step.
- **Neutral suites:** `grep -rE "connection\.send|Services\.|gBrowser" e2e/tests` finds nothing.
- **Speed:** test time was 8.0–8.6 s per run. `node --test` runs each spec file in its own process, concurrently, so the three specs took about as long as the slowest one. Even run one at a time, at roughly 3 s per spec (Firefox start, install, steps), 18 specs come to about a minute, well inside the five-minute budget.
- **What Phase A changed in the design:**
  - **The clock pinned only `new Date()`.** Freezing `Date.now()` deadlocked Tab Stash's 20 ms wait when it creates the stash folder. After Phase A, masks replaced the clock altogether (Open question 1).
  - **The driver waits before seeding.** It waits for the background to record its version, because a fresh install rewrites the local options.
  - **E8 checks the folder, not the position.** Undo appends the bookmark to its folder (`622bf3d` does too).
  - **The reference build is cached per commit hash,** with a completion marker.
  - **`js-yaml` is loaded from the global install.** The final review found the repo's unpinned copy was being used instead; the runner now loads the pinned 5.4.3 explicitly. Puppeteer wasn't affected.
  - **Screenshot steps wait for the state they show to settle.** E02 waits for the tabs to be hidden before capturing.

### Phase B and C results

Recorded on 2026-10-14 at commit `07bce90`.

- **Baseline:** `bin/e2e test --browser=firefox --ref=622bf3d` passed three consecutive runs, 123/123 checks each.
- **Our branch:** `bin/e2e test --browser=firefox` passed three consecutive runs, 133/133 each, including the runner's 10 self-tests.
- **Coverage:** 20 specs, E1–E21 except E14 (deferred, below).
- **Speed:** test time was 60–70 s per run on our branch and 73–120 s on the baseline (one slow outlier), well inside the five-minute budget. E10's restart adds about 5 s.
- **Screenshots:** the goldens for E02, E06, E09, E13, E18 and E21 were generated from `622bf3d` and matched byte for byte in every exit run. E09 masks its header date; E18 and E21 mask the search box, which those views focus, so its caret can't blink into the image.
- **Neutral suites:** `grep -rE "connection\.send|Services\.|gBrowser" e2e/tests` finds nothing.
- **Mutation checks**, each failing the step named in its spec's notes:
  - E03: `if (true)` for the folder-age check (`src/model/index.ts:420`).
  - E04: `to_stash` instead of `copyIf(ev.altKey, to_stash)` (`src/stash-list/window.vue:471`).
  - E05 and E06: two edits to `moveLeaf`'s tab filter (`src/model/index.ts:1101`), one never reusing hidden tabs, one never reusing open ones.
  - E07: a no-op `beforeClosing` for restore-and-remove (`src/stash-list/folder.vue:717`).
  - E09: no `deleted_items.add` when deleting (`src/model/index.ts:1366`).
  - E10: no IndexedDB `put` (`src/datastore/kvs/service.ts:122`); and, to prove the restart is real, deleting the database when a background starts (`:211`), which fails E10 but not E09.
  - E11: no Enter handler on the rename input (`src/components/async-text-input.vue:16`).
  - E12: never reuse an existing bookmark (`src/model/index.ts:892`).
  - E13: render every folder whatever the search (`src/stash-list/folder-list.vue:65`).
  - E15 and E20: force the pinned-tab filter off and on (`src/stash-list/window.vue:465`).
  - E16: open `about:` URLs directly (`src/util/index.ts:126`).
  - E17: the options page never shows stored values (`src/options/index.vue:486`).
  - E18 and E21: no `data-view` on `<html>` (`src/launch-vue.ts:35`).
  - E19: undelete never re-creates bookmarks (`src/model/index.ts:1453`).
- **Deferred:** E14, because upstream never refreshes its stashed-URL snapshot on bookmark creation (Phase C above, and `TASKS.md`).
- **Upstream bugs found,** recorded in `TASKS.md` and not encoded as expected behaviour:
  - Alt-click "Stash all" also copies the Tab Stash page itself (E04 checks only the three pages, and says so).
  - Removing a bookmark stashed after startup leaves its hidden tab open (E14).
  - A unit test in `src/model/deleted-items.test.ts` fails about 0.1% of the time on random data.
- **What Phases B and C changed in the design:**
  - **`h.tabs({url})` matches URLs in the driver.** `browser.tabs.query` match patterns can't carry a port, so passing the URL through matched nothing.
  - **`h.stash()` retries briefly,** since reading the stash can fail while the model is mid-update.
  - **`open()` waits for the page to finish starting.** Reloading a page that was still starting made Firefox log "Promise resolved after context unloaded", failing the error check about once in four runs.
  - **The Firefox adapter restarts the background through the add-on manager,** after moving the test's tab to `about:blank` (Open question 2).
  - **`visibleStashTitles()` moved into the driver,** since E13, E18 and E21 each carried a copy.
  - **`restartBackground()` reports its last error** when the page doesn't come back, rather than only timing out.
  - **`when` steps wait only for what they need,** and each `then` step waits for its own outcome, so a mutation fails the step it's about.
  - **Several planned mutations were no-ops or unreachable** and were replaced; each spec's notes give the edit that was actually verified.

**After this RFC.** RFC 0001 added the Chrome adapter, ran the specs with `browser: chrome` steps, and recorded a parity table in its "Phase 3 parity results": every spec that applies to Chrome passes, and nothing needed architectural change.

**Rollback:** the suite is additive and fork-only. Removing `e2e/tests/`, `e2e/harness/`, `bin/e2e` and the target changes undoes it. The smoke test can be restored from git.

## Success criteria

- **Baseline:** every test passes against the pinned upstream build in Firefox, and its goldens come from that build. Specs marked `upstream-bug` are the exception: they run as todo there, and their goldens come from the fixing commit.
- **No Firefox regression:** the same tests, screenshots included, pass against our branch.
- **Reliable:** the whole suite passes three consecutive runs, with no retries.
- **Bound:** every step for the browser under test has exactly one function, and the runner's self-test shows the binding rules fail when broken.
- **Tests that bite:** every spec's `notes` names a mutation, and applying it fails the test.
- **Speed:** test time (excluding builds) is under five minutes.
- **Neutral:** no suite calls BiDi, CDP or browser internals; a grep for `connection.send`, `Services.` and `gBrowser` in `e2e/tests/` finds nothing.

## Security, privacy, operational impact

**Security:**

- The test browsers run with `--remote-allow-system-access` (Firefox) and `--no-sandbox` (Chrome).
- They run only in throwaway headless profiles inside the dev container, and neither flag reaches any build output.
- The local HTTP server listens only on `127.0.0.1` inside the container.

**Privacy:** no impact. Tests use synthetic local pages and fresh profiles, and send nothing out.

**Operations:**

- **Maintenance:** the main ongoing cost is keeping specs, suites and goldens in step with UI changes.
- **Upgrades:** browser upgrades mean bumping the three pinned versions together and regenerating the goldens.
- **Reference cache:** each new `--ref` commit is built once and then reused.
- **Runtime:** it doesn't change how Tab Stash itself is built or released.

## Open questions

1. **How should screenshots handle dates and times?** _Resolved after Phase A_ by a spike:
   - **Masks alone work.** E02 with a masked folder title matched byte for byte in 6 of 6 runs across the baseline and our branch. Deleted Items, with its header date masked, matched in 3 of 3.
   - **The other options failed.** libfaketime stops Firefox from starting, and the in-page pin missed first-render dates.
   - **So screenshots mask times,** and the clock is left alone.
2. **Can the Firefox adapter restart the background reliably?** _Resolved in Phase C:_ yes. `browser.runtime.reload()` closes the add-on's tabs, and with the test's tab the only one, Firefox exits. Instead the adapter moves that tab to `about:blank` and reloads the add-on through the add-on manager from the chrome context. The add-on keeps its UUID, storage and IndexedDB, and E10 passed 10 consecutive runs on our branch and 6 on the baseline.
3. **Should the suite add `data-test` attributes upstream to make selectors less fragile?** _Defer_ until selector breakage is a real cost, since it touches upstream UI code.
4. **Do synthetic `MouseEvent`s with `altKey` reach the Vue handlers the same way real clicks do (E4)?** _Resolved in Phase B:_ yes. With `copyIf(ev.altKey, …)` replaced by a plain move, E4's "still visible" step fails, so the handler sees `altKey`.

## History

- 2026-10-13 — draft
- 2026-10-14 — Chrome adapter built (RFC 0001 Phase 3)
- 2026-10-14 — Phase D: specs for the upstream bugs this fork fixes
