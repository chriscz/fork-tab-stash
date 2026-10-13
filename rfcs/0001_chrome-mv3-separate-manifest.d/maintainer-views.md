# Maintainer views on a Chrome port

What @josh-berry has said about porting Tab Stash to Chrome, from the Chrome
port issue ([#52](https://github.com/josh-berry/tab-stash/issues/52),
2020–2026) and his review of the closed Chrome MV3 PR
([#711](https://github.com/josh-berry/tab-stash/pull/711), July 2026). RFC 0001
and its plan should be read against these. His general preferences for how
changes are made are in `CLAUDE.md`.

## The port as a whole (#52)

- **The real barrier is popups, not MV3 or the sidebar.** In Chrome, a popup
  closes as soon as the active tab changes, which stops any operation still
  running in it (e.g. "stash all open tabs"). Reliable Chrome support means
  moving all tab, window and bookmark changes out of the UI into the
  background, through new NanoServices and refactored models. He calls this
  "the single biggest barrier" and doesn't think LLMs can do this kind of
  "subtle, far-reaching" rework.
- **He wants the popup view kept.** Dropping it would lower the technical bar,
  but he sees the choice of UI views as part of what makes Tab Stash special.
- **Chrome lacks features Tab Stash relies on.** There are no hidden tabs, so
  use cases like stashing a tab that keeps playing music can't work. A sidebar
  was unavailable when he wrote this; Chrome has since added `sidePanel`, but
  he said in March 2026 that the bulk of the work is the popup problem, not
  the sidebar.
- **He prefers small, independent PRs towards Chrome compatibility.** Examples
  he gave: moving to Manifest V3, making `browser.*` usage work on both
  browsers (or finding approaches that work on both), and small cross-browser
  fixes such as styling or layout. Frame work as one of these steps, not as
  "Chrome support".
- **Test thoroughly before sending a PR.** He warns that MV3 has "subtle
  differences that could cause unpredictable breakage".
- **Check for semantic differences between the browsers' APIs** (bookmarks in
  particular), and check that the UI renders correctly in Chrome on Windows,
  macOS and Linux.
- **A full port is an ongoing commitment.** He'll merge it, help, and handle
  release and publishing only if someone commits to maintaining it and works
  closely with him from the start. He is a Firefox user and doesn't run Chrome
  day to day, so he can't offer the same quality and support there himself.
- **Until then, the Chrome build is unsupported.** He has told users not to
  trust it with data they care about.

## Chrome-specific review points (#711)

- **Extend the Chrome code that already exists.** The codebase already has
  Chrome-friendly code, including a Chrome build. PR #711 was criticised for
  missing it and building parallel paths.
- **Generate the Chrome manifest.** He wants it generated from
  `assets/manifest.json` by a small Node script that reads, mutates and emits
  the JSON, as `patch-manifest-for-chrome.js` does, so permission changes carry
  over to Chrome without anyone updating a second file.
- **Patch Chrome tab-opening into the existing Chrome-specific branch** in
  `src/model/tabs.ts` instead of adding a new check, and keep its
  `_loading_queue` protection so opening many tabs at once doesn't bog the
  machine down.
- **Keep the existing privileged-URL handling** (which already covers `file:`
  URLs) rather than blocking such URLs on Chrome.
- **Keep warnings that Chrome triggers more often**, such as unknown-tab
  `onUpdated` events.
- **Don't skip `navigator.storage.persist()` on Chrome** without showing that
  saved deleted items stay safe.
