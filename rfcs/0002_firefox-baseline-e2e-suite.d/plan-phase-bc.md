# Firefox-Baseline E2E Suite, Phases B and C: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [RFC 0002](../0002_firefox-baseline-e2e-suite.md), Phases B and C. Phase A, with E01, E02 and E08, is built; see its "Phase A results".

**Goal:** finish the catalogue. That means E03–E07, E09–E21, with the driver helpers they need. Every test passes against upstream's unmodified code (`622bf3d`) and against our branch, and each has a mutation check that fails it.

**Architecture:**

- **No new layers.** This plan builds on the existing harness: the step runner (`e2e/harness/runner.cts`), the browser-neutral driver `h` (`e2e/harness/driver.cts`), the Firefox adapter (`e2e/harness/firefox.cts`) and shared `given` steps (`e2e/harness/fixtures.cts`).
- **Each test** is a folder `e2e/tests/eNN-<slug>/` with a plain-English `spec.yml`, the source of truth, and a `suite.cts` that binds one function per step by exact text.
- **The driver** gains a few helpers first: scoped clicks, typing, key presses, message lookup, page lists, custom seed URLs, a scratch `vars`, and tab activation. Then the tests come in small groups.

**Tech Stack:** Node 22.23 (`.cts` with type stripping), `node:test` and `node:assert/strict`, Puppeteer 25.13.0 with Firefox 157 over BiDi, `js-yaml` 5.4.3 (global), make, and the `bin/dev` and `bin/e2e` wrappers.

## Global Constraints

- **Docker only.** Everything runs in the dev Docker image. Run tests with `bin/e2e test --browser=firefox [--ref=622bf3d] [--update-goldens]`, node and make with `bin/dev run <cmd>`, and git on the host.
- **Never encode a bug.** The baseline is upstream commit `622bf3d`: a test is trusted only once it passes there. If an expectation fails on `622bf3d`, the expectation is wrong. Fix the spec, or report the discrepancy, and never encode a bug as expected behaviour. Upstream bugs go in `TASKS.md`.
- **Goldens** are generated only from the baseline, with `bin/e2e test --browser=firefox --ref=622bf3d --update-goldens`. Anything showing a date or time is masked, preferably by selector.
- **Suites act through the page's UI and assert on browser state through `h`.**
  - They never call BiDi, CDP or Firefox internals: `grep -rE "connection\.send|Services\.|gBrowser" e2e/tests` must print nothing.
  - The allowed non-UI actions are `seed()`, pinning a tab in a `given` step (E15, E20), removing a bookmark as the user would in the Library (E14), and `restartBackground()` (E10).
  - Don't call `the.model` to act.
- **Each step function checks its whole sentence.** It waits, bounded through `h.waitFor` or `h.waitUntil`, for asynchronous effects before asserting. Screenshot steps wait for the state they show to settle.
- **Spec format** (RFC §1):
  - fields `id`, `title`, `given`, `when`, `then`, `notes`, and an optional `browser`;
  - a step is a string or `{step, browser?, screenshot?}`;
  - `screenshot` is `true`, a name, or `{name?, mask: [selector | [x, y, w, h]]}`;
  - duplicate step text is an error;
  - `notes` must include a `Mutation check:` line: an exact edit to `src/` that makes the test fail, and the step that fails.
- **Off limits:** `src/` (except temporary mutations, restored with `git checkout -- <file>`), `assets/manifest.json`, `package.json`, `package-lock.json` and `bin/dev`.
- **Comments** explain why. They never reference RFCs.
- **Commits:**
  - a Conventional Commit with scope `rfc-0002`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - each commit leaves `bin/dev run make` passing (625 tests) and `bin/e2e test --browser=firefox` passing;
  - one commit per task, and never push.
- **Deviations.** If a task can't be done as written without contradicting RFC 0002, stop and report. The controller updates the RFC first, in a `docs(rfc-0002)` commit.
- **Selectors in this plan are best-known drafts** from reading the source. Confirm each against the live page (e.g. `h.eval("document.querySelectorAll(...).length")`) and the component source. Use the confirmed one, and say in the spec's `notes` when a selector is subtle.

## File Structure

| File                                      | Change | Responsibility                                                                                                                                                |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rfcs/0002_firefox-baseline-e2e-suite.md` | modify | Task 0 adjusts the catalogue; the last task records the results                                                                                               |
| `e2e/harness/driver.cts`                  | modify | New helpers: `clickInRow`, `clickInFolder`, `type`, `press`, `message`, `activate`, `vars`; `openPages(list)`; custom seed URLs; `restartBackground` (Task 9) |
| `e2e/harness/firefox.cts`                 | modify | `restartBackground` (Task 9)                                                                                                                                  |
| `e2e/harness/fixtures.cts`                | modify | `given.stashedThreePages`, `given.deletedFolder`                                                                                                              |
| `e2e/tests/e03-…` to `e2e/tests/e21-…`    | create | One folder per spec: `spec.yml`, `suite.cts`, plus goldens where the spec has screenshots                                                                     |

## Commit stack

| Task | Commit subject                                                                 |
| ---- | ------------------------------------------------------------------------------ |
| 0    | `docs(rfc-0002): split multi-step scenarios into their own specs` (controller) |
| 1    | `test(rfc-0002): add driver helpers for the remaining specs`                   |
| 2    | `test(rfc-0002): add E3 and E4, stashing one tab and copying`                  |
| 3    | `test(rfc-0002): add E5 and E6, restoring a bookmark and a folder`             |
| 4    | `test(rfc-0002): add E7, E9 and E19, deleting and restoring folders`           |
| 5    | `test(rfc-0002): add E11, E12 and E13, renaming, duplicates and search`        |
| 6    | `test(rfc-0002): add E14, E15 and E20, removed bookmarks and pinned tabs`      |
| 7    | `test(rfc-0002): add E16 and E17, privileged URLs and options`                 |
| 8    | `test(rfc-0002): add E18 and E21, the popup and sidebar views`                 |
| 9    | `test(rfc-0002): add E10, deleted items surviving a background restart`        |
| 10   | `docs(rfc-0002): record Phase B and C results` (controller)                    |

Each test task follows the same cycle for each of its specs:

1. Write `spec.yml` and `suite.cts` as given.
2. Run `bin/e2e test --browser=firefox` against this checkout.
3. Generate any goldens from the baseline.
4. Run `--ref=622bf3d`.
5. Apply the spec's mutation, confirm the named step fails, and restore.
6. Run `make`.
7. Commit.

For tests of existing behaviour, the mutation check is the red step of TDD.

---

### Task 0: Split multi-step scenarios into their own specs (controller)

The controller does this task, not a subagent. The runner executes every `given`, then every `when`, then every `then`, so a spec can't check something midway and then act again. So these RFC catalogue entries change, in `## Proposal`, "### 3. The test catalogue":

- **E9** becomes "Delete a folder; Deleted Items lists it" (screenshot, header date masked).
- **New E19:** "Restore a folder from Deleted Items".
- **E15** becomes "Pinned tabs are left out of 'Stash all'".
- **New E20:** "Pinned tabs are included when the option is on".
- **E17** becomes "Options persist". It checks the radio stays selected after reload, and `storage.local` has the value. Showing the option's effect would need a second action, which the format doesn't allow.
- **E18** becomes "The popup view renders".
- **New E21:** "The sidebar view renders", Firefox only.
- **Allowed non-UI actions** (§4) also list pinning a tab in a `given` step and seeding a bookmark with a custom URL.

