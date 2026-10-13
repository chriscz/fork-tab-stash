# RFC 0002: A Firefox-baseline end-to-end test suite

- Status: draft
- Author(s): Chris Coetzee, Claude
- Date: 2026-10-13
- Links: [RFC 0001](0001_chrome-mv3-separate-manifest.md) (which will use this suite for Chrome); maintainer views in [maintainer-views.md](0001_chrome-mv3-separate-manifest.d/maintainer-views.md)

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

Chrome needs none of these workarounds: Puppeteer's `page.goto`, `page.screenshot` and `pageerror` work on its extension pages.

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
- **Options watchers.** The coupling watchers in `src/options/index.vue:528` watch top-level keys that don't exist, so they never fire.

## Goals

1. **A suite of end-to-end tests for core functionality.** It covers what a user can do from Tab Stash's own pages: stash, restore, delete and undelete, rename, search, options, and data surviving a background reload.
2. **Readable specs.** Every test has a plain-English `spec.yml` (Given / When / Then, plus notes). A person or an AI agent can implement, review and regenerate a test from it without reading code.
3. **A real baseline.** Every test passes against an unmodified upstream build (`622bf3d`) in Firefox before it's used to judge anything else. Its golden screenshots come from that build.
4. **Assertions on user-visible state.** Tests assert on what a user can see (the bookmark tree, open and hidden tabs, what the page shows), not on model internals. This follows Chrome's testing guidance ([end-to-end testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)).
5. **Browser-neutral tests.** Suites never touch a browser's automation protocol directly, so the same specs and suites can run on Chrome later by adding an adapter, not by rewriting tests.
6. **Runs where everything else does, fast and reliably.** It runs in the dev Docker image with one command (`bin/e2e test --browser=firefox`). Test time, excluding builds, is under five minutes. The whole suite passes three consecutive runs.

## Non-goals

- **Running the suite on Chrome.** That belongs to RFC 0001. Specs may already carry `browser: chrome` steps, but those are unverified expectations until RFC 0001 runs them.
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
    chrome.cts                # Chrome adapter (plain Puppeteer)
    fixtures.cts              # shared Given steps, e.g. "after E2"
  tests/
    e02-stash-all/
      spec.yml                # the source: plain-English Given / When / Then
      suite.cts               # one function per step, bound to spec.yml
      screenshots/firefox/    # golden images, generated from the baseline
        stash-list-after-stash.png
```

**`spec.yml` is the source of truth.** It states the scenario in plain English. The runner reads it, so the spec drives the test rather than just describing it.

```yaml
id: E02
title: Stash all open tabs
clock: 2026-01-01T09:00:00Z # only in specs with screenshots, see section 2
given:
  - Three local pages are open in the window, and the stash is empty.
when:
  - The user clicks "Stash all" in the open-tabs section of the stash list.
then:
  - A new folder appears at the top of "Tab Stash" with the three pages, in tab order.
  - step: The stash list shows the new folder, expanded, with its three tabs.
    screenshot: stash-list-after-stash
  - step: The three tabs are hidden and marked as hidden by Tab Stash.
    browser: firefox
  - step: The three tabs are closed.
    browser: chrome
  - The window still has one visible tab.
notes: |
  Folder names are "saved-<ISO time>"; assertions match the prefix. The clock
  makes the screenshot's "Saved 1/1/2026, 9:00:00 AM" stable.
  Hidden tabs carry the session value hidden_by_tab_stash (src/model/tabs.ts).
  Mutation check: comment out tabs.hide() in model/tabs.ts -> step 3 fails.
