# Tasks

Bugs found along the way that are outside the current RFC's scope. Each one
needs the maintainer's approval (see `AGENTS.md`) before we send a fix
upstream. Fixes stay small and separate, one issue or PR per bug.

## Open bugs

### Showing the popup also opens the sidebar

- **Where:** `src/index.ts:293-297`, the `"popup"` case of `show_something()`.
- **What:** the case has no `break`, so after `commands.show_popup` it falls
  through to `case "sidebar"` and also runs `commands.show_sidebar_or_tab`.
- **Effect:** with the toolbar button set to show the popup, using a command
  that calls `show_something("popup")` (e.g. after stashing) also opens the
  sidebar on Firefox, or a stash-list tab where there is no sidebar.
- **Found:** code survey for RFC 0002, 2026-10-13. Confirmed by reading;
  not yet reproduced in a browser.
- **Fix:** add `break;` after `model.attempt(commands.show_popup);`.
- **Status:** open, not reported.

### The options page's coupling watchers never fire

- **Where:** `src/options/index.vue:527-560`, the `watch` block.
- **What:** the watchers are keyed on top-level names such as
  `browser_action_show`, but the component's `data()` only has `sync` and
  `local` (`options()`, lines 494-508). Vue never calls them.
- **Effect:** the intended couplings don't happen. For example, choosing
  "popup" for the toolbar button should set the toolbar's stash action to
  "none".
- **Found:** code survey for RFC 0002, 2026-10-13. Confirmed by reading;
  not yet reproduced in a browser.
- **Fix:** key the watchers on `"sync.browser_action_show"` etc. (or watch
  the model state directly), then check each coupling still makes sense.
- **Status:** open, not reported.

### Alt-clicking "Stash all" copies the Tab Stash page too

- **Where:** `copying()` in `src/model/index.ts`, used by `stash()` in
  `src/stash-list/window.vue`.
- **What:** `copying()` turns each tab into a plain `{title, url}`, which skips
  the `isURLStashable()` check that a move applies, so the Tab Stash page's own
  tab is copied too.
- **Effect:** copying all open tabs adds a `stash-list.html` bookmark to the
  new folder; moving them doesn't.
- **Found:** writing the end-to-end spec for copying (E4), 2026-10-13. Seen on
  622bf3d in Firefox.
- **Fix:** filter the tabs with `isURLStashable()` before copying.
- **Status:** open, not reported.

### Removing a newly stashed bookmark leaves its hidden tab open

- **Where:** `src/index.ts:477-508`, `close_removed_bookmarks` and its
  listeners.
- **What:** the background keeps `managed_urls`, the stash's URLs, and closes
  hidden tabs whose URL leaves that set. It refreshes the set only on
  `bookmarks.onChanged`, `onMoved` and `onRemoved`, not on `onCreated`. URLs
  stashed since the background started, or since the last such event, are
  not in the set.
- **Effect:** stash tabs, then delete one of the new bookmarks in Firefox's
  Library: its hidden tab stays open, hidden, with nothing in the stash to
  restore it. Hidden tabs pile up, which is what the listener exists to stop.
  Any rename, move or removal in the stash first refreshes the set, after
  which removals close tabs as intended.
- **Found:** writing the end-to-end spec for removing a stashed bookmark
  (E14), 2026-10-13. Fails on 622bf3d in Firefox: after "Stash all" of three
  pages, `browser.bookmarks.remove` on Page 1's bookmark leaves its hidden
  tab open for 30 s. Renaming Page 2's bookmark between the two makes Page 1's
  tab close.
- **Fix:** also listen to `browser.bookmarks.onCreated`, so the set includes
  new bookmarks.
- **Status:** open, not reported.

## Fixed in this fork

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