Phase B covers E3–E7, E9, E11 and E19. Phase C covers E10, E12–E18, E20 and E21.

- [ ] **Step 1:** Edit the RFC as above, keeping table formatting, then run `bin/dev run sh -c './node_modules/.bin/prettier --write rfcs/'`.
- [ ] **Step 2:** Commit.

  ```bash
  git add rfcs/0002_firefox-baseline-e2e-suite.md
  git commit -F - <<'EOF'
  docs(rfc-0002): split multi-step scenarios into their own specs

  A spec runs all given, then all when, then all then steps, so a scenario
  that checks something and then acts again needs two specs. E9's restore
  becomes E19, E15's option case E20, E18's sidebar case E21, and E17
  checks persistence only.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 1: Driver helpers for the remaining specs

**Files:**

- Modify: `e2e/harness/driver.cts`
- Modify: `e2e/harness/fixtures.cts`

**Interfaces:**

- Produces, on `h`:
  - `vars: Record<string, any>`
  - `openPages(pages: number | number[])`
  - `pageUrl(n: number): string`
  - `clickInRow(rowSelector: string, title: string, target: string, mods?)`
  - `clickInFolder(folder: string, target: string, mods?)`
  - `type(selector: string, text: string)`
  - `press(selector: string, key: string)`
  - `message(key: string): string`
  - `activate()`
  - `seed({stash: [{title, pages: Array<number | {title: string; url: string}>}]})`
- Produces, in `fixtures.cts`: `given.stashedThreePages(h)`, and `given.deletedFolder(h, title, pages)`.

- [ ] **Step 1: Add the helpers to `driver.cts`**

  Inside `class Driver`, add a `vars` field after `page`:

  ```ts
  // Scratch space for a value one step records for a later one, e.g. a tab id
  // taken before an action.
  vars: Record<string, any> = {};
  ```

  Add a `messages` field and load it in the constructor, after `this.version = …`:

  ```ts
  messages: Record<string, {message: string}>;
  ```

  ```ts
  this.messages = JSON.parse(
    fs.readFileSync(path.join(dist, "_locales/en/messages.json"), "utf8"),
  );
  ```

  Add `pageUrl` after `pageUrls`:

  ```ts
  pageUrl(n: number): string {
    return this.pageUrls(n)[n - 1];
  }
  ```

  Replace `openPages` with:

  ```ts
  // Opens local pages as background tabs in the page's window and waits for
  // them to load, so their titles are known.  A number n opens pages 1..n; a
  // list opens just those pages.
  async openPages(pages: number | number[]): Promise<void> {
    const nums =
      typeof pages === "number"
        ? Array.from({length: pages}, (_, i) => i + 1)
        : pages;
    const urls = nums.map(n => this.pageUrl(n));
    for (const url of urls) {
      await this.eval(
        `browser.tabs.create({url: ${JSON.stringify(url)}, active: false})`,
      );
    }
    const list = JSON.stringify(urls);
    await this.waitFor(
      `browser.tabs.query({currentWindow: true}).then(ts => ${list}.every(u =>
        ts.some(t => t.url === u && t.status === "complete")))`,
      `pages ${nums.join(", ")} to load`,
    );
  }
  ```

  Factor the click event out of `click` and add the scoped clicks, `type`, `press`, `message` and `activate` after `click`:

  ```ts
  // The JS that dispatches a synthetic click on the element `el` evaluates to.
  private clickJs(el: string, mods: {alt?: boolean; ctrl?: boolean; shift?: boolean}) {
    return `${el}.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true,
      altKey: ${!!mods.alt}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift},
    }))`;
  }

  // Clicks `target` inside the row matching `rowSelector` whose .forest-title
  // text is `title`: first within the row itself (its toolbar and menu), then
  // within the children listed right after it.  CSS can't pick a row by its
  // text, and titles like "Page 1" appear in several lists at once.
  async clickInRow(
    rowSelector: string,
    title: string,
    target: string,
    mods: {alt?: boolean; ctrl?: boolean; shift?: boolean} = {},
  ) {
    const find = `(() => {
      const row = [...document.querySelectorAll(${JSON.stringify(rowSelector)})]
        .find(r => r.querySelector(".forest-title")?.textContent.trim() === ${JSON.stringify(title)});
      if (!row) return null;
      return row.querySelector(${JSON.stringify(target)})
        ?? row.nextElementSibling?.querySelector(${JSON.stringify(target)}) ?? null;
    })()`;
    await this.waitFor(`!!${find}`, `${target} in the row titled "${title}"`);
    await this.eval(this.clickJs(find, mods));
  }

  // clickInRow for a stash folder, found by its displayed title.
  clickInFolder(folder: string, target: string, mods = {}) {
    return this.clickInRow("div.forest-item.folder", folder, target, mods);
  }

  // Sets an input's value as typing would, and fires "input".
  async type(selector: string, text: string): Promise<void> {
    const sel = JSON.stringify(selector);
    await this.waitFor(`!!document.querySelector(${sel})`, `an input matching ${selector}`);
    await this.eval(`(() => {
      const el = document.querySelector(${sel});
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event("input", {bubbles: true}));
    })()`);
  }

  // Presses a key on an element: keydown then keyup, as a real key press does.
  async press(selector: string, key: string): Promise<void> {
    const sel = JSON.stringify(selector);
    await this.waitFor(`!!document.querySelector(${sel})`, `an element matching ${selector}`);
    await this.eval(`(() => {
      const el = document.querySelector(${sel});
      for (const type of ["keydown", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, {key: ${JSON.stringify(key)}, bubbles: true, cancelable: true}));
      }
    })()`);
  }

  // The English text of one of Tab Stash's messages, for selecting elements by
  // their title or label.  Placeholders like $1 are left as they are.
  message(key: string): string {
    const m = this.messages[key];
    if (!m) throw new Error(`No message "${key}"`);
    return m.message;
  }

  // Makes the test's own tab the active one again, e.g. after restoring tabs
  // activated others, so a screenshot shows a foreground page.
  async activate(): Promise<void> {
    await this.eval(`browser.tabs.getCurrent().then(t => browser.tabs.update(t.id, {active: true}))`);
    await this.waitFor(`browser.tabs.getCurrent().then(t => t.active)`, "the test's tab to be active");
  }
  ```

  Change `click` to use `clickJs`:

  ```ts
  await this.eval(this.clickJs(`document.querySelector(${sel})`, mods));
  ```

  Seed custom bookmarks. Change the `SeedFolder` type to `{title: string; pages: Array<number | {title: string; url: string}>}`. In `seed()`'s page loop, replace the bookmark creation with:

  ```js
  for (const p of f.pages) {
    const b =
      typeof p === "number" ? {title: "Page " + p, url: urls[p - 1]} : p;
    await browser.bookmarks.create({
      parentId: folder.id,
      title: b.title,
      url: b.url,
    });
  }
  ```

  **Two review fixes in `screenshot()`:**
  - Wrap the cleanup `eval` in the `finally` in `try { … } catch {}`, so a failed cleanup can't hide the original error. Add a one-line comment saying so.
  - Make the missing-selector error name the selector as it does now.

- [ ] **Step 2: Add the fixtures to `fixtures.cts`**

  Replace the object with:

  ```ts
  const given = {
    async threeOpenPages(h: any): Promise<void> {
      await h.openPages(3);
    },

    // E2's end state: three pages stashed with "Stash all" into one new
    // folder.  The pages' tab ids are kept in h.vars.pageTabs for later steps.
    async stashedThreePages(h: any): Promise<void> {
      await h.openPages(3);
      h.vars.pageTabs = await h.tabs({url: h.pageUrls(3)});
      await h.click('nav.forest-toolbar > a[class="action stash"]');
      const urls = JSON.stringify(h.pageUrls(3));
      await h.waitFor(
        `browser.tabs.query({currentWindow: true, hidden: false})
          .then(ts => !ts.some(t => ${urls}.includes(t.url)))`,
        "the three pages to leave the window",
      );
      await h.waitUntil(
        async () => (await h.stash())[0]?.urls.length === 3,
        "the stash folder to hold three pages",
      );
    },

    // A folder seeded into the stash and then deleted through its menu, so it
    // is in Deleted Items.
    async deletedFolder(h: any, title: string, pages: number[]): Promise<void> {
      await h.seed({stash: [{title, pages}]});
      await h.showAllFolders();
      await h.clickInFolder(title, "summary");
      await h.clickInFolder(
        title,
        `button[title="${h.message("deleteGroupTooltip")}"]`,
      );
      await h.waitUntil(
        async () => !(await h.stash()).some((f: any) => f.title === title),
        `"${title}" to be deleted`,
      );
    },
  };
  ```

- [ ] **Step 3: Check that nothing regressed**

  Run: `bin/e2e test --browser=firefox` and `bin/e2e test --browser=firefox --ref=622bf3d`.
  Expected: both pass, with the same counts as before (29 and 19). E02's golden still matches.

- [ ] **Step 4: Prove the new helpers work**

  Write a throwaway spec in `e2e/tests/zz-probe/`, which is **not** committed. It should:
  - seed a folder "Reading" with pages 1 and 2;
  - `clickInFolder("Reading", "summary")`, then check that the menu's delete button exists, via `h.message("deleteGroupTooltip")`;
  - `openPages([2])`;
  - `activate()`.

  Run it, then delete the folder.

- [ ] **Step 5: Verify, then commit**

  Run `bin/dev run make` (625) and the grep from the Global Constraints. Then:

  ```bash
  git add e2e/harness/driver.cts e2e/harness/fixtures.cts
  git commit -F - <<'EOF'
  test(rfc-0002): add driver helpers for the remaining specs

  Scoped clicks (clickInRow, clickInFolder) for rows CSS can't pick by
  their text, type and press for inputs, message for selecting by
  localised titles, activate to bring the test's tab forward, page lists
  in openPages, custom seed URLs, and a vars scratchpad. New fixtures:
  stashedThreePages and deletedFolder. The screenshot cleanup no longer
  hides the original error if it fails.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 2: E3 and E4, stashing one tab and copying

