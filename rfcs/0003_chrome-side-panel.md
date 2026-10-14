# RFC 0003: Use Chrome's side panel as Tab Stash's sidebar

- Status: draft
- Author(s): Chris Coetzee, Claude
- Date: 2026-10-14
- Links: [RFC 0001](0001_chrome-mv3-separate-manifest.md) (the Chrome MV3 build this extends); [RFC 0002](0002_firefox-baseline-e2e-suite.md) (the suite that tests it); research and probes in [research.md](0003_chrome-side-panel.d/research.md); maintainer views in [maintainer-views.md](0001_chrome-mv3-separate-manifest.d/maintainer-views.md)
- Precondition: this is new functionality. The maintainer (@josh-berry) must approve it, and AI-assisted work on it, before any implementation (`AGENTS.md`). It builds on RFC 0001, which must land first.

## Problem

On Chrome, Tab Stash has no view that stays open while the user browses. Chrome users can show the stash list only in a tab, which they must switch back to, or in the popup, which closes as soon as the active tab changes. Firefox users can keep it in the sidebar. Chrome has offered extensions a side panel (`chrome.sidePanel`) since Chrome 114 [R1], but RFC 0001 left it out of scope.

This RFC does not remove the barrier the maintainer named for a Chrome port: operations started in the popup stop when the popup closes. He has said that the bulk of the Chrome work is that popup problem, "not the sidebar" [R4]. The panel gives Chrome users a view that doesn't close on tab changes, and leaves the popup as it is.

## Background

**How Firefox's sidebar works today.**

- **Manifest.** `assets/manifest.json` declares `sidebar_action` with `default_panel: "stash-list.html?view=sidebar"`.
- **Feature check.** `options.hasSidebar()` (`src/model/options.ts:212`) returns `!!browser.sidebarAction`. It decides whether the options and setup pages offer "sidebar" (`src/options/index.vue:60`, `:89`; `src/setup/index.vue:77`, `:140`).
- **Toolbar rules.** `canBrowserActionShow()` (`:229`) refuses "sidebar" without `sidebarAction`. With `canBrowserActionStash()` (`:217`), it also enforces that a toolbar set to show the popup can't stash: once a popup is set, the browser shows it instead of firing `onClicked`. The setup page explains this rule with two notes, `setupCantShowPopupNote` (`src/setup/index.vue:49`) and `setupPopupNote` (`:114`).
- **Background.** `src/index.ts` adds the "Show Stashed Tabs in Sidebar" menu items only `if (browser.sidebarAction)` (`:154`, `:174`, `:188`), and words the "show in a tab" item to match (`:134`). The `show_sidebar_or_tab` command (`:205`) calls `sidebarAction.open()`, and opens a tab where that API is missing.

All code references are to commit `06b200f`. That commit passes the clicked tab to `show_something()` and the `show_*` commands, so Tab Stash opens in the window the user clicked in.

**Firefox allows opening the sidebar only before the handler's first `await`.** The comments at `src/index.ts:198-203` and `:283-285` say so, and `show_something()` is called synchronously for that reason. `setupPopup()` (`:368`) exists for the same rule: it sets the toolbar popup ahead of time, on every wake and every options change, because a popup can't be set and opened in the same click.

**The Chrome build replays early events.** RFC 0001 §2a added `deferredListener` (`src/util/index.ts:181`):

- **At load time.** It registers every waking listener in the service worker's first turn.
- **Before the model loads.** It queues the events that arrive during that time.
- **After the model loads.** It replays them once the handler is attached.

Chrome stops the worker after 30 seconds idle. The next click then starts it, a "cold wake", and that click is always replayed. RFC 0001 says losing the gesture on replay "costs nothing" on Chrome, because Chrome has no sidebar. This RFC makes that untrue.

**What Chrome's side panel offers** [R1]:

