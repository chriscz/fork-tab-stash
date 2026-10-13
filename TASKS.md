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

## Fixed in this fork

### Chrome rejects dotted plural message keys

- **Where:** `assets/_locales/{en,ru}/messages.json`, `src/util/i18n.ts`,
  `check-i18n.js`, since `8117e3d` (2026-09-05).
- **What:** keys such as `child_group.one` aren't allowed by Chrome, so the
  Chrome build didn't load at all.
- **Found:** the Chrome end-to-end test, 2026-10-13.
- **Fix:** `be0e7fc`, which uses `_` as the plural separator. Part of RFC 0001's
  stack.