**Files:** create `e2e/tests/e03-stash-one-twice/{spec.yml,suite.cts}` and `e2e/tests/e04-copy-keeps-tabs/{spec.yml,suite.cts}`.

- [ ] **Step 1: E3 spec**

  ```yaml
  id: E03
  title: Stash one tab, twice
  given:
    - Three local pages are open in the window, and the stash is empty.
  when:
    - The user clicks "Stash this tab" on Page 1 in the open-tabs list.
    - The user clicks "Stash this tab" on Page 2 in the open-tabs list.
  then:
    - Page 1 and Page 2 are bookmarked in the same, single stash folder.
    - step: Page 1 and Page 2 are hidden, and Page 3 is still visible.
      browser: firefox
    - step: Page 1 and Page 2 are closed, and Page 3 is still open.
      browser: chrome
  notes: |
    "Stash this tab" puts the tab in the default folder; a second stash within
    new_folder_timeout_min (5 minutes) reuses that folder.
    Open-tab rows are div.forest-item[title=<tab title>] inside
    ul.forest.one-column; their stash link has class exactly "action stash one".
    Each when step waits for its bookmark before ending.
    Mutation check: in src/model/index.ts, make the default-folder reuse check
    (the new_folder_timeout_min comparison) always false; the "same, single
    stash folder" step fails.
  ```

- [ ] **Step 2: E3 suite**

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");
  const {given} = require("../../harness/fixtures.cts");

  const stashOne = (n: number) => async (h: any) => {
    await h.click(
      `ul.forest.one-column div.forest-item[title="Page ${n}"] a[class="action stash one"]`,
    );
    await h.waitFor(
      `browser.bookmarks.search({url: ${JSON.stringify(h.pageUrl(n))}}).then(r => r.length === 1)`,
      `Page ${n} to be stashed`,
    );
  };

  steps(__dirname, {
    "Three local pages are open in the window, and the stash is empty.":
      async h => {
        await given.threeOpenPages(h);
        assert.deepEqual(await h.stash(), []);
      },
    'The user clicks "Stash this tab" on Page 1 in the open-tabs list.':
      stashOne(1),
    'The user clicks "Stash this tab" on Page 2 in the open-tabs list.':
      stashOne(2),
    "Page 1 and Page 2 are bookmarked in the same, single stash folder.":
      async h => {
        const folders = await h.stash();
        assert.equal(folders.length, 1);
        assert.deepEqual(
          [...folders[0].urls].sort(),
          [h.pageUrl(1), h.pageUrl(2)].sort(),
        );
      },
    "Page 1 and Page 2 are hidden, and Page 3 is still visible.": async h => {
      const pages = JSON.stringify([h.pageUrl(1), h.pageUrl(2)]);
      await h.waitFor(
        `browser.tabs.query({currentWindow: true, hidden: true}).then(ts => ${pages}.every(u => ts.some(t => t.url === u)))`,
        "Page 1 and Page 2 to be hidden",
      );
      const visible = (await h.tabs({hidden: false})).map((t: any) => t.url);
      assert.ok(visible.includes(h.pageUrl(3)));
    },
    "Page 1 and Page 2 are closed, and Page 3 is still open.": async h => {
      await h.waitUntil(
        async () =>
          (await h.tabs({url: [h.pageUrl(1), h.pageUrl(2)]})).length === 0,
        "Page 1 and Page 2 to close",
      );
      assert.equal((await h.tabs({url: h.pageUrl(3)})).length, 1);
    },
  });
  ```

- [ ] **Step 3: E4 spec**

  ```yaml
  id: E04
  title: Copying keeps tabs open
  given:
    - Three local pages are open in the window, and the stash is empty.
  when:
    - The user Alt-clicks "Stash all" in the open-tabs section of the stash list.
  then:
    - A new folder in "Tab Stash" holds the three pages, in tab order.
    - The three tabs are still visible and not marked as hidden by Tab Stash.
  notes: |
    Alt makes "Stash all" copy instead of move (window.vue).
    Mutation check: in src/stash-list/window.vue's stash handler, ignore the
    Alt key so it never copies; the "still visible" step fails.
  ```

- [ ] **Step 4: E4 suite**

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");
  const {given} = require("../../harness/fixtures.cts");

  steps(__dirname, {
    "Three local pages are open in the window, and the stash is empty.":
      async h => {
        await given.threeOpenPages(h);
        assert.deepEqual(await h.stash(), []);
      },
    'The user Alt-clicks "Stash all" in the open-tabs section of the stash list.':
      async h => {
        await h.click('nav.forest-toolbar > a[class="action stash"]', {
          alt: true,
        });
        await h.waitUntil(
          async () => (await h.stash())[0]?.urls.length === 3,
          "the three pages to be copied into the stash",
        );
      },
    'A new folder in "Tab Stash" holds the three pages, in tab order.':
      async h => {
        const [folder, ...rest] = await h.stash();
        assert.equal(rest.length, 0);
        assert.deepEqual(folder.urls, h.pageUrls(3));
      },
    "The three tabs are still visible and not marked as hidden by Tab Stash.":
      async h => {
        // Give a wrong move a moment to hide them before concluding it didn't.
        await new Promise(r => setTimeout(r, 1000));
        const tabs = await h.tabs({url: h.pageUrls(3)});
        assert.equal(tabs.length, 3);
        for (const t of tabs) {
          assert.equal(t.hidden, false);
          // Chrome has no session values, so tabMarker throws there: unmarked.
          assert.equal(await h.tabMarker(t.id).catch(() => false), false);
        }
      },
  });
  ```

  `tabMarker` uses `sessions.getTabValue`, which Chrome lacks. The `.catch` keeps this step valid when RFC 0001 runs it on Chrome. Note that in the spec's `notes`.

