# Tasks

Bugs found along the way that are outside the current RFC's scope. Each one
needs the maintainer's approval (see `AGENTS.md`) before we send a fix
upstream. Fixes stay small and separate, one issue or PR per bug.

## Open bugs

### Showing the popup clears the toolbar button's popup

- **Where:** `src/index.ts`, the `finally` of `commands.show_popup`.
- **What:** `show_popup` sets the browser action's popup, opens it, and then
  sets the popup to `""` whatever `browser_action_show` says. That undoes
  `setupPopup()`, which sets the popup while `browser_action_show` is
  `"popup"` so that a toolbar click opens it natively. The clear is there
  for Chrome, where a set popup stops `browserAction.onClicked` from firing.
  After any `show_popup`, every toolbar click goes to `onClicked` instead,
  until a sync option changes and `setupPopup()` runs again. `onClicked`
  then calls `show_popup`, which calls `openPopup()` after an `await`
  (which `setupPopup()`'s own comment says Firefox doesn't allow), and
  runs `browser_action_stash`.
- **Effect:** none a user can see in the Firefox the suite runs (157.0.1).
  Its `extensions.openPopupWithoutUserGesture.enabled` defaults to `true`,
  so `openPopup()` after an `await` works, and `browser_action_stash` is
  always `"none"` while the toolbar shows the popup (`canBrowserActionShow()`
  in `src/model/options.ts`). Chrome's `action.openPopup()` needs no gesture
  either, so by reading it behaves the same. Where that pref is `false`, the
  button stops opening the popup after the clear, but there the menu command
  that clears it doesn't open the popup either. Reaching `show_popup` at all needs
  `open_stash_in` set to `"popup"`, which no release offers (see "Showing
  the popup also opens the sidebar" below).
- **Found:** review of the fix for "Showing the popup also opens the
  sidebar", 2026-10-14. Probed in Firefox 157.0.1 with both options set to
  `"popup"`: before the menu command `browserAction.getPopup({})` returned
  the popup's URL; after "Stash This Tab" from a tab's context menu it
  returned `""`. Later toolbar clicks (through the browser action's
  `triggerAction`, as Firefox's own button and shortcut do) still showed the
  popup through `onClicked`, kept the sidebar closed, left the tabs alone and
  logged no errors, the same as before the menu command. With the pref set
  to `false`, neither the menu command nor later toolbar clicks showed the
  popup, and nothing was logged.
- **Fix:** not yet. `show_popup`'s `finally` could restore what
  `setupPopup()` wants (the popup's URL while `browser_action_show` is
  `"popup"`, otherwise `""`) instead of always clearing it.

## Feature requests

### Restore nested folders as their own tab groups

- **What:** when a stashed folder holds sub-folders, restoring it (or
  Shift-restoring it into a tab group) could open each sub-folder as its own
  tab group, named after the sub-folder.
- **Why:** it keeps the stash's structure when tabs come back, on browsers
  with tab groups.
- **Today:** "Stash all" saves each open tab group as a sub-folder named after
  it. Restoring the parent folder opens only its direct bookmarks and skips
  the sub-folders, with or without Shift, on Chrome and Firefox alike
  (`restoreAll()` and `restoreAndRemove()` pass `leafChildren` to
  `restoreTabs()`, `src/stash-list/folder.vue`). Upstream `622bf3d` does the
  same, and it looks deliberate: restore-and-remove's tooltip changes when a
  folder has sub-folders. Restoring a sub-folder on its own with Shift does
  recreate its group, without its colour, which bookmarks don't store.
- **Starting point:** `putItemsInWindow()` already turns a folder into a tab
  group and its sub-folders into neighbouring groups titled "Parent > Sub"
  (`createTreeInWindow` in `src/model/index.ts`).
- **Requested:** by the user while testing tab groups on Chrome, 2026-10-14.
- **Status:** not started. It's new functionality, so its commit ends with
  `[new feature]`, and the maintainer's approval comes first.

### Copy when dragging with Ctrl held

- **What:** dragging tabs, bookmarks or tab groups on the stash list with Ctrl
  held (Option on macOS) shows a "copy" cursor, and dropping copies them
  instead of moving them.
- **Today:** part of this exists. Drags allow both copy and move
  (`effectAllowed = "copyMove"` in `src/stash-list/dnd-proto.ts`), and a drop
  whose `dropEffect` is `"copy"` copies the items. Whether the browser
  reports "copy" for a Ctrl-drag, shows the copy cursor, and copies tab groups
  as well hasn't been checked; the gap may be small.
- **Requested:** by the user, 2026-10-14.
- **Status:** not started; check what's missing first. If it needs new
  behaviour, the commit ends with `[new feature]`.

## Fixed in this fork

### Chrome's Errors page loses where an error was raised

- **Where:** `src/util/oops.ts`, `logError()`.
- **What:** `logError()` logged an error with `console.error(error)`. For an
  error object, Chrome's extension Errors page (`chrome://extensions`) keeps
  only the error's message and the frame of the `console.error()` call, not
  the error's own stack.
- **Effect:** every error Tab Stash logs on Chrome shows on the Errors page
  as coming from the same line in `logError()`, so the page doesn't say
  where the error was raised. Upstream `622bf3d` has the same code.
- **Found:** investigating the user's report of "No target window" on Chrome
  and Brave, 2026-10-14. Reading the Errors page's entries through
  `chrome.developerPrivate.getExtensionInfo()` showed only the message and
  `index.js` line 3399 (the bundled `console.error()` call).
- **Fix:** this commit, which also logs the error's stack as text, so the
  Errors page entry carries the frames. The error object is still logged
  first, so consoles that show it as an object keep doing so.

### Showing Tab Stash fails once focus leaves the browser

- **Where:** `src/index.ts`, `commands.show_tab` and `show_setup_page()`,
  through `Model.restoreTabs()` in `src/model/index.ts`.
- **What:** the commands that show Tab Stash from the background (the
  toolbar button, the tab and page menus, the address bar's page action and
  the first-run setup page) opened it with `restoreTabs()`, which always
  used the tab model's `targetWindow`. In the background that is the window
  that last had focus, and it becomes `undefined` when the browser sends
  `windows.onFocusChanged` with `WINDOW_ID_NONE`, e.g. when focus moves to
  DevTools or another app. The clicked tab's window was never used.
- **Effect:** after focus has left the browser, "Show Stashed Tabs" and a
  toolbar button set to show a tab do nothing, and the background logs
  `Error: No target window; not sure where to restore tabs`, until a window
  gets focus again. Upstream `622bf3d` has the same code. By reading,
  Firefox is affected the same way where it sends `WINDOW_ID_NONE`, but
  closing a second window in headless Firefox gives the first window focus
  again, so it wasn't reproduced there.
- **Found:** reported by the user on Chrome and Brave, 2026-10-14, with the
  stack `src/index.ts:357` (the toolbar's `onClicked`) → `show_tab`
  (`:225`) → `restoreTabs` (`src/model/index.ts:723`). Reproduced in
  headless Chrome by opening a second window and closing it, after which
  Chrome reports `WINDOW_ID_NONE` and gives no window focus.
- **Fix:** this commit, which gives `restoreTabs()` a `toWindow` option and
  has those commands pass the window of the tab the user clicked from. E24
  checks the toolbar button on Chrome, and E25 the tab menu's "Show
  Stashed Tabs".

### Showing Tab Stash still fails when the click names no known tab

- **Where:** `Model.restoreTabs()` in `src/model/index.ts`, called from the
  menu handler in `src/index.ts`.
- **What:** the fix above uses the window of the clicked tab, but a click
  can name no tab the model knows. The toolbar button's right-click menu on
  Chrome may pass no tab, and right after the service worker wakes, the
  model may not have loaded the clicked tab yet. `restoreTabs()` then fell
  back to `targetWindow`, which is `undefined` once focus has left the
  browser. The menu handler also logged the failure with `console.log`, so
  it never reached Tab Stash's error log or its crash notification.
- **Effect:** in those cases "Show Stashed Tabs" does nothing and the
  background logs
  `Error: No target window; not sure where to restore tabs`. Upstream `622bf3d` has the same code (`restoreTabs()` uses only
  `targetWindow`, and the menu handler ends in `.catch(console.log)`).
- **Found:** reviewing the fix above, 2026-10-14.
- **Fix:** this commit. When neither the caller nor the model names a
  window, `restoreTabs()` asks the browser for the last focused window, and
  fails as before only if the model doesn't know that one either. Menu
  failures now go through `logError()`.

### Reloading the tab model loses the focused window

- **Where:** `src/model/tabs.ts`, `Model.reload()`.
- **What:** `reload()` set `focusedWindow` to the bare window ID. Only
  `whenWindowCreated()` swaps the ID for the `Window` object, and it doesn't
  run again for a window already in the model, so `targetWindow` stayed
  `undefined`.
- **Effect:** after Tab Stash recovers from an error by reloading, it has no
  target window, so commands that show Tab Stash from the background fail
  until the focus changes. Upstream `622bf3d` has the same code.
- **Found:** debugging the Chrome toolbar and tab menu bugs found by hand,
  2026-10-14.
- **Fix:** this commit, which uses the model's `Window` when it already has one.

### Chrome rejects dotted plural message keys

- **Where:** `assets/_locales/{en,ru}/messages.json`, `src/util/i18n.ts`,
  `check-i18n.js`, since `8117e3d` (2026-09-05).
- **What:** keys such as `child_group.one` aren't allowed by Chrome, so the
  Chrome build didn't load at all.
- **Found:** the Chrome end-to-end test, 2026-10-13.
- **Fix:** `be0e7fc`, which uses `_` as the plural separator. Part of RFC 0001's
  stack.

### Chrome refuses to open tabs when restoring

- **Where:** `src/model/tabs.ts`, `Model.create()`.
- **What:** the options passed to `browser.tabs.create` always had a
  `cookieStoreId` key, `undefined` when no container was chosen. Chrome
  rejects keys it doesn't know even when they're undefined
  (`Unexpected property: 'cookieStoreId'`).
- **Effect:** on Chrome, restoring a bookmark or folder opened nothing.
  Firefox ignored the empty key. Upstream `622bf3d` has the same code.
- **Found:** the Chrome end-to-end run of E06, E07 and E16, 2026-10-14.
- **Fix:** `a962957`, which leaves the key out when it's undefined.

### Stashing skips a position for every tab it leaves out

- **Where:** `src/model/index.ts`, the loop in `Model.putItemsInFolder()`.
- **What:** the insertion index advanced for every item, including the ones
  the loop skips (hidden or unstashable tabs, empty tab groups).
- **Effect:** on Chrome, "Stash all" did nothing: it skips the Tab Stash page,
  so the first bookmark went to index 1 of an empty folder, which Chrome
  rejects (`Index out of bounds.`). On Firefox, which clamps the index,
  stashing at a chosen position in a non-empty folder (e.g. dragging a
  selection that includes an unstashable tab) put the items one place too
  late per skipped tab. Upstream `622bf3d` has the same code.
- **Found:** the Chrome end-to-end run of E02, E05, E15 and E20, 2026-10-14.
- **Fix:** `935731c`, which advances the index only when an item is placed.

### A deleted-items unit test fails about once in a thousand runs

- **Where:** `src/model/deleted-items.test.ts`, "only loads new items that
  match the applied filter" and "loads only items which match the applied
  filter".
- **What:** each test fills deleted items with `makeFakeData_testonly(50)`,
  whose titles are three random words out of 22, then expects at least one
  top-level title to contain "cat". With no title containing it (about
  (21/22)^150, roughly 0.1%), `expected +0 to be above +0` fails.
- **Effect:** `make` fails now and then for no reason; a rerun passes.
  Upstream `622bf3d` has the same tests.
- **Found:** `bin/dev run make` while adding E7, E9 and E19, 2026-10-13. One
  failure, then 625 passing on the rerun. The second test turned up while
  proving the fix, with "cat" taken out of the word list.
- **Fix:** this commit's fix, which adds one item titled "Black cat" before the
  random data in both tests.

### Stashing with nothing to stash creates an empty folder

- **Where:** `Model.stashAllTabsInWindow()` in `src/model/index.ts` (the
  toolbar button and the tab menus' "stash all" items, and a folder's
  "stash to a new child folder"), and `stash()` in
  `src/stash-list/window.vue` (the stash list's own "Stash all").
- **What:** both checked that the list of tabs to stash wasn't empty and
  then created the folder, but the list still held tabs
  `putItemsInFolder()` skips: the Tab Stash page's own tab, hidden tabs, and
  tab groups holding only those. Pinned tabs are left out by default, so a
  window with only pinned tabs and the Tab Stash page had nothing to stash
  but still got a folder. Upstream `622bf3d` has the same code.
- **Effect:** clicking the toolbar button (set to stash all) or "Stash all"
  in such a window adds a new, empty folder to the stash.
- **Found:** reported by the user, 2026-10-14: with only pinned tabs and the
  Tab Stash page open, the toolbar button made an empty folder. Reproduced
  with E26 in Firefox and Chrome, and with the stash list's "Stash all" in
  Firefox; each made one empty `saved-…` folder.
- **Fix:** this commit, which adds `Model.isItemStashable()` (a tab
  `putItemsInFolder()` would stash, or a group holding one) and has both
  skip the stash when no item passes it. E26 checks the toolbar button.

### Stashing a tab group with nothing stashable creates an empty folder

- **Where:** `stash()` in `src/stash-list/tab-group.vue` (a tab group's
  stash action in the stash list's open-tabs section).
- **What:** it created a folder named after the group and then passed the
  group's stashable tabs to `putItemsInFolder()`, without checking that
  there were any. Upstream `622bf3d` has the same code.
- **Effect:** stashing a group whose tabs are all hidden or unstashable
  (e.g. a group holding only the Tab Stash page) adds a new, empty folder to
  the stash.
- **Found:** review of the "nothing to stash" fix, 2026-10-14. Reproduced
  with E27 in Firefox and Chrome; each made one empty folder named after
  the group.
- **Fix:** this commit, which returns before creating the folder when no
  tab in the group can be stashed, and has `stashableTabsIn()` use
  `Model.isTabStashable()` so it skips exactly what `putItemsInFolder()`
  skips. E27 checks it.

### Alt-clicking "Stash all" copies the Tab Stash page too

- **Where:** `copying()` in `src/model/index.ts`, used by `stash()` in
  `src/stash-list/window.vue`, `stash()` in `src/stash-list/folder.vue` and
  `Model.stashAllTabsInWindow()`.
- **What:** `copying()` turns each tab into a plain `{title, url}`, which
  `putItemsInFolder()` can't tell apart from an item it should keep, so the
  tabs a move skips (the Tab Stash page's own tab, and hidden tabs) were
  copied too. Upstream `622bf3d` has the same code.
- **Effect:** copying all open tabs added a `stash-list.html` bookmark to the
  new folder, and in Firefox a bookmark for every hidden tab in the window;
  moving them doesn't.
- **Found:** writing the end-to-end spec for copying (E4), 2026-10-13. Seen on
  622bf3d in Firefox. The hidden tabs turned up while fixing it, by reading
  upstream `61d6316`, which moved the filtering into `putItemsInFolder()`;
  not reproduced in a browser.
- **Fix:** this commit's fix, which adds `Model.copyIfStashable()`: it leaves
  out the tabs `putItemsInFolder()` would skip (`Model.isTabStashable()`,
  now shared with it) before copying. E04 checks the folder's full contents.
  Copying a tab group still copies its hidden or unstashable children, since
  `copyIfStashable()` filters only top-level tabs.

### Removing a newly stashed bookmark leaves its hidden tab open

- **Where:** `src/index.ts`, `close_removed_bookmarks` and its listeners.
- **What:** the background keeps `managed_urls`, the stash's URLs, and closes
  hidden tabs whose URL leaves that set. It refreshed the set only on
  `bookmarks.onChanged`, `onMoved` and `onRemoved`, not on `onCreated`. URLs
  stashed since the background started, or since the last such event, were
  not in the set.
- **Effect:** stash tabs, then delete one of the new bookmarks in Firefox's
  Library: its hidden tab stayed open, hidden, with nothing in the stash to
  restore it. Hidden tabs pile up, which is what the listener exists to stop.
  Any rename, move or removal in the stash first refreshes the set, after
  which removals close tabs as intended.
- **Found:** writing the end-to-end spec for removing a stashed bookmark
  (E14), 2026-10-13. Fails on 622bf3d in Firefox: after "Stash all" of three
  pages, `browser.bookmarks.remove` on Page 1's bookmark leaves its hidden
  tab open for 30 s. Renaming Page 2's bookmark between the two makes Page 1's
  tab close.
- **Fix:** this commit's fix, which also runs `close_removed_bookmarks` on
  `browser.bookmarks.onCreated`, so the set includes new bookmarks. E14
  checks it.

### The options page's coupling watchers never fire

- **Where:** `src/options/index.vue`, the `watch` block.
- **What:** the watchers were keyed on top-level names such as
  `browser_action_show`, but the component's `data()` only has `sync` and
  `local`, so Vue never called them. They have been dead since `cd4b51f`
  (2022-11), which moved the data into `sync` and `local`.
- **Effect:** none a user can see. `552a485` and `1ed0f4d` disable the
  options that would trigger each coupling (`canBrowserActionStash()` and
  `canBrowserActionShow()` in `src/model/options.ts`), so the page can't
  reach the inconsistent states the watchers were written to fix.
- **Found:** code survey for RFC 0002, 2026-10-13. Confirmed in Firefox:
  forcing each trigger value through script left the other setting
  unchanged, and each trigger option is disabled on the page.
- **Fix:** this commit, which removes the dead watchers. E22 checks the
  rule that made them redundant.

### Showing the popup also opens the sidebar

- **Where:** `src/index.ts`, the `"popup"` case of `show_something()`
  (`src/index.ts:295`).
- **What:** the case had no `break`, so after `commands.show_popup` it fell
  through to `case "sidebar"` and also ran `commands.show_sidebar_or_tab`.
- **Effect:** wherever `show_something("popup")` runs, Firefox shows the popup
  and opens the sidebar. Chrome has no sidebar, so by reading it opens a
  stash-list tab instead. It runs for a menu command, or a click on the
  address bar's page action (which runs the same `stash_one` command), when
  `open_stash_in` is `"popup"`, and for a toolbar click when
  `browser_action_show` is `"popup"` but the button has no popup set. No release offers `"popup"` for `open_stash_in`
  (only development builds between `1e578cd` and `9a8922a`, February 2021),
  but the model still honours a stored value. The button loses its popup
  because `show_popup` clears it after opening the popup, so once a command
  has shown it, every toolbar click opens the sidebar too, until an option
  changes. A click before the background sets the popup at startup should do
  the same; that was found by reading, not reproduced.
- **Found:** code survey for RFC 0002, 2026-10-13. Reproduced in Firefox
  2026-10-14: with both options set to `"popup"`, "Stash This Tab" from a
  tab's context menu showed the popup and opened the sidebar, and later
  toolbar clicks did the same.
- **Fix:** this commit's fix, which adds the missing `break;`. E23 checks it.