- **Declaring it.** The manifest key is `side_panel.default_path`, with the `sidePanel` permission (Chrome 114).
- **Opening it.** `sidePanel.open({windowId})` (Chrome 116) must be called in response to a user action.
- **Opening it from the toolbar.** `setPanelBehavior({openPanelOnActionClick: true})` makes a toolbar click open the panel without any extension code running.
- **Not available.** There is no `toggle()` [R2].

The Chrome build's minimum, Chrome 148, has every call this RFC uses.

**What we measured.** We ran the panel on Chrome for Testing 155 with an instrumented build ([research.md](0003_chrome-side-panel.d/research.md); probe rows in brackets):

- **The gesture lasts only for the event's own turn.** `open()` works when called in the toolbar's `onClicked` listener, warm (row 4) or cold (row 7). It fails after even `setTimeout(0)` (row 5), and 300 ms into a cold wake (row 8), which is when `deferredListener` replays the click.
- **Chrome can open the panel itself.** With `openPanelOnActionClick`, a toolbar click opens it warm or cold, and `onClicked` does not fire. The setting survives a worker restart (rows 9, 10).
- **The panel is an ordinary page.** It renders `stash-list.html?view=sidebar` with `data-view="sidebar"`. `windows.getCurrent()` returns its window, and `tabs.getCurrent()` returns nothing.
- **The menu path is unproven.** The e2e harness's synthetic menu click (`contextMenus.onClicked.dispatch()`) carries no gesture, so `open()` from it fails (row 6). A real menu click was not tested. Chrome's own reference calls `open()` from `contextMenus.onClicked` [R1].

**Types.** `@types/webextension-polyfill` 0.12.6 has no `sidePanel` namespace. It is generated from Firefox's schemas, and Firefox has no side panel.

## Goals

1. **Chrome users can choose the side panel** wherever Firefox users can choose the sidebar: on the setup page, in options, for the toolbar button, and for the menus.
2. **The toolbar opens the panel on every click,** warm or cold, once the option is set. The first click after a browser restart depends on Open question 6.
3. **"Show Stashed Tabs in Sidebar" from a menu opens the panel,** warm or cold, if a real menu click allows `open()` (Open question 10).
4. **Stashing from a menu still shows Tab Stash** when the user chose "sidebar" for menus: in the panel when the worker is running, and otherwise in a tab, with a logged warning.
5. **Firefox behaves exactly as before.** `assets/manifest.json` doesn't change, and the Firefox suite and the toolbar-rule unit tests pass.

## Non-goals

- **Moving work out of the popup.** Operations started in the popup still stop when it closes (see Problem).
- **A keyboard shortcut for the panel.** Firefox's `_execute_sidebar_action` stays Firefox-only (Open question 8).
- **Per-tab panels.** Tab Stash shows one stash list for the window, so it uses one global panel, not `setOptions({tabId})`.
- **Closing or toggling the panel from Tab Stash.** Firefox's code doesn't close the sidebar either, and Chrome has no `toggle()` [R2].
- **Edge and Brave.** They may work, but each has open side-panel bugs [R3]; we don't test them.

## Proposal

We reuse the sidebar's existing paths and feature checks, and teach each one about `sidePanel`. Firefox's branches stay first and unchanged. There are five changes.

### 1. Declare the panel in the generated manifest

`patch-manifest-for-chrome.js` already deletes `sidebar_action`. Before deleting it, the script copies the panel path across and adds the permission. Like the rest of the script, it throws if the key is missing:

```js
if (!manifest.sidebar_action?.default_panel) {
  throw new Error(`sidebar_action.default_panel key not found`);
}
manifest.side_panel = {default_path: manifest.sidebar_action.default_panel};
manifest.permissions.push("sidePanel");
delete manifest.sidebar_action;
```

The Firefox manifest stays the single source of the panel's page. `_execute_sidebar_action` is still dropped.

### 2. Type the namespace without casts

The maintainer asked for no `<any>` casts, and for missing types to be added to the type definitions. The `sidePanel` namespace is Chrome-only, and the upstream types are generated from Firefox's schemas, so they are unlikely to gain it (Open question 4). We add a module augmentation in `src/` that declares only the calls we use. It declares `sidePanel` as possibly `undefined`, so the compiler makes every use check for it:

```ts
import "webextension-polyfill";

declare module "webextension-polyfill" {
  namespace SidePanel {
    interface Static {
      open(options: {windowId: number}): Promise<void>;
      setPanelBehavior(behavior: {
        openPanelOnActionClick: boolean;
      }): Promise<void>;
    }
  }
  const sidePanel: SidePanel.Static | undefined;
}
```

We checked this shape with `tsc` against `@types/webextension-polyfill` 0.12.6, using the repository's `NodeNext` module settings. `browser.sidePanel.open(...)` type-checks inside `if (browser.sidePanel)` and is an error outside it.

### 3. One feature check for the choice, and the toolbar rules

`hasSidebar()` becomes the one check for "offer the sidebar", on both pages and in the menus. The inline `browser.sidebarAction` checks that mean the same thing (`src/index.ts:134`, `:154`, `:174`, `:188`) call it instead:

```ts
/** Is a sidebar supported (Firefox's sidebar or Chrome's side panel)? */
hasSidebar(): boolean {
  return !!browser.sidebarAction || !!browser.sidePanel;
}

/** Does the browser show `what` instead of running the toolbar's click
 * handler?  A popup always does.  So does Chrome's side panel, because only
 * Chrome itself can open it reliably from a toolbar click. */
toolbarShowReplacesClick(what?: ShowWhatOpt): boolean {
  return what === "popup" || (what === "sidebar" && !browser.sidebarAction);
}
```

The remaining direct checks choose between the two browsers' APIs rather than test for the feature. `browser.sidebarAction` picks Firefox's `open()` in `show_sidebar_or_tab` and Firefox's rule in `toolbarShowReplacesClick()`. `browser.sidePanel` guards the Chrome-only calls in `show_sidebar_or_tab`, `setupPopup()` and the menu callback.

On Chrome the toolbar then gets the popup's rule, because Chrome opens the panel itself and `onClicked` never runs:

- **`canBrowserActionStash()`.** The `default` branch's `browserActionShow !== "popup"` becomes `!this.toolbarShowReplacesClick(browserActionShow)`. The `"none"` case doesn't change.
- **`canBrowserActionShow()`.** It refuses "sidebar" unless `hasSidebar()`. Its `"popup"` case, which requires "don't stash", applies to any `what` for which `toolbarShowReplacesClick(what)` holds.

On Firefox both return exactly what they do today, and unit tests for both browsers show it.

**The setup page's notes.** Both popup notes would fire for the side panel too, with the wrong wording. Each gets a side-panel twin, chosen by the same condition when the cause is the panel:

| Note today                                                                                             | Shown when                                | Side-panel twin                                                       |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------- |
| `setupCantShowPopupNote`: "You can't show the popup and save tabs at the same time."                   | a stash choice is disabled                | `setupCantShowSidePanelNote`, when `browser_action_show` is "sidebar" |
| `setupPopupNote`: "To use the popup, choose 'Don't save anything to the stash'"                        | the popup choice is disabled              | `setupSidePanelNote`, under the sidebar choice when it is disabled    |
| `setupChooseShowOptionNote`, `setupChooseSaveOptionNote`: "Choose a different … option to enable this" | "don't stash" or "don't show" is disabled | none needed: the wording is already generic                           |

The options page shows no notes; it only disables choices, so it needs no change beyond `hasSidebar()`.

### 4. The toolbar: let Chrome open the panel

`setupPopup()` already runs on every wake and every options change, to keep the browser's toolbar state in step with the options. It gains one call:

```ts
const opts = model.options.sync.state;
if (browser.sidePanel) {
  await browser.sidePanel.setPanelBehavior({
    openPanelOnActionClick:
      model.options.toolbarShowReplacesClick(opts.browser_action_show) &&
      opts.browser_action_stash === "none",
  });
}
```