- [ ] **Step 5: Cycle and commit**

  Run the cycle for both specs, as described above the tasks. Then commit with:

  ```
  test(rfc-0002): add E3 and E4, stashing one tab and copying

  E3 stashes two tabs one at a time and checks they share the default
  folder. E4 copies with Alt-click and checks the tabs stay open.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: E5 and E6, restoring a bookmark and a folder

**Files:** create `e2e/tests/e05-restore-reuses-hidden-tab/` and `e2e/tests/e06-restore-folder/`, each with `spec.yml` and `suite.cts`; E6 also gets a golden.

- [ ] **Step 1: E5 spec**

  ```yaml
  id: E05
  title: Restoring a bookmark reuses its hidden tab
  given:
    - Three pages were stashed with "Stash all".
  when:
    - The user clicks Page 1's bookmark in the stash list.
  then:
    - step: Page 1's original tab is visible again, and Tab Stash's hidden mark is removed.
      browser: firefox
    - step: A new tab opens with Page 1.
      browser: chrome
    - Exactly one tab shows Page 1, and its bookmark is still in the stash.
  notes: |
    Restoring a URL prefers an unpinned hidden tab with the same URL
    (moveLeaf in src/model/index.ts), so on Firefox the tab id is unchanged.
    The bookmark's title link is div.forest-item[title="Page 1"] a.forest-title
    inside the stash folder (not the open-tabs list).
    Mutation check: in src/model/index.ts, make moveLeaf skip reusing hidden
    tabs; the "original tab is visible again" step fails.
  ```

- [ ] **Step 2: E5 suite**

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");
  const {given} = require("../../harness/fixtures.cts");

  const page1 = (h: any) => JSON.stringify(h.pageUrl(1));

  steps(__dirname, {
    'Three pages were stashed with "Stash all".': given.stashedThreePages,
    "The user clicks Page 1's bookmark in the stash list.": async h => {
      await h.showAllFolders();
      // The folder E2's "Stash all" created shows its date and time as its
      // title, so read it from the page rather than predict it.
      const title = await h.eval(
        `document.querySelector("div.forest-item.folder .forest-title").textContent.trim()`,
      );
      await h.clickInFolder(
        title,
        'div.forest-item[title="Page 1"] a.forest-title',
      );
      await h.waitFor(
        `browser.tabs.query({currentWindow: true, url: ${page1(h)}}).then(ts => ts.some(t => !t.hidden))`,
        "Page 1 to be visible",
      );
    },
    "Page 1's original tab is visible again, and Tab Stash's hidden mark is removed.":
      async h => {
        const original = h.vars.pageTabs.find(
          (t: any) => t.url === h.pageUrl(1),
        );
        const [tab] = await h.tabs({url: h.pageUrl(1)});
        assert.equal(tab.id, original.id);
        assert.equal(tab.hidden, false);
        await h.waitUntil(
          async () => !(await h.tabMarker(tab.id)),
          "the hidden mark to be removed",
        );
      },
    "A new tab opens with Page 1.": async h => {
      assert.equal((await h.tabs({url: h.pageUrl(1)})).length, 1);
    },
    "Exactly one tab shows Page 1, and its bookmark is still in the stash.":
      async h => {
        assert.equal((await h.tabs({url: h.pageUrl(1)})).length, 1);
        assert.ok((await h.stash())[0].urls.includes(h.pageUrl(1)));
      },
  });
  ```

- [ ] **Step 3: E6 spec**

  ```yaml
  id: E06
  title: Restore a folder
  given:
    - The stash has a folder "Reading" with Pages 1 to 3, and Page 2 is already open.
  when:
    - The user clicks "Open all tabs in this group" on "Reading".
  then:
    - Pages 1 to 3 are each open exactly once and visible, and Page 2's existing tab was reused.
    - The bookmarks in "Reading" are unchanged.
    - step: The stash list shows "Reading" with its three pages.
      screenshot: stash-list-after-restore
  notes: |
    restore_folders_into is seeded as "target-window", so no prompt appears.
    The folder's restore link has class exactly "action restore".
    Restoring activates the last restored tab, so the screenshot step makes
    the test's tab active again (h.activate) and waits for every page to
    finish loading before capturing.
    Mutation check: in src/model/index.ts restoreTabs, skip the "already open
    -> activate" branch so open URLs are opened again; the "exactly once"
    step fails.
  ```

- [ ] **Step 4: E6 suite**

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    'The stash has a folder "Reading" with Pages 1 to 3, and Page 2 is already open.':
      async h => {
        await h.seed({stash: [{title: "Reading", pages: [1, 2, 3]}]});
        await h.openPages([2]);
        h.vars.page2 = (await h.tabs({url: h.pageUrl(2)}))[0].id;
      },
    'The user clicks "Open all tabs in this group" on "Reading".': async h => {
      await h.showAllFolders();
      await h.clickInFolder("Reading", 'a[class="action restore"]');
      const urls = JSON.stringify(h.pageUrls(3));
      await h.waitFor(
        `browser.tabs.query({currentWindow: true}).then(ts => ${urls}.every(u => ts.some(t => t.url === u && !t.hidden && t.status === "complete")))`,
        "Pages 1 to 3 to be open and loaded",
      );
    },
    "Pages 1 to 3 are each open exactly once and visible, and Page 2's existing tab was reused.":
      async h => {
        for (const url of h.pageUrls(3)) {
          const tabs = await h.tabs({url});
          assert.equal(tabs.length, 1, url);
          assert.equal(tabs[0].hidden, false);
        }
        assert.equal((await h.tabs({url: h.pageUrl(2)}))[0].id, h.vars.page2);
      },
    'The bookmarks in "Reading" are unchanged.': async h => {
      const reading = (await h.stash()).find((f: any) => f.title === "Reading");
      assert.deepEqual(reading.urls, h.pageUrls(3));
    },
    'The stash list shows "Reading" with its three pages.': async h => {
      await h.activate();
      await h.showAllFolders();
    },
  });
  ```

- [ ] **Step 5: Cycle, golden and commit**

  Generate E6's golden from the baseline and look at it: it must show "Reading" and its three pages. If the image differs between runs, find the cause (a background tab, loading icons) and fix it in the suite or the driver; don't loosen the comparison. Then commit with:

  ```
  test(rfc-0002): add E5 and E6, restoring a bookmark and a folder

  E5 restores a stashed page and checks Firefox shows its original hidden
  tab again. E6 restores a folder, checks an already-open page is reused
  rather than duplicated, and compares the list with a golden.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: E7, E9 and E19, deleting and restoring folders

