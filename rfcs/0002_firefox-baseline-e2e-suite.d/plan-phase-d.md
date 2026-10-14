# Phase D: Fixing the Upstream Bugs in TASKS.md — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every open bug in `TASKS.md`, each in its own `[pre-existing]` commit, proven by an end-to-end spec when the user can see the difference and by a unit regression test otherwise.

**Architecture:** The runner first learns a top-level `upstream-bug:` spec key: such a spec runs as a node:test _todo_ on reference builds (it can't pass on `622bf3d`) and as a normal test on our branch. Each fix then lands with its test, moves its `TASKS.md` entry to "Fixed in this fork", and records in the spec's notes where it fails on `622bf3d`.

**Tech Stack:** as RFC 0002: node:test `.cts` suites, Puppeteer 25.13.0, Firefox 157.0.1, Chrome for Testing 155, the dev Docker image (`bin/dev`, `bin/e2e`), mocha unit tests via `bin/dev run make`.

**Spec:** [RFC 0002](../0002_firefox-baseline-e2e-suite.md), "Specs for upstream bugs this fork fixes" (Rules) and "Phase D" (Rollout), commit `f4bfbd0`. Bugs: [`TASKS.md`](../../TASKS.md), "Open bugs".

## Global Constraints

- **Subjects:** every fix of a bug that exists on upstream `622bf3d` ends with `[pre-existing]`: `fix(rfc-0002): … [pre-existing]` (or `test(rfc-0002): … [pre-existing]` for a test-only fix). Other commits use `test(rfc-0002): …` / `docs(rfc-0002): …`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** a fix that changes what the user sees comes with an e2e spec (new, or an existing one extended) carrying `upstream-bug: <TASKS.md heading>`. A fix with no visible effect comes with a unit regression test. The test fails without the fix (verify by reverting the fix) and passes with it.
- **Each fix commit** also moves its `TASKS.md` entry from "Open bugs" to "Fixed in this fork", with `Fix:` describing the change (the commit's own SHA can't be named in itself; say "this commit's fix" or leave the SHA for Task 7).
- **Fix at the source,** minimally, in the style of the surrounding code. Firefox and Chrome behaviour change only where the bug was.
- **Gerrit-style stack:** each commit builds, passes `bin/dev run make`, and stands alone. Never push, amend or rebase.
- **Never reference RFCs** in code, comments, tests or build files.
- **Suites stay browser-neutral:** no BiDi/CDP/browser internals in `e2e/tests` (`grep -rE "connection\.send|Services\.|gBrowser|page\.|worker\." e2e/tests` prints nothing). New capabilities go into the adapters and the driver.
- **Every run stays green:** `bin/e2e test --browser=firefox` (all pass), `bin/e2e test --browser=chrome` (all pass, E21 and Firefox-only specs skipped), and `bin/e2e test --browser=firefox --ref=622bf3d` (all pass except `upstream-bug` specs, which are reported as todo).
- `bin/dev run make` has a ~0.1% flake in `src/model/deleted-items.test.ts` until Task 2 lands; rerun if that's the only failure.

## Commit stack

| Task | Commit                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `docs(rfc-0002): add Phase D, specs for the upstream bugs this fork fixes` (done, `f4bfbd0`) and `docs(rfc-0002): add the Phase D plan` (this file) |
| 1    | `test(rfc-0002): run upstream-bug specs as todo on reference builds`                                                                                |
| 2    | `test(rfc-0002): make the deleted-items filter test deterministic [pre-existing]`                                                                   |
| 3    | `fix(rfc-0002): don't copy the Tab Stash page when copying all tabs [pre-existing]`                                                                 |
| 4    | `fix(rfc-0002): close hidden tabs of bookmarks stashed since startup [pre-existing]`                                                                |
| 5    | `fix(rfc-0002): make the options page's coupling watchers fire [pre-existing]`                                                                      |
| 6    | `fix(rfc-0002): don't open the sidebar when showing the popup [pre-existing]`                                                                       |
| 7    | `docs(rfc-0002): record the Phase D results`                                                                                                        |

---

### Task 1: Run upstream-bug specs as todo on reference builds

**Files:** `e2e/harness/runner.cts` (`parseSpec`, `Spec`, `steps`), `e2e/harness/runner.test.cts`, `Makefile` (`check-e2e-ref`).

**Interfaces:** Produces the spec key `upstream-bug: <string>` (non-empty; the `TASKS.md` heading) and the env var `E2E_REF` (set to the resolved commit by `check-e2e-ref`; unset on working-tree runs).

- [ ] **Step 1: Self-tests first.** In `runner.test.cts` add: a spec with `upstream-bug: Some bug` parses and exposes it; `upstream-bug: ""` and `upstream-bug: 5` are rejected with an error naming the key.
- [ ] **Step 2: Parse it.** Add `"upstream-bug"` to `SPEC_KEYS`, an optional `upstreamBug?: string` on `Spec`, validated as a non-empty string.
- [ ] **Step 3: Todo on reference builds.** In `steps()`:

```ts
  // A spec for an upstream bug this fork fixes can't pass on a build from
  // before the fix, so reference runs report it without failing the run.
  const todo =
    spec.upstreamBug && process.env.E2E_REF
      ? `covers an upstream bug: ${spec.upstreamBug}`
      : false;

  test(`${spec.id} ${spec.title} (${browser})`, {skip, todo}, async t => {
```

Subtests inherit nothing from `todo`, so check how node:test reports a failing subtest inside a todo test on Node 22: the run's exit code must stay 0 and the failures must still be printed. If subtest failures still fail the run, also pass `{todo}` to the subtests created in `steps()`'s callback. Prove both outcomes with a throwaway spec (deleted afterwards).

- [ ] **Step 4: Makefile.** In `check-e2e-ref`'s final command add `E2E_REF="$$sha"` to the environment, and mention it in the target's comment.
- [ ] **Step 5: Verify.** Runner self-test passes (new count). Firefox, Chrome and `--ref=622bf3d` runs unchanged (no spec uses the key yet).
- [ ] **Step 6: Commit** `test(rfc-0002): run upstream-bug specs as todo on reference builds`.

---

### Task 2: [pre-existing] Make the deleted-items filter test deterministic

**Bug:** `TASKS.md` "A deleted-items unit test fails about once in a thousand runs". Test-only, no UI effect: the test itself is the regression test.

- [ ] **Step 1:** In `src/model/deleted-items.test.ts` "only loads new items that match the applied filter", make sure at least one matching item exists regardless of the random data, e.g. add one known item whose title contains "cat" through the same source before loading (use the model's existing add API, as other tests in the file do), and keep the random 50. Don't change `makeFakeData_testonly` unless seeding is clearly simpler.
- [ ] **Step 2:** Prove it: temporarily force the random titles to contain no "cat" (e.g. a local edit of the word list, reverted afterwards); the old test fails, the new one passes.
- [ ] **Step 3:** Move the `TASKS.md` entry to "Fixed in this fork".
- [ ] **Step 4:** `bin/dev run make` exits 0. Commit `test(rfc-0002): make the deleted-items filter test deterministic [pre-existing]`.

---

### Task 3: [pre-existing] Don't copy the Tab Stash page when copying all tabs

**Bug:** `TASKS.md` "Alt-clicking "Stash all" copies the Tab Stash page too". Visible: the copied folder gains a `stash-list.html` bookmark.

- [ ] **Step 1: Spec first.** Extend E04 (`e2e/tests/e04-copy-keeps-tabs/`): add `upstream-bug: Alt-clicking "Stash all" copies the Tab Stash page too`; make the folder step assert the folder holds exactly the three pages, in tab order (drop the narrowing and the note that excused it). Run it: it must fail on our branch at that step before the fix.
- [ ] **Step 2: Fix at the source.** `stash()` in `src/stash-list/window.vue` passes `copyIf(ev.altKey, to_stash)`; filter what is copied with the same stashability rule a move applies (`isURLStashable()` / the existing tab filter in `putItemsInFolder()`), ideally inside `copying()` or at the call site, whichever matches the code's existing layering. Check `copying()`'s other callers (`src/model/index.ts` ~737, ~742) and say in the report whether they should also skip unstashable items.
- [ ] **Step 3:** E04 passes on Firefox and Chrome; on `--ref=622bf3d` it is reported as todo and fails at the folder step (record that in notes). Reverting the fix fails the folder step (mutation).
- [ ] **Step 4:** Move the `TASKS.md` entry. `bin/dev run make` exits 0. Commit.

---

### Task 4: [pre-existing] Close hidden tabs of bookmarks stashed since startup

**Bug:** `TASKS.md` "Removing a newly stashed bookmark leaves its hidden tab open". Visible (a hidden tab with no bookmark piles up). Firefox only: Chrome has no hidden tabs.

- [ ] **Step 1: Spec.** Land E14 from the draft in `.superpowers/sdd/bc-task-6-e14-draft/` as `e2e/tests/e14-removed-bookmark-closes-hidden-tab/`, with `browser: firefox` and `upstream-bug: Removing a newly stashed bookmark leaves its hidden tab open`. Bring it up to date with the current harness (`h.tabs({url, hidden})`, `given.stashedThreePages` records `h.vars.pageTabs`). It must fail before the fix.
- [ ] **Step 2: Fix.** In `src/index.ts` (~477-508) also register `close_removed_bookmarks` on `browser.bookmarks.onCreated`, next to the other three listeners. Check that the listener is registered synchronously at load like its neighbours (the Chrome work moved background listeners to register synchronously; follow whatever pattern the file uses now).
- [ ] **Step 3:** E14 passes on Firefox; skipped on Chrome; todo on `--ref=622bf3d` (record the failing step). Reverting the fix fails it. A unit test isn't required (the e2e test covers it) unless the code is already unit-tested nearby.
- [ ] **Step 4:** Update RFC 0002's "Allowed non-UI actions" only if E14's action differs from what it lists. Move the `TASKS.md` entry. `bin/dev run make`. Commit.

---

### Task 5: [pre-existing] Make the options page's coupling watchers fire

**Bug:** `TASKS.md` "The options page's coupling watchers never fire". Visible on the options page.

- [ ] **Step 1: Spec.** New `e2e/tests/e22-popup-turns-off-stash-action/` (`upstream-bug: The options page's coupling watchers never fire`): given the options page with the toolbar set to show a tab and stash "all" (seed `browser_action_show`/`browser_action_stash` via `h.seed`; check the option names and values in `src/model/options.ts`), when the user selects the "popup" radio for what the toolbar button shows (`#browser_action_show_popup` — verify the id), then the stash-action radio "none" is selected on the page and `storage.sync` holds `browser_action_stash: "none"`. Mutation: reverting the fix. Runs on both browsers.
- [ ] **Step 2: Fix.** In `src/options/index.vue` (~527-560) make the watchers observe the real state (e.g. `"model.sync.state.browser_action_show"` or the reactive `sync` prop's key — read how `data()`/`prop()` expose it), and check each coupling in the block still makes sense (popup ⇒ stash none; none+none ⇒ stash single; stash none + show none ⇒ show tab; stash other + show popup ⇒ show tab). Watch for loops between the two watchers.
- [ ] **Step 3:** E22 passes on Firefox and Chrome; todo on `--ref=622bf3d` (record the failing step); E17 still passes. If another coupling is cheap to cover in the same spec without a second action, don't add it (one action per spec); note the others as covered by the fix's reading.
- [ ] **Step 4:** Move the `TASKS.md` entry; update the "Upstream bugs found while surveying" paragraph in RFC 0002 Background only if it becomes untrue (it says they're tracked in `TASKS.md`; add "fixed in Phase D"). `bin/dev run make`. Commit.

---

### Task 6: [pre-existing] Don't open the sidebar when showing the popup

**Bug:** `TASKS.md` "Showing the popup also opens the sidebar". `show_something("popup")` falls through to `show_sidebar_or_tab`. Firefox (on Chrome there's no sidebar; it opens a stash-list tab instead — check whether the Chrome path is reachable and covered too).

- [ ] **Step 1: Find the trigger.** `show_something` runs from commands (keyboard shortcuts), context menus and the toolbar button (`src/index.ts` ~230-400), with `open_stash_in` / `browser_action_show` set to `"popup"`. Pick the trigger a user would use that reaches the `"popup"` case and that the adapter can fire. Candidates: an extension command (keyboard shortcut) — the Firefox adapter can dispatch it from the chrome context; a context-menu item — via the menus API's internal click from the chrome context; the toolbar button — clicking the browser action from the chrome context. Add it as a driver method with a browser-neutral name (e.g. `h.runCommand(name)` or `h.clickToolbarButton()`), implemented in `firefox.cts` (and in `chrome.cts` if feasible; otherwise make the spec `browser: firefox`). Note that `openPopup()` and opening the sidebar need a user-gesture context; whatever you use must count as one, or the test proves nothing.
- [ ] **Step 2: Observe the result.** "The sidebar stays closed" can be asserted from an extension page with `browser.sidebarAction.isOpen({})` (Firefox). "The popup is shown" needs evidence too — e.g. the popup's page target/context exists (`stash-list.html?view=popup` in a popup browser), found by the adapter. If no API can see it, take a screenshot of the **whole browser window** (not just the page) from the Firefox chrome context — e.g. `drawSnapshot` of the top-level browser window's `browsingContext`, or `windowUtils`/canvas `drawWindow` — as a driver method `h.browserScreenshot()` and a golden; mask anything unstable. Prefer state checks; use the screenshot only if needed, and only after the step that fails on the buggy build.
- [ ] **Step 3: Spec.** New `e2e/tests/e23-popup-not-sidebar/` (`browser: firefox` unless Chrome is covered; `upstream-bug: Showing the popup also opens the sidebar`): given the toolbar is set to show the popup (and whatever option routes the chosen trigger to `show_something("popup")`), when the user triggers it, then the popup is shown, and the sidebar is closed. It must fail before the fix at the sidebar step.
- [ ] **Step 4: Fix.** Add `break;` after `model.attempt(commands.show_popup);` in `src/index.ts` (~293).
- [ ] **Step 5:** E23 passes; todo on `--ref=622bf3d` with the failing step recorded; reverting the fix fails it. Update RFC 0002's driver table and "Allowed non-UI actions" for the new driver method(s). Move the `TASKS.md` entry. `bin/dev run make`. Commit.
- [ ] **If no trigger can be made reliable,** stop and report with evidence; don't land the fix without a test.

---

### Task 7: Record the results (controller)

- [ ] Fill in the `TASKS.md` "Fix:" SHAs for Tasks 2–6.
- [ ] Run Firefox ×3, Chrome ×3, `--ref=622bf3d` ×1; all green (todo specs reported, not failing).
- [ ] Add "Phase D results" to RFC 0002 after "Phase B and C results": the bugs fixed (commit, test, step that fails on `622bf3d`), run counts and times. Commit `docs(rfc-0002): record the Phase D results`.
- [ ] Final whole-stack review, as in earlier phases.

---

## Deviations

- **Task 1:** the runner's signal for a reference build is `E2E_REF_SHA`, not `E2E_REF`. Make exports command-line variables to every recipe, so `E2E_REF` is set in every run started with it, not only reference runs.
- **Task 2** fixed two flaky filter tests, not one.
- **Task 5** was redone. The watchers were dead and also redundant: the options that would trigger them are disabled on the page. So E22 tests that rule instead, and the watchers were removed.
- **Task 6** added harness methods: `clickTabMenuItem()` and `closeSidebar()` to act, and `popups()` and `sidebarOpen()` to check the result. E23 seeds a legacy `open_stash_in` value of `"popup"`, since no release offers it.
- **Follow-up:** a new open bug in `TASKS.md`, "Showing the popup clears the toolbar button's popup". It has no visible effect with Firefox 157's defaults.