- **Show "sidebar", don't stash.** Chrome opens the panel on every click, including the click that wakes the worker (probe rows 9, 10).
- **Show "popup".** `setupPopup()` sets the popup, as today, and the panel behavior is off.
- **Anything else.** Both are off, and `onClicked` runs as today.

The popup and the panel behavior are therefore never set together.

- **First run.** A click with no options chosen yet still reaches `onClicked` and shows the setup page.
- **A stored "stash and show in the sidebar".** The options pages don't allow this pair on Chrome, but a stored value could still hold it. The panel behavior then stays off, so the click still stashes, and `show_something()` tries the panel as in 5a: it opens while the worker is running, and otherwise a tab opens and the warning is logged. Chrome never silently drops the user's stash.

### 5. The menus: open the panel in the click's own turn

**a. `show_sidebar_or_tab` opens the panel where there is one.** `open()` is its first call, so it runs in the event's own turn whenever `show_something()` does. If it fails, or the window is unknown, it logs why and opens a tab:

```ts
show_sidebar_or_tab: (t?: Tab) => {
  if (browser.sidebarAction) return browser.sidebarAction.open().catch(console.log);
  if (!browser.sidePanel) return commands.show_tab(t);
  const win = t?.flattenedPosition?.parent;
  const opened = win
    ? browser.sidePanel.open({windowId: win.id})
    : Promise.reject(new Error("the clicked tab's window is unknown"));
  return opened.catch(e => {
    // Chrome refuses once the click's gesture has expired, e.g. when the
    // click woke the background and was handled after the model loaded.
    console.warn("Couldn't open the side panel; opening a tab instead", e);
    return commands.show_tab(t);
  });
},
```

This makes "stash, then show in the sidebar" work when the worker is already running, and fall back to a tab when the click woke it (Goal 4). On a cold wake the handler can't do better. It doesn't know the user's `open_stash_in` choice until `storage.sync` has loaded, and by then the gesture has expired.

**b. "Show Stashed Tabs in Sidebar" opens the panel before the model loads.** This item only shows the panel, so it needs nothing from the model except the window, and the event's own `tab.windowId` gives that.

`deferredListener` gains an optional `beforeReady` callback. It runs synchronously, only for events that arrive before a handler is attached. If it returns `true`, it has taken the event. It also gets a `requeue` function to hand the event back, so a failed `open()` still reaches the handler and 5a's tab fallback:

```ts
export function deferredListener<L extends (...args: any[]) => any>(
  event: {addListener(l: L): void},
  beforeReady?: (args: Parameters<L>, requeue: () => void) => boolean,
): {handle(l: L): void} {
  let handler: L | undefined;
  const queued: Parameters<L>[] = [];
  const deliver = (args: Parameters<L>) => {
    if (handler) handler(...args);
    else queued.push(args);
  };
  event.addListener(((...args: Parameters<L>) => {
    if (handler || !beforeReady?.(args, () => deliver(args))) deliver(args);
  }) as L);
  // handle() is unchanged.
}

// src/index.ts
menuClicked: deferredListener(browser.contextMenus.onClicked, ([info, tab], requeue) => {
  // Chrome only opens the side panel during the click itself, and a click
  // that wakes the background arrives before the model has loaded.
  if (!browser.sidePanel || tab?.windowId === undefined) return false;
  if (menuCommand(info.menuItemId) !== "show_sidebar_or_tab") return false;
  browser.sidePanel.open({windowId: tab.windowId}).catch(e => {
    console.warn("Couldn't open the side panel", e);
    requeue();
  });
  return true;
}),
```

`menuCommand(id)` is the handler's existing parsing (`src/index.ts:356`), moved into a function so both places share it. It uses `String(id)`, which also replaces the handler's `<string>` cast.

- **On Firefox.** `browser.sidePanel` is missing, so every event is queued exactly as today.
- **Once the model has loaded.** On Chrome too, events go straight to the handler, and 5a opens the panel.
- **Other menu items.** They keep queuing.
- **If `open()` fails.** The event is requeued, so the handler runs and 5a opens a tab.