**Files:** create `e2e/tests/e07-restore-and-remove/`, `e2e/tests/e09-deleted-items-lists-folder/` and `e2e/tests/e19-restore-from-deleted-items/`. E9 also gets a golden.

- [ ] **Step 1: E7 spec and suite**

  ```yaml
  id: E07
  title: Restore and remove
  given:
    - The stash has a folder "Reading" with Page 1 and Page 2.
  when:
    - The user clicks "Open all tabs in this group and delete the group" on "Reading".
  then:
    - Page 1 and Page 2 are open and visible.
    - '"Reading" is no longer in the stash.'
    - Deleted Items lists "Reading".
  notes: |
    The folder's link has class exactly "action restore-remove".
    The last then step opens deleted-items.html to look; its list loads lazily.
    Mutation check: in src/stash-list/folder.vue, make the restore-remove
    handler skip deleting the folder; '"Reading" is no longer in the stash'
    fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    'The stash has a folder "Reading" with Page 1 and Page 2.': async h => {
      await h.seed({stash: [{title: "Reading", pages: [1, 2]}]});
    },
    'The user clicks "Open all tabs in this group and delete the group" on "Reading".':
      async h => {
        await h.showAllFolders();
        await h.clickInFolder("Reading", 'a[class="action restore-remove"]');
        await h.waitUntil(
          async () =>
            !(await h.stash()).some((f: any) => f.title === "Reading"),
          '"Reading" to be removed',
        );
      },
    "Page 1 and Page 2 are open and visible.": async h => {
      for (const url of h.pageUrls(2)) {
        await h.waitUntil(
          async () => (await h.tabs({url})).some((t: any) => !t.hidden),
          `${url} to be open`,
        );
      }
    },
    '"Reading" is no longer in the stash.': async h => {
      assert.ok(!(await h.stash()).some((f: any) => f.title === "Reading"));
    },
    'Deleted Items lists "Reading".': async h => {
      await h.activate();
      await h.open("deleted-items.html");
      await h.waitFor(
        `[...document.querySelectorAll("div.forest-item.deleted .forest-title")].some(e => e.textContent.trim() === "Reading")`,
        '"Reading" in Deleted Items',
      );
    },
  });
  ```

- [ ] **Step 2: E9 spec and suite**

  ```yaml
  id: E09
  title: Deleting a folder lists it in Deleted Items
  given:
    - The stash has a folder "Old" with Page 1 and Page 2.
  when:
    - The user deletes "Old" with "Delete Group" from its menu.
  then:
    - '"Old" is no longer in the stash.'
    - Deleted Items lists "Old" with its two pages.
    - step: Deleted Items shows "Old" under today's date.
      screenshot:
        name: deleted-items
        mask:
          - <selector for the day header's date>
  notes: |
    "Delete Group" sits in the folder's menu (details.menu); its button only
    renders while the menu is open, and is found by its title
    (h.message("deleteGroupTooltip")).
    The day header shows the real date, so the screenshot masks it.
    Mutation check: in src/model/index.ts, make deleting a folder skip
    recording it in deleted items; "Deleted Items lists" fails.
  ```

  Find the day header's element in `src/deleted-items/index.vue` and use a selector that matches exactly it. The spike masked the rectangle `[286, 55, 200, 24]`. Use that rectangle only if no selector works, and say why in the notes.

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  const listed = (title: string) =>
    `[...document.querySelectorAll("div.forest-item.deleted .forest-title")].some(e => e.textContent.trim() === ${JSON.stringify(title)})`;

  steps(__dirname, {
    'The stash has a folder "Old" with Page 1 and Page 2.': async h => {
      await h.seed({stash: [{title: "Old", pages: [1, 2]}]});
    },
    'The user deletes "Old" with "Delete Group" from its menu.': async h => {
      await h.showAllFolders();
      await h.clickInFolder("Old", "summary");
      await h.clickInFolder(
        "Old",
        `button[title="${h.message("deleteGroupTooltip")}"]`,
      );
      await h.waitUntil(
        async () => !(await h.stash()).some((f: any) => f.title === "Old"),
        '"Old" to be deleted',
      );
    },
    '"Old" is no longer in the stash.': async h => {
      assert.ok(!(await h.stash()).some((f: any) => f.title === "Old"));
    },
    'Deleted Items lists "Old" with its two pages.': async h => {
      await h.open("deleted-items.html");
      await h.waitFor(listed("Old"), '"Old" in Deleted Items');
      await h.waitFor(
        `["Page 1", "Page 2"].every(t => [...document.querySelectorAll(".forest-title")].some(e => e.textContent.trim() === t))`,
        "its two pages",
      );
    },
    'Deleted Items shows "Old" under today\'s date.': async h => {
      await h.waitFor(listed("Old"), '"Old" in Deleted Items');
    },
  });
  ```

  Check that the deleted folder's pages are actually visible in Deleted Items; they may be collapsed. If they aren't shown, reword the then step to what the page shows, e.g. "lists 'Old' with 2 tabs", and adjust the suite to match.

- [ ] **Step 3: E19 spec and suite**

  ```yaml
  id: E19
  title: Restore a folder from Deleted Items
  given:
    - A folder "Old" with Page 1 and Page 2 was deleted.
  when:
    - The user clicks "Restore" on "Old" in Deleted Items.
  then:
    - '"Old" is back in the stash with Page 1 and Page 2.'
    - Deleted Items no longer lists "Old".
  notes: |
    The restore link on a deleted item has class exactly "action stash one"
    (src/deleted-items/item.vue); rows are div.forest-item.deleted.
    Mutation check: in src/model/index.ts undelete, skip re-creating the
    bookmarks; the "back in the stash" step fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");
  const {given} = require("../../harness/fixtures.cts");

  const listed = `[...document.querySelectorAll("div.forest-item.deleted .forest-title")].some(e => e.textContent.trim() === "Old")`;

  steps(__dirname, {
    'A folder "Old" with Page 1 and Page 2 was deleted.': async h => {
      await given.deletedFolder(h, "Old", [1, 2]);
    },
    'The user clicks "Restore" on "Old" in Deleted Items.': async h => {
      await h.open("deleted-items.html");
      await h.clickInRow(
        "div.forest-item.deleted",
        "Old",
        'a[class="action stash one"]',
      );
      await h.waitUntil(
        async () => (await h.stash()).some((f: any) => f.title === "Old"),
        '"Old" to be restored',
      );
    },
    '"Old" is back in the stash with Page 1 and Page 2.': async h => {
      const old = (await h.stash()).find((f: any) => f.title === "Old");
      assert.deepEqual([...old.urls].sort(), h.pageUrls(2).sort());
    },
    'Deleted Items no longer lists "Old".': async h => {
      await h.open("deleted-items.html");
      await h.waitFor(`!(${listed})`, '"Old" to leave Deleted Items');
      // Give the lazy list a moment, then check again, so an empty-at-first
      // list can't pass by accident.
      await new Promise(r => setTimeout(r, 1000));
      assert.equal(await h.eval(listed), false);
    },
  });
  ```

  The last step must prove the list loaded before concluding "Old" is absent. Use the page's loaded or empty indicator: the "It doesn't look like you've deleted anything" footer, or a non-empty list. A fixed sleep isn't enough.

- [ ] **Step 4: Cycle, golden and commit**

  Generate E9's golden from the baseline and look at it: "Old" is listed, and the header date is blacked out. Then commit with:

  ```
  test(rfc-0002): add E7, E9 and E19, deleting and restoring folders

  E7 opens a folder's tabs and deletes it, E9 deletes a folder through its
  menu and checks Deleted Items lists it (with a golden, header date
  masked), and E19 restores a folder from Deleted Items.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 5: E11, E12 and E13, renaming, duplicates and search

