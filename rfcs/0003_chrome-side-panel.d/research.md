# Research: Chrome's side panel for Tab Stash

The evidence behind [RFC 0003](../0003_chrome-side-panel.md), gathered on
2026-10-14. It covers what Chrome documents about `chrome.sidePanel`, what we
checked by running Chrome, and how the API maps onto Tab Stash's code.

**What was run.** Chrome for Testing 155.0.8059.39 and Puppeteer 25.13.0 in the
dev image (`install-test-deps.sh`), headless, against the Chrome build of
branch `chore/chriscz`. Anything not marked _verified_ below comes from
documentation or third-party reports and was not checked.

## The API

From Chrome's reference,
<https://developer.chrome.com/docs/extensions/reference/api/sidePanel>:

| Item                                                           | Since    | Notes                                                                                                            |
| -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Manifest key `side_panel.default_path`, permission `sidePanel` | 114, MV3 | The page shown by default, in every tab.                                                                         |
| `setOptions` / `getOptions`                                    | 114      | Per-tab or global path, and `enabled`.                                                                           |
| `setPanelBehavior` / `getPanelBehavior`                        | 114      | `openPanelOnActionClick: true` makes a toolbar click open the panel.                                             |
| `open({windowId} \| {tabId})`                                  | 116      | Must be called in response to a user action. The reference's own example calls it from `contextMenus.onClicked`. |
| `getLayout`                                                    | 140      | Which side the panel is on.                                                                                      |
| `close({windowId} \| {tabId})`                                 | 141      |                                                                                                                  |
| `onOpened`                                                     | 141      |                                                                                                                  |
| `onClosed`                                                     | 142      |                                                                                                                  |

There is no `toggle()`. Browser vendors are discussing one in the WebExtensions
community group: <https://github.com/w3c/webextensions/issues/521>.

The Chrome build sets `minimum_chrome_version: "148"` (RFC 0001), so every item
above is available to it.

**Types.** `@types/webextension-polyfill` 0.12.6, the version in
`package.json`, has no `sidePanel` namespace. Those types are generated from
Firefox's API schemas, and Firefox has no `sidePanel`. _Verified_ by searching
`node_modules/@types/webextension-polyfill`.

## What we verified on Chrome

### The instrumented build

The probes load an instrumented copy of the Chrome build. That copy was not
kept, so the scripts in [`probes/`](probes/) are a historical record rather
than something to rerun as they are. From the scripts and their logs, it
differed from `make build-chrome-dbg`'s output in these ways:

- **Manifest:** `side_panel.default_path` was `stash-list.html?view=sidebar`
  (Firefox's `sidebar_action.default_panel`), and `sidePanel` was added to
  `permissions`.
- **Background:** at the top level of `index.js`, before Tab Stash's own code:
  - an `action.onClicked` listener that called
    `sidePanel.open({windowId: tab.windowId})`, either in the listener itself
    or after `setTimeout(d)` when `globalThis.__mode` was `"delay<d>"`;
  - a `contextMenus.onClicked` listener that called `sidePanel.open()` in the
    listener itself;
  - `sidePanel.onOpened` and `onClosed` listeners;
  - all of them appended results to `globalThis.__probe.log`.

Tab Stash's own handlers still ran. That is why the first toolbar click opened
`setup.html` (no toolbar options were set yet), and why the menu probe opened
a stash-list tab. `probe2.cjs` first sets both toolbar options to `"none"`, so
that Tab Stash does nothing on a toolbar click.

### Probe results

`probe1.cjs` was the first attempt, and `probe2.cjs` repeated what it got
wrong. `probe1.cjs` waited _in the test_ after the click, while the extension
still opened the panel at once, so its "open after N ms" rows say nothing
about a late `open()`. Its CDP `ServiceWorker.stopWorker` call also did not
stop the worker, so its cold-wake section timed out. Only the rows below are
evidence. ("Warm" means the service worker was running; "cold" means the
probe had stopped it and the click started it.)

| #   | Scenario                                                                                               | Result                                                                                                                                                                                    | Log                        |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | `browser.sidePanel` in the service worker                                                              | the same members as `chrome.sidePanel`, including `open`, `close`, `getLayout`, `onOpened` and `onClosed`                                                                                 | `probe1.log`               |
| 2   | Defaults                                                                                               | `getOptions({})` returns `{enabled: true, path: "stash-list.html?view=sidebar"}`; `getPanelBehavior()` returns `{openPanelOnActionClick: false}`; `getLayout()` returns `{side: "right"}` | `probe1.log`               |
| 3   | `open()` evaluated in the worker, with no event                                                        | rejected: `` `sidePanel.open()` may only be called in response to a user gesture. ``                                                                                                      | `probe1.log`               |
| 4   | Warm toolbar click, `open()` in the `onClicked` listener                                               | panel opens; `onOpened` fires with `{path: "/stash-list.html", windowId}`                                                                                                                 | `probe1.log`, `probe2.log` |
| 5   | Warm toolbar click, `open()` after `setTimeout` of 0, 50 or 500 ms                                     | rejected, same message as 3                                                                                                                                                               | `probe2.log`               |
| 6   | `contextMenus.onClicked.dispatch()` (how the e2e harness clicks a menu item), `open()` in the listener | rejected, same message as 3. `dispatch()` carries no gesture; a real menu click was not tested                                                                                            | `probe1.log`               |
| 7   | Cold toolbar click, `open()` in the top-level listener                                                 | panel opens                                                                                                                                                                               | `probe2.log`               |
| 8   | Cold toolbar click, `open()` 300 or 1500 ms later                                                      | rejected, same message as 3                                                                                                                                                               | `probe2.log`               |
| 9   | `setPanelBehavior({openPanelOnActionClick: true})`, warm toolbar click                                 | Chrome opens the panel itself; `onOpened` fires; the probe's `action.onClicked` listener does not run                                                                                     | `probe2.log`               |
| 10  | The same, cold toolbar click                                                                           | Chrome opens the panel itself; `getPanelBehavior()` in the restarted worker still returns `{openPanelOnActionClick: true}`                                                                | `probe2.log`               |
| 11  | `close({windowId})` evaluated in the worker, with no event                                             | succeeds; `onClosed` fires                                                                                                                                                                | both                       |
| 12  | `setOptions({enabled: false})`, then a warm toolbar click with `open()` in the listener                | rejected: `No active side panel for windowId: <id>`                                                                                                                                       | `probe2.log`               |
| 13  | `action.setPopup(...)` (panel behavior `false`), then a toolbar click                                  | `onClicked` does not run and no panel opens. A popup combined with `openPanelOnActionClick: true` was not tested                                                                          | `probe2.log`               |
| 14  | Worker stopped while the panel is open                                                                 | a worker target is back within 1 s. We did not check what restarted it; the panel page's `runtime.connect` to the stores is likely                                                        | `probe2.log`               |

### The panel page

_Verified_ from inside the open panel (`probe1.log`):

- **It is an ordinary page target.** Puppeteer lists it as a `page` with URL
  `chrome-extension://<id>/stash-list.html?view=sidebar`, and `asPage()` works
  on it.
- **It renders the sidebar view.** The page has `data-view="sidebar"` on
  `<html>` and a `main.stash-list`. Headless, it measured 360 × 445 pixels.
- **It has no tab.** `tabs.getCurrent()` returns `undefined`, and
  `runtime.getContexts()` reports it as `SIDE_PANEL` with `windowId` and
  `tabId` both `-1`.
- **It knows its window.** `windows.getCurrent()` returns the window the panel
  is in.

## Not verified

- **A real context-menu click.** Chrome's reference shows `open()` called from
  `contextMenus.onClicked`, so a real click should count as a user gesture.
  The harness can only `dispatch()` the event, which does not (row 6).
- **Browser restart.** Row 10 shows `openPanelOnActionClick` surviving a
  worker restart, not a browser restart.
- **Keeping the worker alive.** We don't know whether an open panel keeps the
  service worker from stopping when idle (row 14 shows only that something
  restarts it).
- **A keyboard shortcut.** We found no documented built-in command that opens
  an extension's side panel, and did not test whether `commands.onCommand`
  counts as a gesture for `open()`.
- **Chrome's own side panel menu.** We did not check whether Chrome lists the
  panel in its side panel picker once the manifest declares `default_path`.
- **Long operations.** We did not check whether a stash or restore started in
  the panel completes when the user switches tabs. Chrome documents a panel
  set without a `tabId` as staying open across tabs, unlike a popup.
- **Non-headless size and layout.**

## Other Chromium browsers

Third-party reports only. None of these was checked.

- **Microsoft Edge** supports `sidePanel`. Open reports: the panel reloads on
  tab switches
  (<https://github.com/MicrosoftEdge/MicrosoftEdge-Extensions/issues/222>) and
  reports wrong tab IDs
  (<https://github.com/MicrosoftEdge/MicrosoftEdge-Extensions/issues/278>).
- **Brave** shows extension panels in its own sidebar. Reports: a panel that
  vanished soon after opening (<https://github.com/brave/brave-browser/issues/32132>),
  and a crash when opening a panel for a tab in a popup window
  (<https://github.com/brave/brave-browser/issues/59256>).

## How this maps onto Tab Stash

References are to commit `362380c`.

| Where                                                                                    | Today                                                                                                                          | What the side panel needs                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patch-manifest-for-chrome.js`                                                           | deletes `sidebar_action` and the `_execute_sidebar_action` command                                                             | map `sidebar_action.default_panel` to `side_panel.default_path`, and add the `sidePanel` permission                                                  |
| `hasSidebar()`, `src/model/options.ts:212`                                               | `!!browser.sidebarAction`; gates the sidebar choices in `src/options/index.vue:60`, `:89` and `src/setup/index.vue:77`, `:140` | also true where `browser.sidePanel` exists                                                                                                           |
| `canBrowserActionShow()` / `canBrowserActionStash()`, `src/model/options.ts:217`, `:229` | sidebar needs `browser.sidebarAction`; only the popup rules out stashing from the toolbar                                      | on Chrome, the panel rules out stashing too, if Chrome opens it (rows 9 and 10)                                                                      |
| Menus, `src/index.ts:134`, `:154`, `:174`, `:188`                                        | the "in Sidebar" item and the "in Tab" wording are checked inline with `browser.sidebarAction`                                 | use the widened `hasSidebar()`                                                                                                                       |
| `show_sidebar_or_tab`, `src/index.ts:205`                                                | `sidebarAction.open()`, else a tab                                                                                             | `sidePanel.open({windowId})` before any `await` (rows 4 and 5), else a tab. Needs the clicked tab's window, which the RFC 0001 toolbar fix passes in |
| `setupPopup()`, `src/index.ts:368`                                                       | sets or clears the toolbar popup on each wake and each options change                                                          | also set `openPanelOnActionClick` when the toolbar shows the sidebar (rows 9 and 10)                                                                 |
| `deferredListener`, `src/util/index.ts:181`                                              | queues events that arrive before the model loads and replays them later                                                        | a replayed event has lost its gesture (rows 7 and 8), so a menu item that only shows the panel must open it while the event is first delivered       |
| `show_something()` for "stash and show", `src/index.ts:286`                              | runs after the handler's model lookups, but before its first `await`                                                           | warm: works as on Firefox. Cold: `open_stash_in` is in `storage.sync`, so it can't be read in the event's own turn                                   |

## The probes

[`probes/`](probes/) holds the two scripts and their logs. The scripts are
as run, except for a header comment on each and Prettier's formatting, and
`probe.cjs` was renamed `probe1.cjs` to match `probe1.log`.