**Which menus carry a tab.** 5a and 5b need the clicked tab's window. The page and tab menus (`1:`) always have a tab. We have not checked whether Chrome passes one for the toolbar button's menu (`2:`); without one, both paths open a tab and log the warning. Rollout step 0 checks this.

### Before and after

| Action on Chrome                              | Today       | After, warm worker       | After, cold wake                 |
| --------------------------------------------- | ----------- | ------------------------ | -------------------------------- |
| Toolbar set to show "sidebar"                 | not offered | panel (Chrome)           | panel (Chrome)                   |
| Toolbar set to stash and show "sidebar"       | not offered | not offered              | not offered                      |
| Menu: "Show Stashed Tabs in Sidebar"          | not offered | panel (5a)\*             | panel (5b)\*                     |
| Menu: stash, with menus set to show "sidebar" | not offered | stash, then panel (5a)\* | stash, then a tab, and a warning |
| Firefox, any of the above                     | unchanged   | unchanged                | unchanged                        |

\* If a real menu click allows `open()` (Open question 10). If it doesn't, these cells become "a tab, and a warning", and the stack stops after the toolbar (see Rollout).

## Alternatives considered

**Open the panel from `onClicked`, so the toolbar can stash and show it.** This would match Firefox, where one click stashes and opens the sidebar. It works while the worker is running (probe row 4). On a cold wake the click is replayed after the model loads, and `open()` fails (row 8). The listener can't open the panel in its first turn either, because it can't yet tell whether the user chose "sidebar". So any click after 30 seconds idle would open a tab instead, unless something keeps the worker running (Open question 7). Open question 2 keeps this choice open for the maintainer.

**Stash from `sidePanel.onOpened`.** With Chrome opening the panel, the background could stash when the panel opens (Chrome 141, row 9). But `onOpened` fires for every open: from the toolbar, from a menu, and from Chrome's own side panel menu. The handler can't tell which one the user used, so it would stash when the user only wanted to look.

**Encode the "show" choice in the menu item IDs.** If the stash items had IDs such as `1:stash_all:sidebar`, the `beforeReady` callback could open the panel for them too, and Goal 4 would need no tab fallback. Menus are already rebuilt on every wake (`src/index.ts:145`), so the extra cost is smaller than it looks: a rebuild on every options change, and option state carried in menu IDs. We'd rather not tie the menus to the options this way before users show the fallback matters. Open question 3 keeps it open.

**The toolbar alone, menus unchanged.** This is the smallest change: proposals 1, 2 and 4, with no `deferredListener` change. But `hasSidebar()` also offers "sidebar" for the menus, so the menus' choice would need a second check to stay hidden. That is the inline re-checking the maintainer asks us to avoid. It remains the fallback if Open question 10 fails.

**Keep the worker alive.** Fewer cold wakes would mean fewer replayed clicks. RFC 0001 rejected keep-alive loops because Chrome advises against them, and the panel isn't a reason to revisit that.

**Leave Chrome without a panel.** This is RFC 0001's position. It keeps Chrome's toolbar and menus simple, but leaves Chrome users without a view that stays open.

## Tradeoffs and risks