**Files:** create `e2e/tests/e11-rename-folder/`, `e2e/tests/e12-duplicate-url-moves/` and `e2e/tests/e13-search-filters/`. E13 also gets a golden.

- [ ] **Step 1: E11**

  ```yaml
  id: E11
  title: Rename a folder
  given:
    - The stash has a folder "Reading" with Page 1.
  when:
    - The user clicks the title "Reading", types "Later" and presses Enter.
  then:
    - The folder is now called "Later" in the bookmarks.
  notes: |
    Clicking the title swaps it for an <input> (async-text-input.vue), which
    commits on Enter (keyup) or blur and stops key events from bubbling.
    Mutation check: in src/components/async-text-input.vue, remove the
    @keyup.enter handler; the then step fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    'The stash has a folder "Reading" with Page 1.': async h => {
      await h.seed({stash: [{title: "Reading", pages: [1]}]});
    },
    'The user clicks the title "Reading", types "Later" and presses Enter.':
      async h => {
        await h.showAllFolders();
        await h.clickInFolder("Reading", "span.forest-title.editable");
        await h.type("div.forest-item.folder input", "Later");
        await h.press("div.forest-item.folder input", "Enter");
      },
    'The folder is now called "Later" in the bookmarks.': async h => {
      await h.waitUntil(
        async () => (await h.stash()).some((f: any) => f.title === "Later"),
        'the folder to be renamed "Later"',
      );
      assert.deepEqual(
        (await h.stash()).map((f: any) => f.title),
        ["Later"],
      );
    },
  });
  ```

  Confirm the input's selector after the click. The input may carry its own class, so use whatever matches the single rename input.

- [ ] **Step 2: E12**

  ```yaml
  id: E12
  title: Stashing a URL already in the folder moves it
  given:
    - The stash has a folder "Reading" with Page 1, and Page 1 is also open.
  when:
    - The user clicks "Stash all open tabs here" on "Reading".
  then:
    - '"Reading" still holds exactly one bookmark for Page 1.'
    - step: Page 1's tab is hidden.
      browser: firefox
    - step: Page 1's tab is closed.
      browser: chrome
  notes: |
    putItemsInFolder moves an existing bookmark with the same URL (and
    title) instead of adding a duplicate. The stash list's own tab isn't
    stashable, so Page 1 is the only tab stashed.
    The folder's link has class exactly "action stash here".
    Mutation check: in src/model/index.ts putItemsInFolder, skip the
    "existing bookmark with this URL" lookup; the "exactly one bookmark" step
    fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    'The stash has a folder "Reading" with Page 1, and Page 1 is also open.':
      async h => {
        await h.seed({stash: [{title: "Reading", pages: [1]}]});
        await h.openPages([1]);
      },
    'The user clicks "Stash all open tabs here" on "Reading".': async h => {
      await h.showAllFolders();
      await h.clickInFolder("Reading", 'a[class="action stash here"]');
      await h.waitUntil(
        async () =>
          (await h.tabs({url: h.pageUrl(1), hidden: false})).length === 0,
        "Page 1 to leave the window",
      );
    },
    '"Reading" still holds exactly one bookmark for Page 1.': async h => {
      const reading = (await h.stash()).find((f: any) => f.title === "Reading");
      assert.deepEqual(reading.urls, [h.pageUrl(1)]);
      assert.equal(
        await h.eval(
          `browser.bookmarks.search({url: ${JSON.stringify(h.pageUrl(1))}}).then(r => r.length)`,
        ),
        1,
      );
    },
    "Page 1's tab is hidden.": async h => {
      const tabs = await h.tabs({url: h.pageUrl(1)});
      assert.equal(tabs.length, 1);
      assert.equal(tabs[0].hidden, true);
    },
    "Page 1's tab is closed.": async h => {
      assert.equal((await h.tabs({url: h.pageUrl(1)})).length, 0);
    },
  });
  ```

- [ ] **Step 3: E13**

  ```yaml
  id: E13
  title: Search filters the stash
  given:
    - The stash has folders "Reading" with Pages 1 and 2, and "Cooking" with Page 3.
  when:
    - The user opens the stash list with the search "Page 3".
  then:
    - Only "Cooking" and its Page 3 are shown; "Reading" and its pages are not.
    - step: The stash list shows only the matching folder.
      screenshot: search-page-3
  notes: |
    The stash list reads ?q= on load. Items that don't match get .no-match or
    aren't rendered; "shown" means rendered and visible (offsetParent set).
    Mutation check: in src/stash-list/folder.vue, make filterInfo.isMatching
    always true; the "Only Cooking" step fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  // Titles of the stash's folders and bookmarks that are actually visible.
  const visibleTitles = `[...document.querySelectorAll("ul.forest:not(.one-column) .forest-item")]
    .filter(e => e.offsetParent !== null && !e.classList.contains("no-match"))
    .map(e => e.querySelector(".forest-title")?.textContent.trim())`;

  steps(__dirname, {
    'The stash has folders "Reading" with Pages 1 and 2, and "Cooking" with Page 3.':
      async h => {
        await h.seed({
          stash: [
            {title: "Reading", pages: [1, 2]},
            {title: "Cooking", pages: [3]},
          ],
        });
      },
    'The user opens the stash list with the search "Page 3".': async h => {
      await h.open("stash-list.html?q=Page%203");
      await h.showAllFolders();
    },
    'Only "Cooking" and its Page 3 are shown; "Reading" and its pages are not.':
      async h => {
        await h.waitUntil(async () => {
          const t = await h.eval(visibleTitles);
          return t.includes("Cooking") && !t.includes("Reading");
        }, "the search to filter the list");
        const titles = await h.eval(visibleTitles);
        assert.ok(titles.includes("Page 3"));
        for (const hidden of ["Reading", "Page 1", "Page 2"])
          assert.ok(!titles.includes(hidden), hidden);
      },
    "The stash list shows only the matching folder.": async h => {
      await h.eval(`window.scrollTo(0, 0)`);
    },
  });
  ```

  Confirm `ul.forest:not(.one-column)` targets the stash's list, not the open-tabs list, and adjust it if needed.

