# Toolbar and Menu Fixes Found in Manual Chrome Checks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs the user found clicking Tab Stash's toolbar button and menus on Chrome and Brave, each with a test, and give the e2e suite the toolbar and tab-menu clicks it was missing on Chrome.

**Architecture:** Two driver methods reach the real handlers: `clickToolbarButton()` and the existing `clickTabMenuItem(url, label)`, now on Chrome too. Firefox clicks through its add-on manager internals in the chrome context; Chrome uses CDP's experimental `Extensions.triggerAction` (`page.triggerExtensionAction`) and the service worker's `contextMenus.onClicked.dispatch`. The fixes then land one per commit, each with its test.

**Tech Stack:** as RFC 0002: node:test `.cts` suites, Puppeteer 25.13.0, Chrome for Testing 155, Firefox 157.0.1, mocha unit tests, the dev image.

**Spec:** [RFC 0001](../0001_chrome-mv3-separate-manifest.md) Phase 3 (the manual checks: toolbar button, context menus) and [RFC 0002](../0002_firefox-baseline-e2e-suite.md)'s rules, including "Specs for upstream bugs this fork fixes". Evidence (kept outside the repo): reproduction scripts, logs and a tested patch, `proposed-fix.diff`.

## Global Constraints

- Commits: Conventional Commits, scope `rfc-0001`. A fix for a bug that already existed upstream ends its subject with `[pre-existing]`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A fix that changes what the user sees comes with an e2e spec (with `upstream-bug: <TASKS.md heading>` when it can't pass on `622bf3d`); otherwise a unit regression test. The test fails without the fix.
- Each bug is recorded in `TASKS.md`; its fix commit moves it to "Fixed in this fork".
- Fix at the source, minimally; Firefox behaviour changes only where it was wrong.
- Browser internals stay in the adapters; suites stay neutral (`grep -rE "connection\.send|Services\.|gBrowser|page\.|worker\." e2e/tests` prints nothing).
- Every commit: `bin/dev run make` exits 0; `bin/e2e test --browser=firefox` and `--browser=chrome` all pass; `bin/e2e test --browser=firefox --ref=622bf3d` exits 0 (upstream-bug specs as todo). Never push, amend or rebase. No RFC references in code.
- Tests click only after the model has loaded (a toolbar click within ~250 ms of install is dropped).

## Commit stack

| Task | Commit                                                                                   |
| ---- | ---------------------------------------------------------------------------------------- |
| 1    | `test(rfc-0001): click the toolbar button and tab menus on both browsers`                |
| 2    | `fix(rfc-0001): keep the focused window when the tab model reloads [pre-existing]`       |
| 3    | `fix(rfc-0001): show Tab Stash in the window the user clicked in [pre-existing]`         |
| 4    | `fix(rfc-0001): log errors with their stack [pre-existing]`                              |
| 5    | `fix(rfc-0001): don't create an empty folder when nothing can be stashed [pre-existing]` |

---

### Task 1: Toolbar and tab-menu clicks on both browsers

**Files:** `e2e/harness/{driver,firefox,chrome}.cts`, RFC 0002's driver table and "Allowed non-UI actions".

- [ ] `h.clickToolbarButton()`: clicks Tab Stash's toolbar button in the test's window as a user would. Firefox: from the chrome context, `ExtensionParent.apiManager.global.browserActionFor(ext).triggerAction(window)` (what Firefox's own `_execute_browser_action` uses; `onClicked` runs as user input). Chrome: `page.triggerExtensionAction(ext)` with `ext` from `(await browser.extensions()).get(id)` (fires the real `action.onClicked` with the page's tab and wakes a stopped worker). Document both in comments.
- [ ] `h.clickTabMenuItem(url, label)` on Chrome: evaluate `chrome.contextMenus.onClicked.dispatch(info, tab)` in the service worker with the menu item's id (read how `src/index.ts` creates menus and their ids) and the tab for `url`; wake the worker first if it's stopped. Note in a comment that this is undocumented and skips Chrome's own menu UI.
- [ ] Prove each with a throwaway spec (deleted afterwards): on both browsers a toolbar click with the default options (show tab, stash none or as seeded) does what the options say; a tab-menu "Show Stashed Tabs" opens the stash list.
- [ ] Update RFC 0002's driver table and "Allowed non-UI actions" (`clickToolbarButton()` as the user clicking the button).

### Task 2: [pre-existing] Keep the focused window when the tab model reloads

**Bug:** `reload()` (`src/model/tabs.ts` ~287) sets `focusedWindow` to a bare window ID; only `whenWindowCreated()` swaps the ID for the `Window` object, and it doesn't run again for a window already in the model. `targetWindow` needs an object, so after an error-recovery reload it stays `undefined` and every "show" fails. No visible effect on its own beyond Task 3's symptom, so a unit test.

- [ ] Add the `TASKS.md` entry (open) — or add it directly to "Fixed in this fork" in the fix commit.
- [ ] Unit test in `src/model/tabs.test.ts`: after `reload()` with the current window already in the model, `targetWindow.value` is that `Window` object. Fails first.
- [ ] Fix: `this.focusedWindow.value = this.window(cur_win.id!) ?? (cur_win.id as WindowID);` with a short why-comment.

### Task 3: [pre-existing] Show Tab Stash in the window the user clicked in

**Bug:** commands that show Tab Stash from the background (toolbar button, tab menus, page action, first-run setup) open it in `targetWindow`, which in the background is only the last focused window and becomes `undefined` when focus leaves the browser (`WINDOW_ID_NONE`, e.g. to DevTools or another app). Then "Show Stashed Tabs" does nothing and logs `Error: No target window; not sure where to restore tabs` (user's stack: `src/index.ts:357` → `show_tab` `:225` → `restoreTabs` `src/model/index.ts:723`). Visible, so an e2e spec.

- [ ] Spec E24 (both browsers if the focus loss can be produced on Firefox, else `browser: chrome`; `upstream-bug: <TASKS.md heading>`): given a second window was opened and closed (Chrome then reports focus `-1`; verify on Firefox), when the user clicks the toolbar button (options: show a tab) or picks "Show Stashed Tabs" from the tab menu, then a stash-list tab opens in the user's window and no error is logged. Fails before the fix.
- [ ] Fix (as tested in `proposed-fix.diff`): `restoreTabs` gains `toWindow?: Tabs.Window` (`options.toWindow ?? this.tabs.targetWindow.value`); `show_tab`, `show_setup_page`, `show_sidebar_or_tab` and `show_something` take the clicked tab and pass `tab?.flattenedPosition?.parent`; the toolbar, page-action and menu handlers pass the model's tab.
- [ ] Add RFC 0002's catalogue row for E24.

### Task 4: [pre-existing] Log errors with their stack

**Bug:** `logError` (`src/util/oops.ts` ~30) calls `console.error(error)`. Chrome's extension Errors page records only the message and the logger's own frame, so the raising site is lost there. No UI change, so a unit test.

- [ ] Unit test: `logError(new Error("x"))` passes the error's stack text to `console.error` (stub it). Fails first.
- [ ] Fix: log the stack text as well as the object (keep the object, so Firefox's object view isn't lost), e.g. `console.error(error, error instanceof Error ? error.stack : "")` — choose the form whose Chrome Errors entry carries the frames (verify as in `stack-fix.log`).

### Task 5: [pre-existing] Don't create an empty folder when nothing can be stashed

**Bug (user report):** with only pinned tabs and the Tab Stash page open, clicking the toolbar button (stash "all") creates a new, empty folder. `stashAllTabsInWindow` (`src/model/index.ts` ~553) checks `stashableItemsInWindow(window).length === 0`, but that list still holds tabs `putItemsInFolder` later drops (the Tab Stash page, hidden tabs), so the folder is created and stays empty. Same at `622bf3d`. Visible, so an e2e spec.

- [ ] Reproduce first (both browsers) and confirm the cause.
- [ ] Spec E25 (both browsers, `upstream-bug: <TASKS.md heading>`): given the toolbar is set to stash all and the window holds only a pinned page and the Tab Stash page, when the user clicks the toolbar button, then no new folder appears in the stash. Positive control: the stash is unchanged and no error is logged. Fails before the fix.
- [ ] Fix at the source: filter with `isTabStashable` (Phase D's helper) before the emptiness check, so nothing is created when nothing would be stashed. Check the page's own "Stash all" (`window.vue`) for the same.
- [ ] Add RFC 0002's catalogue row for E25.

---

## Deviations

- **E25** was added for the tab menu's "Show Stashed Tabs" route. Like E24, it is Chrome-only.
- **A further fix:** when no window is known, `restoreTabs()` falls back to the browser's last focused window, and menu errors go through `logError()`.
- **The empty-folder spec** became E26, not E25.
- **Two related empty-folder bugs** were fixed: stashing a tab group (E27), and "Stash This Tab to a New Group" on the Tab Stash tab (E28).
- **Firefox's `clickTabMenuItem()`** acted on the selected tab rather than the one the test named, until `6a55155`.
- **E28 gained a positive control** in `f1de8a5`, which proves its menu click reaches the background.