- **On Chrome, a toolbar set to "sidebar" can't also stash.** Firefox users can stash and show in one click; Chrome users must choose, as with the popup. The options and setup pages say so, using the popup's existing rule and two matching notes.
- **Stashing from a menu sometimes opens a tab instead of the panel.** It happens on every cold wake: any click after 30 seconds idle, unless an open panel keeps the worker running (Open question 7). If the panel is already open in that case, the user gets a stash-list tab they didn't need. The warning in the log explains why.
- **`deferredListener` gains a Chrome-only path in shared code.** The callback is inert on Firefox, but it changes a helper every waking event goes through. Unit tests cover each branch: an event `beforeReady` takes is not replayed, one it declines is, and one it requeues is replayed.
- **A local type augmentation.** It declares two methods by hand, so the compiler can't catch a mistake in their signatures. They mirror Chrome's reference [R1], and the e2e specs exercise both.
- **The menus' panel path can't be tested automatically.** The harness's menu click has no gesture (row 6), so the suite only ever reaches 5a's fallback. Every "panel" cell for menus in the table above rests on manual checks.
- **The harness can't produce a cold toolbar click.** `clickToolbarButton()` starts a stopped worker before clicking, so the toolbar spec checks that the setting survives a worker restart, not a cold click. The cold-click evidence is probe row 10 and a manual check.
- **Chrome's menu wording changes.** With `hasSidebar()` true, Chrome's "Show Stashed Tabs" item becomes "Show Stashed Tabs in a Tab", next to the new "in Sidebar" item, as on Firefox.
- **Chromium variants have their own panel bugs.** Edge reloads the panel on tab switches and reports wrong tab IDs; Brave has had panels vanish and a crash with popup windows [R3]. Users of those browsers may file bugs that Chrome doesn't have.

## Rollout

This is a future commit stack on top of RFC 0001, after the maintainer approves it. It follows the RFC process in `CLAUDE.md`: a plan at `rfcs/0003_chrome-side-panel.d/plan.md`, then subagent-driven implementation. The feature commits end with `[new feature]`. Each commit passes `make`, and the Firefox suite passes on both the baseline and our branch.

**Step 0: manual checks before any code.** In a normal (not headless) Chrome, with an instrumented build like the probes':