- [ ] **Step 4: Cycle, golden and commit**

  Run the cycle, generate E13's golden from the baseline and look at it. Then commit with:

  ```
  test(rfc-0002): add E11, E12 and E13, renaming, duplicates and search

  E11 renames a folder inline, E12 stashes a page whose URL is already in
  the folder and checks it isn't duplicated, and E13 checks a search shows
  only matching folders (with a golden).

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 6: E14, E15 and E20, removed bookmarks and pinned tabs

**Files:** create `e2e/tests/e14-removed-bookmark-closes-hidden-tab/`, `e2e/tests/e15-pinned-left-out/` and `e2e/tests/e20-pinned-included-with-option/`.

- [ ] **Step 1: E14**

  ```yaml
  id: E14
  title: Removing a stashed bookmark closes its hidden tab
  browser: firefox
  given:
    - Three pages were stashed with "Stash all".
  when:
    - Page 1's bookmark is removed outside Tab Stash, as in Firefox's Library.
  then:
    - Page 1's hidden tab is closed.
    - Page 2 and Page 3 are still open and hidden.
  notes: |
    The background watches bookmark changes and closes hidden tabs whose URL
    left the stash (close_removed_bookmarks in src/index.ts). Firefox only:
    Chrome has no hidden tabs.
    Removing the bookmark with browser.bookmarks.remove is an allowed non-UI
    action: it is what the Library does.
    Mutation check: in src/index.ts, make close_removed_bookmarks return
    without closing tabs; the "hidden tab is closed" step fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");
  const {given} = require("../../harness/fixtures.cts");

  steps(__dirname, {
    'Three pages were stashed with "Stash all".': given.stashedThreePages,
    "Page 1's bookmark is removed outside Tab Stash, as in Firefox's Library.":
      async h => {
        await h.eval(`browser.bookmarks.search({url: ${JSON.stringify(h.pageUrl(1))}})
        .then(([b]) => browser.bookmarks.remove(b.id))`);
      },
    "Page 1's hidden tab is closed.": async h => {
      await h.waitUntil(
        async () => (await h.tabs({url: h.pageUrl(1)})).length === 0,
        "Page 1's tab to close",
      );
    },
    "Page 2 and Page 3 are still open and hidden.": async h => {
      for (const n of [2, 3]) {
        const tabs = await h.tabs({url: h.pageUrl(n)});
        assert.equal(tabs.length, 1);
        assert.equal(tabs[0].hidden, true);
      }
    },
  });
  ```

- [ ] **Step 2: E15**

  ```yaml
  id: E15
  title: Pinned tabs are left out of "Stash all"
  given:
    - Three local pages are open, and Page 1 is pinned.
  when:
    - The user clicks "Stash all" in the open-tabs section of the stash list.
  then:
    - The new stash folder holds Page 2 and Page 3 only.
    - Page 1 is still open, pinned and visible.
  notes: |
    stash_include_pinned defaults to false (src/model/options.ts). Pinning
    Page 1 in the given step is an allowed non-UI setup action.
    Mutation check: in src/model/index.ts, invert the stash_include_pinned
    check in stashAllTabsInWindow; the "Page 2 and Page 3 only" step fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    "Three local pages are open, and Page 1 is pinned.": async h => {
      await h.openPages(3);
      await h.eval(`browser.tabs.query({currentWindow: true, url: ${JSON.stringify(h.pageUrl(1))}})
        .then(([t]) => browser.tabs.update(t.id, {pinned: true}))`);
      await h.waitUntil(
        async () =>
          (await h.tabs({url: h.pageUrl(1), pinned: true})).length === 1,
        "Page 1 to be pinned",
      );
    },
    'The user clicks "Stash all" in the open-tabs section of the stash list.':
      async h => {
        await h.click('nav.forest-toolbar > a[class="action stash"]');
        await h.waitUntil(
          async () => (await h.stash())[0]?.urls.length === 2,
          "two pages to be stashed",
        );
      },
    "The new stash folder holds Page 2 and Page 3 only.": async h => {
      const [folder, ...rest] = await h.stash();
      assert.equal(rest.length, 0);
      assert.deepEqual(folder.urls, [h.pageUrl(2), h.pageUrl(3)]);
    },
    "Page 1 is still open, pinned and visible.": async h => {
      const tabs = await h.tabs({url: h.pageUrl(1)});
      assert.equal(tabs.length, 1);
      assert.equal(tabs[0].hidden, false);
      assert.equal((await h.tabs({url: h.pageUrl(1), pinned: true})).length, 1);
    },
  });
  ```

- [ ] **Step 3: E20**

  ```yaml
  id: E20
  title: Pinned tabs are included when the option is on
  given:
    - Three local pages are open, Page 1 is pinned, and "include pinned tabs" is on.
  when:
    - The user clicks "Stash all" in the open-tabs section of the stash list.
  then:
    - The new stash folder holds Pages 1 to 3.
    - step: Page 1 is now hidden and no longer pinned.
      browser: firefox
    - step: Page 1 is closed.
      browser: chrome
  notes: |
    Seeds sync option stash_include_pinned: true. Hiding a pinned tab
    unpins it first (src/model/tabs.ts).
    Mutation check: in src/model/index.ts, ignore stash_include_pinned (always
    leave pinned tabs out); the "Pages 1 to 3" step fails.
  ```

  Write the suite like E15's, with these changes:
  - the given step also calls `h.seed({options: {sync: {stash_include_pinned: true}}})` **before** pinning, because seeding reloads the page;
  - the when step waits for 3 stashed pages;
  - the then steps check the folder's URLs equal `h.pageUrls(3)` in tab order. On Firefox, Page 1 has `hidden: true` and isn't in a `pinned: true` query. On Chrome, Page 1 has no tab.

- [ ] **Step 4: Cycle and commit**

  ```
  test(rfc-0002): add E14, E15 and E20, removed bookmarks and pinned tabs

  E14 removes a stashed bookmark as the Library would and checks Firefox
  closes its hidden tab. E15 and E20 check "Stash all" leaves pinned tabs
  out by default and includes them with the option on.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 7: E16 and E17, privileged URLs and options

**Files:** create `e2e/tests/e16-privileged-url-redirect/` and `e2e/tests/e17-options-persist/`.

- [ ] **Step 1: E16**

  ```yaml
  id: E16
  title: Privileged URLs restore through the redirect page
  given:
    - The stash has a folder "Odd" with a bookmark "Robots" for about:robots.
  when:
    - The user clicks the bookmark "Robots" in the stash list.
  then:
    - A tab opens on Tab Stash's restore page for about:robots.
  notes: |
    Extensions can't open most about: URLs, so urlToOpen (src/util/index.ts)
    sends them to restore.html?url=<encoded URL>.
    Mutation check: in src/util/index.ts urlToOpen, return the URL unchanged;
    the then step fails.
  ```

  ```ts
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    'The stash has a folder "Odd" with a bookmark "Robots" for about:robots.':
      async h => {
        await h.seed({
          stash: [
            {title: "Odd", pages: [{title: "Robots", url: "about:robots"}]},
          ],
        });
      },
    'The user clicks the bookmark "Robots" in the stash list.': async h => {
      await h.showAllFolders();
      await h.clickInFolder(
        "Odd",
        'div.forest-item[title="Robots"] a.forest-title',
      );
    },
    "A tab opens on Tab Stash's restore page for about:robots.": async h => {
      await h.waitUntil(
        async () =>
          (await h.tabs()).some((t: any) =>
            t.url.endsWith("/restore.html?url=about%3Arobots"),
          ),
        "a tab on the restore page for about:robots",
      );
    },
  });
  ```