```

The format:

- **Fields:** `id`, `title`, `given`, `when`, `then`, `notes`, and optionally `browser` and `clock`.
- **Steps.** Every `given`, `when` and `then` entry is a plain string, or an object with a `step` and any of these keys:
  - **`browser`** (`firefox` or `chrome`) limits the step to that browser. This is how a spec states browser differences, right where they happen. A step without it applies to both browsers. A top-level `browser` limits the whole test (e.g. E14, which needs hidden tabs).
  - **`screenshot`** captures the page after the step and compares it with a golden. `screenshot: <name>` stores it as `<name>.png`. `screenshot: true` uses the step's position, `then-<n>.png`, counting every `then` step from 1 whatever its `browser`, so the name is the same in both browsers. Goldens are stored per browser, under `screenshots/<browser>/`.
- **`clock`** pins the page's current date (`new Date()`) to that instant (see section 2). Only specs with screenshots set it.
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

| Driver method                                                         | Firefox adapter                                                          | Chrome adapter                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `open(page)` (the page may carry a query, e.g. `stash-list.html?q=x`) | raw BiDi `browsingContext.navigate` to the pinned `moz-extension://` URL | `page.goto("chrome-extension://<id>/…")`               |
| `eval(js)`, `click(sel, mods?)`, `waitFor(js)`, `waitUntil(fn)`       | BiDi `script.evaluate` in the page                                       | `page.evaluate`, `page.click`, `page.waitForFunction`  |
| `openPages(n)`, `pageUrls(n)`                                         | tabs on the local HTTP server                                            | same                                                   |
| `stash()`, `tabs(query)`, `tabMarker(id)`, `seed(state)`              | the page's own `browser.bookmarks`/`tabs`/`sessions`/`storage`           | same, through `page.evaluate`                          |
| `showAllFolders()`                                                    | scrolls each folder into view, so lazy children render (`load-more.vue`) | same                                                   |
| `screenshot()`                                                        | `drawSnapshot` from the chrome context, encoded as PNG                   | `page.screenshot()`                                    |
| `errors()`                                                            | Firefox's console service plus `error_log`                               | `pageerror` events plus `error_log`                    |
| `restartBackground()` (Phase C, not built yet)                        | reloads the add-on (Open question 2)                                     | `WebWorker.close()`, then waits for the worker to wake |
| the pinned date (the spec's `clock`, applied by `launch`)             | overrides `new Date()` in the page after each load (see below)           | `page.evaluateOnNewDocument`                           |

**Shared setup** (`fixtures.cts`). Common `given` steps live here as named functions: `threeOpenPages`, and `stashedThreePages` ("after E2"). Specs that start "after E2" bind to the fixture rather than depend on another test, so every test still runs on its own in a fresh browser.

**Known state.** `seed()` writes options and bookmarks before the page loads:

- `storage.sync` key `"options"`: `{restore_folders_into: "target-window"}`, which skips the restore-choice prompt.
- `storage.local` key `"options"`: `{confirm_close_open_tabs: false, last_notified_version: <the manifest version of the build under test>}`. The version suppresses the "what's new" notice, and is read from `$E2E_DIST/manifest.json` because the baseline and our branch differ.
- **Bookmarks:** the `Tab Stash` folder and its children, created with `browser.bookmarks`.

Tests about hiding tabs keep the default `after_stashing_tab: "hide"`.

**Determinism for screenshots.**

- **Fixed viewport:** 1000×700.
- **Fixed locale and timezone:** `TZ=UTC` and `intl.locale.requested=en-US` (Firefox) or `--lang=en-US` (Chrome).
- **Pinned rendering:** the browsers and fonts are pinned in the image.
- **Settle wait:** a short wait before each capture.
- **A pinned date,** for specs that set `clock`. The driver makes `new Date()` with no arguments return that instant, so dates Tab Stash creates, such as folder names (`Saved 1/1/2026, 9:00:00 AM`), render the same on every run.
  - **`Date.now()` keeps running.** Tab Stash times its own waits with it, e.g. a 20 ms loop when it creates the stash folder (`src/model/bookmarks.ts:616`). Freezing it deadlocked the stash in Phase A, so only the current date is pinned. Anything Tab Stash stamps with `Date.now()` still gets the real time.
  - **Page only.** The date is pinned in the page only. Bookmarks' `dateAdded` still comes from the browser's real clock, so the clock stays off in specs whose behaviour compares the two, such as E3's "folder under 5 minutes old".
  - **Installing it early.** Chrome installs the pin before the page's scripts run. Firefox has no preload hook for extension pages, so the Firefox adapter installs it right after each load. Phase A showed that this is enough when the dated item is created after load (E02), but not for dates a page computes at first render, such as Deleted Items' day headers (Open question 1).

### 3. The test catalogue

Each row seeds one `spec.yml`. Once the spec exists, the spec is the authority and this table is only an index. "Expected on Chrome" lists what RFC 0001 will need to verify, written as Chrome steps; "identical" means the same assertions apply.

| ID  | Scenario                                          | Action (page UI)                                                                                   | Assertions (Firefox)                                                                                                                                                                    | Expected on Chrome (unverified)                             |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| E1  | Extension installs and the stash list starts      | open `stash-list.html`                                                                             | `main.stash-list` renders; no errors (exists today)                                                                                                                                     | identical                                                   |
| E2  | Stash all open tabs                               | open 3 local pages; click "stash all" in the open-tabs toolbar                                     | a new `saved-…` folder at index 0 of "Tab Stash" with the 3 URLs in tab order; the 3 tabs are hidden with the `hidden_by_tab_stash` marker; one visible tab remains; screenshot (clock) | the 3 tabs are closed; the rest identical                   |
| E3  | Stash one tab, twice                              | click "stash one" on two tab rows (scoped to the open-tabs list)                                   | both bookmarks land in the same default folder, because it's under 5 minutes old (`new_folder_timeout_min`); no clock                                                                   | the 2 tabs are closed; the rest identical                   |
| E4  | Copy keeps tabs open                              | Alt-click "stash all"                                                                              | folder created; the original tabs are still visible and unmarked                                                                                                                        | identical                                                   |
| E5  | Restore one bookmark reuses its hidden tab        | `given.stashedThreePages`; click a bookmark's `a.forest-title`                                     | the hidden tab is shown again (same tab id, not a new tab); its marker is removed; the bookmark remains                                                                                 | a new tab opens with that URL; the bookmark remains         |
| E6  | Restore a folder                                  | click the folder's restore action                                                                  | all URLs are open and visible; an already-open URL is activated, not duplicated; the bookmarks remain; screenshot (clock)                                                               | new tabs open; the rest identical                           |
| E7  | Restore and remove                                | click the folder's restore-and-remove action                                                       | tabs open; the folder is gone from "Tab Stash"; it is listed on `deleted-items.html`                                                                                                    | identical                                                   |
| E8  | Delete a bookmark, then undo                      | click a bookmark's remove action, then the undo notification                                       | the bookmark disappears, then returns to its original folder (undo appends it at the end: upstream promises only "approximately the same place")                                        | identical                                                   |
| E9  | Delete a folder, restore it from Deleted Items    | "Delete Group" in the folder menu; open `deleted-items.html`; click Restore                        | Deleted Items lists the folder (screenshot, clock); after Restore the folder and its bookmarks are back and the entry is gone                                                           | identical                                                   |
| E10 | Deleted items survive a background restart        | delete a folder; `restartBackground()`                                                             | `deleted-items.html` still lists it (IndexedDB persistence)                                                                                                                             | identical, via a service-worker stop                        |
| E11 | Rename a folder                                   | click the folder title, type, press Enter                                                          | the bookmark folder's title has changed                                                                                                                                                 | identical                                                   |
| E12 | Stashing a duplicate URL moves it                 | seed a folder with URL X; stash a tab with URL X into it                                           | still exactly one bookmark for X                                                                                                                                                        | identical                                                   |
| E13 | Search filters the stash                          | open `stash-list.html?q=<term>`                                                                    | only matching folders and bookmarks are shown; the others are hidden or marked `.no-match`; screenshot (seeded data)                                                                    | identical                                                   |
| E14 | Removing a stashed bookmark closes its hidden tab | `given.stashedThreePages`; remove one bookmark with `browser.bookmarks.remove` (as in the Library) | the matching hidden tab is closed by the background's bookmark-removal listener (`src/index.ts`, `close_removed_bookmarks`)                                                             | not applicable: whole spec is `browser: firefox`            |
| E15 | Pinned tabs are left alone                        | pin a tab; stash all; then repeat with `stash_include_pinned`                                      | the pinned tab is skipped, then included                                                                                                                                                | included tabs are closed; the rest identical                |
| E16 | Privileged URLs restore through the redirect page | seed a bookmark for `about:robots`; restore it                                                     | a tab opens at `restore.html?url=about%3Arobots`                                                                                                                                        | identical for `about:`; a `chrome:` URL would open directly |
| E17 | Options persist                                   | select `#after_stashing_tab_close` on `options.html`; reload the page                              | the radio is still selected; `storage.local` has the value; the next stash closes tabs                                                                                                  | identical                                                   |
| E18 | Alternative views render                          | open `stash-list.html?view=popup` and `?view=sidebar`                                              | each renders with `html[data-view]` set and no errors; screenshot (seeded data)                                                                                                         | popup view only                                             |

### 4. Rules every test follows

- **Drive the UI, assert on the browser.** Actions go through the page's buttons, links and inputs. State comes from `browser.bookmarks`, `browser.tabs`, `browser.sessions` and `browser.storage`. Tests read the DOM only to check what the user sees.
- **Allowed non-UI actions.** Only these may bypass the UI, and each is a stand-in for something a user does outside Tab Stash's pages:
  - `seed()`, which sets up state;
  - `browser.bookmarks.remove` in E14, as the user would in the Library;
  - `restartBackground()` in E10.
- **Don't call `the.model` to perform an action.** That tests internals. The one allowed use is waiting for it to load.
- **Never call BiDi, CDP or browser internals from a suite.** Missing capabilities go into the adapters and the driver, once.
- **Assert on errors in every test**, through `errors()`.
- **Don't encode known upstream bugs.** Scenarios that would rely on one are left out; the bug is in `TASKS.md`.
- **Screenshots supplement state checks; they never replace them.** A page can look right while the bookmarks are wrong.

### 5. Running it, and proving the baseline

**The baseline** is upstream's own code, unmodified, at a pinned commit: **`622bf3d`**, the one verified in Background. A test is trusted only once it passes there: if it fails against upstream's untouched code, the test is wrong, not Tab Stash. The golden screenshots also come from that build, so our branch is compared with how upstream actually looks. We move the pinned commit on purpose, in its own commit, after pulling upstream and regenerating the goldens.

**`bin/e2e` is the entrypoint.** It's a small shell script, separate from `bin/dev` so that `bin/dev` stays a generic Docker wrapper. It turns a few flags into the right Makefile target and environment, and runs it in the dev image through `bin/dev run`:

```
bin/e2e test --browser=firefox                        # test this checkout
bin/e2e test --browser=firefox --ref=622bf3d          # build 622bf3d, test that
bin/e2e test --browser=firefox --ref=622bf3d --update-goldens   # regenerate goldens
bin/e2e test --browser=chrome                         # the Chrome smoke test, for now
bin/e2e help
```

- **`--browser` is required.**
- **`--ref=<commit>`** checks out and builds that commit (cached per commit), then runs _this_ checkout's tests against _that_ build. Any commit works: the pinned upstream one, an older commit of ours, or a branch.
- **`--update-goldens`** requires `--ref`, so goldens can't be regenerated from uncommitted or branch changes by accident.
- **Firefox only, for now.** Both flags apply to Firefox only, because upstream has no Chrome build.
- **The Makefile targets stay the real logic,** so there's still one build system. `bin/e2e` only chooses among them.

Before and after, in the Makefile:

| Target              | Today                                         | After                                                                        |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `check-e2e`         | runs `check-e2e-chrome` + `check-e2e-firefox` | unchanged                                                                    |
| `check-e2e-chrome`  | the Chrome smoke test                         | unchanged until RFC 0001 adds the Chrome adapter                             |
| `check-e2e-firefox` | `e2e/firefox.test.cjs`                        | the runner self-test plus `e2e/tests/*/suite.cts`; the smoke test becomes E1 |
| `check-e2e-ref`     | —                                             | new: the Firefox suite against the build of `E2E_REF`                        |

```make
E2E_DIST ?= dist

check-e2e-firefox: build-dbg
	TZ=UTC E2E_BROWSER=firefox E2E_DIST=$(E2E_DIST) node --test e2e/harness/runner.test.cts e2e/tests/*/suite.cts

# Builds E2E_REF once and runs this checkout's suite against that build.  The
# cache is keyed by the resolved commit hash (a branch name can't go stale),
# lives in the bind-mounted repo so it survives between containers, and only
# counts once .e2e-built exists, so an interrupted build is redone.
check-e2e-ref:
	@test -n "$(E2E_REF)" || { echo "Set E2E_REF=<commit>" >&2; exit 1; }
	@sha="$$(git rev-parse --verify --quiet "$(E2E_REF)^{commit}")" || { \
	  echo "E2E_REF does not resolve to a commit: $(E2E_REF)" >&2; exit 1; }; \
	dir="node_modules/.cache/e2e-ref/$$sha"; \
	test -e "$$dir/.e2e-built" || ( \
	  rm -rf "$$dir" && git clone --quiet . "$$dir" && \
	  git -C "$$dir" checkout --quiet "$$sha" && \
	  $(MAKE) -C "$$dir" build-dbg && touch "$$dir/.e2e-built" ) && \
	TZ=UTC E2E_BROWSER=firefox E2E_DIST="$$dir/dist" node --test e2e/tests/*/suite.cts
```

- **The reference build is cached** per commit hash, with a completion marker. `node_modules/` is gitignored, so Prettier and git ignore the cached clone. The first build of a commit takes a few minutes (`npm clean-install`); later runs reuse it.
- **Golden screenshots:** `bin/e2e test --browser=firefox --ref=622bf3d --update-goldens` writes them from the baseline build (it sets `UPDATE_SCREENSHOTS=1`). Our branch must then match them.
  - A branch that changes Firefox's UI on purpose regenerates the affected goldens in the same PR, and the reviewer approves the image diff.
  - Nothing in RFC 0001 should change Firefox's UI, so for now the goldens are always the baseline's.
- **A test is accepted only if:**
  - it passes against the baseline (`--ref=622bf3d`), and the whole suite then passes three consecutive runs;
  - it passes against our branch (no Firefox regression);
  - its `notes` mutation check makes it fail.

## Alternatives considered

**Plain `node:test` titles, with no YAML.** `describe("E02 Stash all open tabs")` with `test("then: the three tabs are hidden …")` costs nothing: no parser, no runner, and no sentence written twice. It lost on two counts:

- **No standalone spec.** The scenario would exist only inside code, and you'd want a structured, readable spec as the source that a person or an AI agent can review without reading TypeScript.
- **No machine-read structure.** `browser`, `screenshot` and `clock` would become ad-hoc `if`s in every suite instead of keys the runner acts on.

The cost we accept is each step's sentence appearing twice, once in the YAML and once as a key in the suite. `CLAUDE.md` prefers generating derived files to duplicating them; the runner's exact-match check is what keeps that duplication safe.

**A spec object exported from `suite.cts`.** This keeps the structure without a parser. But the spec and the code share a file, so the spec is no longer a separate, reviewable artifact, and the plain English sits among the code.

**Gherkin with Cucumber.** Feature files with Given/When/Then are the established form of this idea, and our binding has the same shape. But Cucumber brings its own runner, a Gherkin parser, and a step library shared across the whole suite, where one sentence can be reused, and so changed, by many tests. Binding each spec to its own suite keeps steps local. YAML lets a step carry structure (`browser`, `screenshot`) that Gherkin puts in tags or tables.

**Tangling the tests out of the spec (literate style).** The code would live in the YAML, as a `code:` block per step, and a script would generate `suite.cts`. Spec and code could never drift. But the code would lose Prettier and real stack traces, and the plain-English spec would be buried in code.

**Extracting the spec from the tests.** `suite.cts` would be the source, with structured comments (`// then [chrome, screenshot=x]: …`) that a script turns into a readable spec. No parser is needed, but the structure would be a comment convention that nothing enforces, the opposite of what we want from YAML.

**Screenshots as the only baseline.** Pure visual regression is quick to set up, but it can't see browser state: hidden tabs, bookmark contents and storage don't show on the page.

**A screenshot diff with a tolerance** (e.g. `pixelmatch`). It's more forgiving of anti-aliasing, but it adds a dependency and a threshold to tune. It also can't fix the real source of instability, which is text (timestamps), not pixels. That is solved by the clock and locale.

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
- **The pinned date is partial.** It covers `new Date()` in the page only. `Date.now()` and browser timestamps stay real, so views showing times stamped from those can't be screenshotted deterministically. Specs that compare page time with browser timestamps can't use it either. Firefox may also not allow installing it before the first render (Open question 1).
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
  - Can the pinned date be installed before Firefox renders (Open question 1)?
  - Do exact screenshot matches hold across runs?
  - Does `js-yaml` resolve from `.cts` files?
  - Test time per test, measured to check the budget.
- **Exit criteria:** the runner self-test passes. E1, E2 and E8 pass against the baseline and against our branch, and the suite passes three consecutive runs. Each test's mutation check fails it.

**Phase B: the core scenarios** (E3–E7, E9, E11), two or three tests per PR.

- **Exit criteria:** the same as Phase A.

**Phase C: the rest** (E10, E12–E18).

- **Fallback for E10:** if `restartBackground()` can't be made reliable on Firefox (Open question 2), E10 is dropped from this RFC and noted in `TASKS.md`.
- **Exit criteria:** the same as Phase A, and the whole suite's test time is under five minutes.

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
  - **The clock pins only `new Date()`.** Freezing `Date.now()` deadlocked Tab Stash's 20 ms wait when it creates the stash folder.
  - **The driver waits before seeding.** It waits for the background to record its version, because a fresh install rewrites the local options.
  - **E8 checks the folder, not the position.** Undo appends the bookmark to its folder (`622bf3d` does too).
  - **The reference build is cached per commit hash,** with a completion marker.
  - **`js-yaml` is loaded from the global install.** The final review found the repo's unpinned copy was being used instead; the runner now loads the pinned 5.4.3 explicitly. Puppeteer wasn't affected.
  - **Screenshot steps wait for the state they show to settle.** E02 waits for the tabs to be hidden before capturing.

**After this RFC.** RFC 0001 adds the Chrome adapter, runs the specs with `browser: chrome` steps, and records a parity table. If a core scenario fails on Chrome in a way that needs architectural change, that becomes a further Chrome RFC, as RFC 0001's Rollout says.

**Rollback:** the suite is additive and fork-only. Removing `e2e/tests/`, `e2e/harness/`, `bin/e2e` and the target changes undoes it. The smoke test can be restored from git.

## Success criteria

- **Baseline:** every test passes against the pinned upstream build in Firefox, and its goldens come from that build.
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

1. **Can the Firefox adapter pin the date before an extension page first renders?** _Narrowed in Phase A._ Pinning after load is enough when the page creates the dated item after load, which was E02's case. It is not enough for Deleted Items (E9): its stored times come from `new Date()` and so are pinned, but its day headers are computed at first render. E9 therefore needs either a pin before render or a re-render after pinning. _Resolve in Phase B_, or drop E9's screenshot.
2. **Can the Firefox adapter restart the background reliably?** That's needed for E10: `browser.runtime.reload()` from a page under BiDi's temporary install, or a reinstall that keeps the profile. _Resolve in Phase C_, with the E10 fallback.
3. **Should the suite add `data-test` attributes upstream to make selectors less fragile?** _Defer_ until selector breakage is a real cost, since it touches upstream UI code.
4. **Do synthetic `MouseEvent`s with `altKey` reach the Vue handlers the same way real clicks do (E4)?** _Resolve in Phase B_, with the mutation check.

## History

- 2026-10-13 — draft