- **Questions to answer:** 6 (browser restart), 9 (Chrome's own panel menu, and the install warning) and 10 (a real menu click), plus whether the toolbar button's menu passes a tab.
- **Record:** the answers go in `research.md` and this RFC.
- **Exit:** if Open question 10 fails, the stack stops after commit 3, and commit 3 keeps "sidebar" out of Chrome's menu choices (Alternatives: "The toolbar alone").

**The stack:**

1. **`docs(rfc-0001): note that Chrome's side panel needs the click's gesture`.**
   - §2a: losing the gesture on replay no longer "costs nothing" on Chrome; link this RFC.
   - The side-panel non-goal and Open question 10: point to this RFC.
2. **`feat(rfc-0003): declare Tab Stash's side panel in the Chrome manifest [new feature]`.** Proposal 1.
   - **Value.** The user can open the panel from Chrome's own side panel menu, if Chrome lists it there (Open question 9). If it doesn't, this commit is folded into the next one.
   - **Check.** `dist-chrome/manifest.json` has `side_panel.default_path` and `sidePanel`, and Chrome loads the build with no errors.
3. **`feat(rfc-0003): show Tab Stash in Chrome's side panel [new feature]`.** Proposals 2, 3, 4 and 5a, including the menus' `hasSidebar()` checks.
   - **Why together.** Widening `hasSidebar()` offers "sidebar" on both pages and adds the menu item, so everything those choices drive must work in the same commit.
   - **Unit tests.** `canBrowserActionStash`, `canBrowserActionShow` and `toolbarShowReplacesClick`, for both browsers.
   - **E2e spec, toolbar.** With the toolbar set to show the sidebar, `clickToolbarButton()` opens a page target at `stash-list.html?view=sidebar` that renders with `data-view="sidebar"`, first with the worker running and then after `restartBackground()`. Switching the toolbar to "stash all, show a tab" then makes the next click stash, so Chrome has turned the panel behavior off. Mutation: dropping the `setPanelBehavior` call fails it.
   - **E2e spec, fallback.** With menus set to show the sidebar, "Stash This Tab" through `clickTabMenuItem()` stashes the tab, opens a stash-list tab and logs the warning. The harness's click carries no gesture, so this checks only the fallback. Mutation: removing the fallback fails it.
   - **Harness.**
     - `MENU_ITEMS` (`e2e/harness/chrome.cts`) gets `1:show_sidebar_or_tab` (`showStashedTabsInSidebarMenu`), and `1:show_tab` changes to `showStashedTabsInTabMenu`. Specs that name the old label change with it.
     - On Chrome, `sidebarOpen()` looks for the panel's page target, and `closeSidebar()` calls `sidePanel.close()`, which needs no gesture (probe row 11).
   - **Manual checks.** A real right-click on "Show Stashed Tabs in Sidebar", from the page menu and the toolbar button's menu, opens the panel with the worker running.
4. **`feat(rfc-0003): open Chrome's side panel from a menu click that wakes the background [new feature]`.** Proposal 5b and `menuCommand()`.
   - **Value.** Before this commit, a menu click on a cold wake opens a tab and logs the warning. After it, the panel opens.
   - **Unit tests.** `beforeReady`: an event it takes is not replayed, one it declines is, and one it requeues is replayed.
   - **Manual check.** The same right-clicks open the panel after stopping the worker from `chrome://extensions`.
5. **`docs(rfc-0003): record the side panel results`.** The answers to the open questions resolved in implementation, and the manual checks.

Any prefix of the stack can land alone. Commit 3 is the first that changes what Chrome users see, unless commit 2 stands alone. E21 (the sidebar view in a tab) stays Firefox-only, because the toolbar spec renders the real panel.

**Rollback.** Revert the stack's `feat` commits. Firefox behaviour doesn't change at any point, as the Firefox suite and the toolbar-rule unit tests show. On Chrome, the panel behavior Chrome stored outlives the code. A developer build that rolls back should be reinstalled, or have `setPanelBehavior({openPanelOnActionClick: false})` run once. The Chrome build is developer-only (RFC 0001 Phase 4), so no user release is affected.

## Success criteria

- **Toolbar:** on Chrome, with the toolbar set to show the sidebar, a click opens the panel with the worker running, after a worker restart (the toolbar spec, three consecutive runs), and on a cold click (manual).
- **Menus:** a real click on "Show Stashed Tabs in Sidebar" opens the panel, warm and cold (manual, recorded in this RFC by commit 5).
- **Fallback:** the fallback e2e spec passes three consecutive runs, and fails with the fallback removed.
- **Options:** the unit tests show Chrome offering "sidebar" for the toolbar only with "don't stash", and Firefox's rules unchanged.
- **Firefox:** `git diff -- assets/manifest.json` is empty, and the Firefox suite passes on the baseline and our branch.
- **Code rules:** no `<any>` casts, no second manifest, and no inline sidebar checks outside the places listed in Proposal 3.

## Security, privacy, operational impact

**Security:**

- **One new permission.** The Chrome build adds `sidePanel`. We have not checked whether Chrome shows an install warning for it; step 0 records the answer. Firefox's permissions don't change.
- **No new pages or host permissions.** The panel shows the existing `stash-list.html`, under the existing content security policy.

**Privacy:** no impact. The panel reads the same local bookmarks and stores as the stash-list tab, and nothing new is sent anywhere.

**Operations:**

- **Support.** Chrome users get a new way to open Tab Stash, and a new class of reports: the panel not opening, or a tab opening instead. The warnings in the log say which.
- **Testing.** Two new Chrome-only specs, and three manual checks on the checklist.
- **Release.** No change. The Chrome build is still for developers only (RFC 0001 Phase 4).

## Open questions

**Blocking approval:**

1. **Does the maintainer want Chrome's side panel?** He has said the bulk of the Chrome work is the popup problem, "not the sidebar" [R4]. _Resolve in review_, before any implementation.
2. **Should the toolbar keep "stash and show in the sidebar" on Chrome?** The proposal lets Chrome open the panel, which is reliable but can't stash. The alternative opens it from `onClicked`, which can stash but opens a tab on cold wakes. _Resolve in review._
3. **Is the tab fallback acceptable for stashing from a menu?** The proposal opens a tab on cold wakes. The alternatives:
   - do nothing but log;
   - skip the tab when `runtime.getContexts()` shows a `SIDE_PANEL` context, though it reports no window (`windowId` is `-1`), so with several windows we can't tell which one has it;
   - encode the choice in menu IDs (Alternatives).

   Open question 7 decides how often this happens. _Resolve in review_, revisited after step 0.

4. **Local type augmentation or an upstream types change?** The maintainer asked for type fixes to go into `webextension-polyfill`'s types. Those are generated from Firefox's schemas and have no `sidePanel`. _Resolve in review._
5. **"Sidebar" or "side panel" in Chrome's strings?** Chrome calls it a side panel. The two new notes say "side panel"; the existing choices and menu items say "sidebar", which needs no new translations. _Resolve in review._

**Answered before or during implementation:**

6. **Does `openPanelOnActionClick` survive a browser restart?** It survives a worker restart (probe row 10). `setupPopup()` re-applies it once the model loads, but if Chrome forgets it, the first click after a browser restart reaches `onClicked`, is replayed without a gesture, and opens a tab. _Resolve in step 0._
7. **Does an open panel keep the worker alive?** If it does, cold-wake fallbacks become rare while the panel is open. Probe row 14 shows only that something restarted a stopped worker. RFC 0001 Open question 3 asks the same of an idle port. _Resolve in implementation._
8. **A keyboard shortcut for the panel.** We found no built-in command for an extension's side panel, and did not test whether `commands.onCommand` grants a gesture. _Defer._
9. **Does Chrome list the panel in its own side panel menu once the manifest declares it, and does `sidePanel` add an install warning?** This decides whether rollout commit 2 stands alone. _Resolve in step 0._
10. **Does a real context-menu click allow `open()`?** Chrome's reference suggests so [R1]; the harness can't check it. If it doesn't, the menus keep opening a tab. _Resolve in step 0._
11. **Edge and Brave.** _Defer_ until someone asks.

## References

External claims were checked on 2026-10-14. Third-party reports are marked as such.

- **[R1]** Chrome, `chrome.sidePanel`. https://developer.chrome.com/docs/extensions/reference/api/sidePanel
  - The manifest key `side_panel.default_path` and the `sidePanel` permission (Chrome 114, MV3).
  - `open()` (Chrome 116) must be called in response to a user action; the reference's example calls it from `contextMenus.onClicked`.
  - `setPanelBehavior` and `setOptions` (114), `getLayout` (140), `close` and `onOpened` (141), `onClosed` (142).
- **[R2]** W3C WebExtensions community group, issue 521, on a cross-browser `toggle()` for sidebars. https://github.com/w3c/webextensions/issues/521
- **[R3]** Third-party bug reports (unverified):
  - Edge: the panel reloads on tab switch, https://github.com/MicrosoftEdge/MicrosoftEdge-Extensions/issues/222; wrong tab IDs, https://github.com/MicrosoftEdge/MicrosoftEdge-Extensions/issues/278.
  - Brave: a panel that vanished, https://github.com/brave/brave-browser/issues/32132; a crash opening a panel for a tab in a popup window, https://github.com/brave/brave-browser/issues/59256.
- **[R4]** The maintainer's comments on josh-berry/tab-stash issue #52, summarised in [maintainer-views.md](0001_chrome-mv3-separate-manifest.d/maintainer-views.md): the popup closing stops operations running in it, which he calls "the single biggest barrier"; and, in March 2026, the bulk of the work is the popup problem, not the sidebar. https://github.com/josh-berry/tab-stash/issues/52
- **Probes and measurements:** [research.md](0003_chrome-side-panel.d/research.md), with the scripts and logs in [probes/](0003_chrome-side-panel.d/probes/). Chrome for Testing 155.0.8059.39, Puppeteer 25.13.0, dev image.

Code references are to commit `06b200f` on branch `chore/chriscz`:

- **Background:** `src/index.ts`
- **Options model:** `src/model/options.ts`
- **Options and setup pages:** `src/options/index.vue`, `src/setup/index.vue`
- **`deferredListener`:** `src/util/index.ts`
- **E2e harness:** `e2e/harness/chrome.cts`
- **Build:** `patch-manifest-for-chrome.js`, `assets/manifest.json`

## History

- 2026-10-14 — draft