- [ ] **Step 2: E17**

  ```yaml
  id: E17
  title: Options persist
  given:
    - Tab Stash's options page is open.
  when:
    - The user selects "close the tab" for what happens after stashing a tab.
    - The user reloads the options page.
  then:
    - The "close the tab" choice is still selected.
    - Tab Stash's stored options say tabs are closed after stashing.
  notes: |
    The radio's id is after_stashing_tab_close (radios are <key>_<value>);
    after_stashing_tab lives in storage.local's "options" object.
    Mutation check: in src/options/index.vue, make the prop() setter skip
    model.set; both then steps fail.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    "Tab Stash's options page is open.": async h => {
      await h.open("options.html");
      await h.waitFor(
        `!!document.querySelector("#after_stashing_tab_close")`,
        "the options page",
      );
    },
    'The user selects "close the tab" for what happens after stashing a tab.':
      async h => {
        await h.click("#after_stashing_tab_close");
        await h.waitFor(
          `browser.storage.local.get("options").then(o => o.options?.after_stashing_tab === "close")`,
          "the option to be saved",
        );
      },
    "The user reloads the options page.": async h => {
      await h.open("options.html");
      await h.waitFor(
        `!!document.querySelector("#after_stashing_tab_close")`,
        "the options page",
      );
    },
    'The "close the tab" choice is still selected.': async h => {
      await h.waitFor(
        `document.querySelector("#after_stashing_tab_close").checked`,
        "the radio to be selected",
      );
    },
    "Tab Stash's stored options say tabs are closed after stashing.":
      async h => {
        const stored = await h.eval(
          `browser.storage.local.get("options").then(o => o.options.after_stashing_tab)`,
        );
        assert.equal(stored, "close");
      },
  });
  ```

  The radio may be inside an advanced section hidden unless `meta_show_advanced` is on. If it is, either seed `meta_show_advanced: true` in the given step, or rely on a synthetic `click()` still working on a hidden input. Say which in the notes.

- [ ] **Step 3: Cycle and commit**

  ```
  test(rfc-0002): add E16 and E17, privileged URLs and options

  E16 restores an about: bookmark and checks it opens through Tab Stash's
  restore page. E17 changes an option and checks it survives a reload of
  the options page and is stored.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 8: E18 and E21, the popup and sidebar views

**Files:** create `e2e/tests/e18-popup-view/` and `e2e/tests/e21-sidebar-view/`, each with a golden.

- [ ] **Step 1: E18**

  ```yaml
  id: E18
  title: The popup view renders
  given:
    - The stash has a folder "Reading" with Page 1 and Page 2.
  when:
    - The user opens the stash list in its popup view.
  then:
    - The page is in the popup view and the stash list renders.
    - step: The popup view shows "Reading" with its two pages.
      screenshot: popup-view
  notes: |
    ?view=popup sets html[data-view=popup] (src/launch-vue.ts) and the layout
    follows it.
    Mutation check: in src/launch-vue.ts, don't set dataset.view; the "popup
    view" step fails.
  ```

  ```ts
  const assert = require("node:assert/strict");
  const {steps} = require("../../harness/runner.cts");

  steps(__dirname, {
    'The stash has a folder "Reading" with Page 1 and Page 2.': async h => {
      await h.seed({stash: [{title: "Reading", pages: [1, 2]}]});
    },
    "The user opens the stash list in its popup view.": async h => {
      await h.open("stash-list.html?view=popup");
    },
    "The page is in the popup view and the stash list renders.": async h => {
      await h.waitFor(
        `!!document.querySelector("main.stash-list")`,
        "the stash list",
      );
      assert.equal(
        await h.eval(`document.documentElement.dataset.view`),
        "popup",
      );
    },
    'The popup view shows "Reading" with its two pages.': async h => {
      await h.showAllFolders();
    },
  });
  ```

- [ ] **Step 2: E21**

  E21 is the same as E18, with `?view=sidebar` and `dataset.view === "sidebar"`, a golden named `sidebar-view`, and a top-level `browser: firefox`. Its notes add that Chrome has no sidebar. Its mutation check is the same edit as E18's.

- [ ] **Step 3: Cycle, goldens and commit**

  ```
  test(rfc-0002): add E18 and E21, the popup and sidebar views

  The stash list renders in its popup and sidebar layouts, compared with
  goldens; the sidebar case is Firefox-only.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 9: E10, deleted items surviving a background restart

**Files:**

- Modify: `e2e/harness/firefox.cts` (adapter `restartBackground`)
- Modify: `e2e/harness/driver.cts` (driver `restartBackground`)
- Create: `e2e/tests/e10-deleted-items-survive-restart/{spec.yml,suite.cts}`

**Interfaces:** produces `h.restartBackground(): Promise<void>` on the driver, and `restartBackground()` on the adapter.

- [ ] **Step 1: Make the background restartable on Firefox**

  In the adapter's returned object (`firefox.cts`), add:

  ```ts
  // Reloads the add-on, which restarts its background page while keeping the
  // profile (and so IndexedDB).  The reload unloads the test's page, so the
  // driver reopens it afterwards.
  async restartBackground() {
    await evaluateIn(context, `setTimeout(() => browser.runtime.reload(), 0); true`);
    await new Promise(r => setTimeout(r, 1000));
  },
  ```

  In the driver, add:

  ```ts
  // Restarts the extension's background (Firefox reloads the add-on; Chrome
  // will stop its service worker), then reopens the current page.
  async restartBackground(): Promise<void> {
    await this.adapter.restartBackground();
    await this.waitUntil(
      async () => {
        try {
          await this.open(this.page);
          return await this.eval(`!!globalThis.the`);
        } catch {
          return false;
        }
      },
      "the extension to come back after restarting its background",
    );
  }
  ```

  **Verify this works.** After a restart:
  - the page reopens at the same pinned `moz-extension://` URL;
  - `browser.storage` still holds the seeded options;
  - the add-on is still installed.

  If `browser.runtime.reload()` removes a temporary add-on instead of reloading it, try reinstalling with Puppeteer's `installExtension(dist)` in the adapter, keeping the profile.

  **If neither works reliably, stop.** Report BLOCKED with the evidence. The RFC's fallback is to drop E10 and note it in `TASKS.md`; the controller makes that call.

- [ ] **Step 2: E10 spec and suite**

  ```yaml
  id: E10
  title: Deleted items survive a background restart
  given:
    - A folder "Old" with Page 1 and Page 2 was deleted.
  when:
    - The extension's background restarts.
  then:
    - Deleted Items still lists "Old".
  notes: |
    Deleted items live in IndexedDB behind the background's store service;
    on Firefox the restart reloads the add-on, keeping the profile.
    Mutation check: in src/datastore/kvs/service.ts set(), skip writing to
    IndexedDB (no put); the then step fails.
  ```

  ```ts
  const {steps} = require("../../harness/runner.cts");
  const {given} = require("../../harness/fixtures.cts");

  steps(__dirname, {
    'A folder "Old" with Page 1 and Page 2 was deleted.': async h => {
      await given.deletedFolder(h, "Old", [1, 2]);
    },
    "The extension's background restarts.": async h => {
      await h.restartBackground();
    },
    'Deleted Items still lists "Old".': async h => {
      await h.open("deleted-items.html");
      await h.waitFor(
        `[...document.querySelectorAll("div.forest-item.deleted .forest-title")].some(e => e.textContent.trim() === "Old")`,
        '"Old" in Deleted Items after the restart',
      );
    },
  });
  ```

- [ ] **Step 3: Cycle and commit**

  ```
  test(rfc-0002): add E10, deleted items surviving a background restart

  The Firefox adapter can restart the extension's background by reloading
  the add-on, and E10 checks a deleted folder is still in Deleted Items
  afterwards.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 10: Record Phase B and C results (controller)

- [ ] **Step 1:** Run `bin/e2e test --browser=firefox --ref=622bf3d` three times and `bin/e2e test --browser=firefox` three times. All must pass.
- [ ] **Step 2:** Record the test time per run and the grep result.
- [ ] **Step 3:** In the RFC, add `### Phase B and C results` after "Phase A results". Include the pass counts, the timings against the five-minute budget, every spec's mutation check and its failing step, deviations, and anything dropped. Resolve Open questions 2 (E10) and 4 (Alt-click, E4), or update them.
- [ ] **Step 4:** Commit:

  ```
  docs(rfc-0002): record Phase B and C results

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
