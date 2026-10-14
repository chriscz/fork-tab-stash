# Phase 3 Chrome Parity Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run RFC 0002's end-to-end suite on the Chrome MV3 build, make every spec that applies to Chrome pass for the right reasons, and fix the extension where Chrome shows it is broken.

**Architecture:** A second adapter, `e2e/harness/chrome.cts`, implements the same contract as `firefox.cts` with plain Puppeteer (CDP). The driver, runner, fixtures and suites stay browser-neutral; the few places that pass Firefox-only query keys to `browser.tabs.query` or read Firefox-only session values move that logic into the driver first, so the Firefox suite is unchanged. `make check-e2e-chrome` and `bin/e2e --browser=chrome` then run the whole suite, and triage sorts each failure into a suite fix or an extension fix.

**Tech Stack:** Puppeteer 25.13.0, Chrome for Testing 155.0.8059.39, Firefox 157.0.1 (all pinned in `install-test-deps.sh`), node:test with `.cts` type stripping on Node 22, js-yaml 5.4.3, the dev Docker image (`bin/dev`).

**Spec:** [RFC 0001](../0001_chrome-mv3-separate-manifest.md) Phase 3, "Automated parity run" (commit `9d2d927`). Harness design: [RFC 0002](../0002_firefox-baseline-e2e-suite.md). Research notes (not committed): `.superpowers/sdd/chrome-research.md`.

## Global Constraints

- Commits: Conventional Commits with scope `rfc-0001`, e.g. `test(rfc-0001): …`, `fix(rfc-0001): …`, `docs(rfc-0001): …`; changes to RFC 0002's text use `docs(rfc-0002): …`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gerrit-style stack: each commit builds, passes `bin/dev run make`, and stands alone. Never push, amend or rebase.
- Never reference RFCs (numbers, sections, `rfcs/` links) in code, comments, tests or build files.
- The Firefox suite must stay green after every commit: `bin/e2e test --browser=firefox` (133/133 today) and `bin/e2e test --browser=firefox --ref=622bf3d` (123/123 today).
- Suites never call browser automation or browser internals directly (`grep -rE "connection\.send|Services\.|gBrowser|page\.|worker\." e2e/tests` prints nothing). Browser specifics live in the adapters; browser differences in specs are stated with `browser:` on steps.
- No `<any>` casts. Reuse existing helpers (`h.tabs`, `h.stash`, `h.waitUntil`, `h.waitFor`, `given.*`) rather than ad-hoc code.
- Upstream has no loadable Chrome build, so Chrome results can't be checked against `622bf3d`. A Chrome-only step is trusted only with a mutation check that fails it on Chrome, recorded in the spec's notes as a literal edit with `file:line`.
- Extension fixes keep Firefox behaviour unchanged (RFC 0001 Goal 2) and come with a unit test where the code is unit-testable.
- Bugs found that aren't this phase's job go to `TASKS.md` (where, what, effect, how found, fix).
- `bin/dev run make` has a known ~0.1% unit-test flake in `src/model/deleted-items.test.ts` ("cat"); rerun if that is the only failure.

## Known facts (probed 2026-10-14 in the dev image)

- Chrome's `browser.tabs.query({currentWindow: true, hidden: false})` throws `Error at parameter 'queryInfo': Unexpected property: 'hidden'.`
- `browser.sessions.getTabValue` is `undefined` on Chrome.
- Puppeteer's headless Chrome starts with exactly one page, and `navigator.language` is `en-US`.
- On Chrome, stashing closes tabs instead of hiding them (`src/model/tabs.ts:634-662`); `urlToOpen` sends `about:` URLs to `restore.html` on every browser (`src/util/index.ts:115-128`).

## File structure

- Modify `e2e/harness/driver.cts`: `tabs()` filters `hidden` itself; `tabMarker()` is `false` where session values don't exist.
- Modify `e2e/harness/fixtures.cts`, `e2e/tests/e02-stash-all/suite.cts`, `e2e/tests/e04-copy-keeps-tabs/suite.cts`: use `h.tabs({hidden})` instead of raw hidden queries; drop E04's marker catch.
- Create `e2e/harness/chrome.cts`: the Chrome adapter.
- Modify `Makefile`: `check-e2e-chrome` runs the suites on `dist-chrome`; `check-e2e-ref` works for both browsers; an `E2E_SPECS` variable narrows a run.
- Modify `bin/e2e`: allow `--ref` and `--update-goldens` for Chrome.
- Modify `e2e/harness/runner.cts`: the missing-golden message no longer assumes a baseline commit.
- Modify spec notes and suites as triage requires; add `screenshots/chrome/` goldens.
- Modify `rfcs/0001_chrome-mv3-separate-manifest.md` (parity table) and `rfcs/0002_firefox-baseline-e2e-suite.md` (Chrome text that is now stale).

## Commit stack

| Task | Commit                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | `docs(rfc-0001): run the end-to-end suite on Chrome in Phase 3` (done, `9d2d927`)                             |
| 0    | `docs(rfc-0001): add the Phase 3 parity-run plan` (this file)                                                 |
| 1    | `test(rfc-0001): filter hidden tabs in the driver, not in tabs.query`                                         |
| 2    | `test(rfc-0001): add a Chrome adapter and run the suite on Chrome`                                            |
| 3    | `test(rfc-0001): build and compare Chrome against a pinned commit`                                            |
| 4    | triage: one commit per fix (`test(rfc-0001): …` or `fix(rfc-0001): …`)                                        |
| 5    | `test(rfc-0001): record mutation checks for the Chrome-only steps`                                            |
| 6    | `test(rfc-0001): add Chrome goldens`                                                                          |
| 7    | `docs(rfc-0001): record the Chrome parity results` and `docs(rfc-0002): describe the Chrome adapter as built` |

---

### Task 1: Filter hidden tabs in the driver, not in tabs.query

**Files:**

- Modify: `e2e/harness/driver.cts` (`tabs()`, `tabMarker()`, around lines 283-308)
- Modify: `e2e/harness/fixtures.cts:13-20`
- Modify: `e2e/tests/e02-stash-all/suite.cts:36-43`
- Modify: `e2e/tests/e04-copy-keeps-tabs/suite.cts` (the `tabMarker(...).catch(() => false)` and its spec note)

**Interfaces:**

- Produces: `h.tabs(query: {url?: string | string[]; hidden?: boolean; [key: string]: unknown})` with the same return shape; `hidden` never reaches `browser.tabs.query`. `h.tabMarker(tabId): Promise<boolean>` returns `false` when `browser.sessions.getTabValue` is missing.

- [ ] **Step 1: Change `tabs()`**

```ts
  // Tabs in the page's window, in tab order.  `url` (a string or an array) is
  // matched exactly here rather than passed to browser.tabs.query, because
  // that treats it as a match pattern, and match patterns can't carry a port,
  // so the local test pages would match nothing.  `hidden` is matched here too:
  // Chrome rejects it as a query key, and its tabs are never hidden.
  tabs(
    query: {url?: string | string[]; hidden?: boolean; [key: string]: unknown} = {},
  ): Promise<
    Array<{id: number; url: string; hidden: boolean; active: boolean}>
  > {
    const {url, hidden, ...rest} = query;
    const urls = JSON.stringify(url === undefined ? null : [url].flat());
    const wantHidden = JSON.stringify(hidden ?? null);
    return this
      .eval(`browser.tabs.query(${JSON.stringify({...rest, currentWindow: true})})
      .then(ts => ts
        .filter(t => ${urls} === null || ${urls}.includes(t.url))
        .filter(t => ${wantHidden} === null || !!t.hidden === ${wantHidden})
        .map(t => ({id: t.id, url: t.url, hidden: !!t.hidden, active: t.active})))`);
  }
```

- [ ] **Step 2: Change `tabMarker()`**

```ts
  // Whether Tab Stash marked this tab as hidden by itself.  Browsers without
  // session values (Chrome) can't mark tabs, so the answer there is false.
  tabMarker(tabId: number): Promise<boolean> {
    return this.eval(`browser.sessions?.getTabValue
      ? browser.sessions.getTabValue(${tabId}, ${JSON.stringify(HIDDEN_MARKER)})
          .then(v => v === true)
      : false`);
  }
```

- [ ] **Step 3: Replace the raw hidden queries that run on both browsers**

In `fixtures.cts` `stashedThreePages`, replace the `h.waitFor(browser.tabs.query({currentWindow: true, hidden: false})…)` with:

```ts
await h.waitUntil(
  async () => (await h.tabs({url: h.pageUrls(3), hidden: false})).length === 0,
  "the three pages to leave the window",
);
```

In `e02-stash-all/suite.cts`, the screenshot step's wait becomes:

```ts
await h.waitUntil(
  async () => (await h.tabs({hidden: false})).length === 1,
  "one visible tab",
);
```

Leave raw `hidden: true` queries in steps marked `browser: firefox` (E02 "hidden and marked", E03 "hidden") as they are: they never run on Chrome. In E04, replace `h.tabMarker(t.id).catch(() => false)` with `h.tabMarker(t.id)` and drop the now-untrue Chrome remark from its notes.

- [ ] **Step 4: Verify Firefox is unchanged**

Run: `bin/dev run node --test e2e/harness/runner.test.cts` — expect `# pass 10`.
Run: `bin/e2e test --browser=firefox` — expect `# pass 133`, `# fail 0`.
Run: `bin/e2e test --browser=firefox --ref=622bf3d` — expect `# pass 123`, `# fail 0`.
Run: `bin/dev run make` — expect exit 0.

- [ ] **Step 5: Commit** `test(rfc-0001): filter hidden tabs in the driver, not in tabs.query`, body: Chrome rejects `hidden` in `tabs.query` and has no session values, so the driver handles both; Firefox behaviour is unchanged.

---

### Task 2: A Chrome adapter, and the suite on Chrome

**Files:**

- Create: `e2e/harness/chrome.cts`
- Modify: `Makefile` (`check-e2e-chrome`, `E2E_DIST`, new `E2E_SPECS`)
- Modify: `e2e/harness/driver.cts` only if a comment there wrongly says something is Firefox-only

**Interfaces:**

- Consumes: the adapter contract `firefox.cts` implements — `launchAdapter({dist}) => Promise<{open(page), eval(js), screenshot(): Promise<Buffer>, errors(): Promise<string[]>, restartBackground(), close()}>`. `driver.cts` loads `./${browser}.cts`.
- Produces: `make check-e2e-chrome` runs `e2e/chrome.test.cjs` and then the spec suites with `E2E_BROWSER=chrome E2E_DIST=dist-chrome`. `make check-e2e-chrome E2E_SPECS=e2e/tests/e01-*/suite.cts` narrows the run.

- [ ] **Step 1: Write the adapter**

```ts
// Chrome adapter for the end-to-end driver.  Chrome drives extension pages
// through Puppeteer's ordinary page API over CDP, so this needs no browser
// internals.  The background is a service worker that Chrome may stop and
// start again at any time; restartBackground() stops it on purpose.

const puppeteer = require("puppeteer");

async function launchAdapter({dist}: {dist: string}) {
  const browser = await puppeteer.launch({
    headless: true, // new headless; the old one can't load extensions
    pipe: true, // loading unpacked extensions goes over the CDP pipe
    enableExtensions: true,
    // The container has no user namespaces for the sandbox and a small /dev/shm
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"],
    env: {...process.env, LANG: "en_US.UTF-8", LANGUAGE: "en_US"},
  });

  // Uncaught errors from the extension's pages and service workers, collected
  // as they happen because CDP doesn't keep a log to read back later.
  const errors: string[] = [];
  let baseUrl = "";
  const watch = async (target: any) => {
    if (!baseUrl || !target.url().startsWith(baseUrl)) return;
    if (target.type() === "page") {
      const p = await target.page();
      p?.on("pageerror", (e: Error) =>
        errors.push(`${target.url()}: ${e.message}`),
      );
    } else if (target.type() === "service_worker") {
      const w = await target.worker();
      w?.client.on("Runtime.exceptionThrown", (ev: any) =>
        errors.push(
          `${target.url()}: ${ev.exceptionDetails.exception?.description ?? ev.exceptionDetails.text}`,
        ),
      );
    }
  };

  let page: any;
  try {
    const id: string = await browser.installExtension(dist);
    baseUrl = `chrome-extension://${id}/`;
    browser.on("targetcreated", watch);
    for (const t of browser.targets()) await watch(t);

    // Use the tab Chrome starts with, so the window holds only the tabs a test
    // opens itself; "stash all" would also stash an extra blank tab.
    const pages = await browser.pages();
    if (pages.length !== 1) {
      throw new Error(`Expected one tab at start, found ${pages.length}`);
    }
    page = pages[0];
    await page.setViewport({width: 1000, height: 700, deviceScaleFactor: 1});
  } catch (e) {
    await browser.close();
    throw e;
  }
  const isBackground = (t: any) =>
    t.type() === "service_worker" && t.url() === `${baseUrl}index.js`;

  return {
    async open(path: string) {
      await page.goto(baseUrl + path, {waitUntil: "load"});
    },

    // Evaluates js (an expression, possibly a promise) in the page and returns
    // its JSON-serialisable value.
    async eval(js: string) {
      const json = await page.evaluate(
        `(async () => JSON.stringify(await (${js})) ?? "null")()`,
      );
      return JSON.parse(json);
    },

    async screenshot(): Promise<Buffer> {
      return Buffer.from(await page.screenshot({type: "png"}));
    },

    async errors(): Promise<string[]> {
      return [...errors];
    },

    // Stops the extension's service worker, as Chrome does when it is idle.
    // The test's tab leaves the extension first, so no open page wakes the
    // worker straight back up; the driver reopens the page, which wakes it.
    async restartBackground() {
      await page.goto("about:blank", {waitUntil: "load"});
      const target = browser.targets().find(isBackground);
      if (!target)
        throw new Error("The extension's service worker isn't running");
      await (await target.worker()).close();
      const end = Date.now() + 30_000;
      while (browser.targets().includes(target)) {
        if (Date.now() > end) throw new Error("The service worker didn't stop");
        await new Promise(r => setTimeout(r, 100));
      }
    },

    close: () => browser.close(),
  };
}

module.exports = {launchAdapter};
```

If `browser.installExtension(dist)` doesn't return the id in Puppeteer 25.13.0, take the id from the service worker target as `e2e/chrome.test.cjs` does (`waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("/index.js"))`, then `new URL(target.url()).host`), and use `enableExtensions: [dist]`. If `worker.client` or `Runtime.exceptionThrown` doesn't surface service-worker exceptions, prove which mechanism does (throw deliberately from the worker with `target.worker().then(w => w.evaluate("setTimeout(() => { throw new Error('probe') })"))`) and use that. Record what you found in a comment. Use the `any` type annotation only where Puppeteer's types aren't importable in `.cts`, as `firefox.cts`'s surroundings do; no `<any>` casts.

- [ ] **Step 2: Wire the Makefile**

```make
check-e2e-chrome: build-chrome-dbg
	node --test e2e/chrome.test.cjs
	TZ=UTC E2E_BROWSER=chrome E2E_DIST=dist-chrome node --test $(E2E_SPECS)
.PHONY: check-e2e-chrome

E2E_DIST ?= dist
E2E_SPECS ?= e2e/tests/*/suite.cts

check-e2e-firefox: build-dbg
	TZ=UTC E2E_BROWSER=firefox E2E_DIST=$(E2E_DIST) node --test e2e/harness/runner.test.cts $(E2E_SPECS)
.PHONY: check-e2e-firefox
```

- [ ] **Step 3: Smoke test**

Run: `bin/dev run make check-e2e-chrome E2E_SPECS='e2e/tests/e01-*/suite.cts'` — expect the gc-alarm test and E01 to pass.
Then prove the error collection works: temporarily add `throw new Error("probe")` at the top of `src/stash-list/index.ts` (or the stash list's entry), rebuild, rerun E01 — its "no errors were logged" step must fail naming that error. Restore with `git checkout -- <file>`. Do the same for the service worker (temporarily `setTimeout(() => { throw new Error("probe-bg") }, 0)` at the top of `src/index.ts`).

- [ ] **Step 4: Full Chrome run (expected to have failures)**

Run: `bin/dev run make check-e2e-chrome`. Save the output to `.superpowers/sdd/p3-task-2-chrome-run.txt`. Don't fix spec failures in this task; Task 4 triages them. This task is done when the adapter works (E01 passes, both error paths proven), the Firefox suite is unchanged (Task 1's verify commands), and `bin/dev run make` exits 0.

- [ ] **Step 5: Commit** `test(rfc-0001): add a Chrome adapter and run the suite on Chrome`.

---

### Task 3: Build and compare Chrome against a pinned commit

**Files:**

- Modify: `Makefile` (`check-e2e-ref`)
- Modify: `bin/e2e`
- Modify: `e2e/harness/runner.cts` (missing-golden message, around line 221)

**Interfaces:**

- Produces: `make check-e2e-ref E2E_REF=<commit> E2E_BROWSER=chrome` builds `build-chrome-dbg` in the cached clone and runs the suites against `<clone>/dist-chrome`; `E2E_BROWSER` defaults to `firefox`. `bin/e2e test --browser=chrome --ref=<commit> [--update-goldens]` maps to it.

- [ ] **Step 1: Generalise `check-e2e-ref`**

```make
E2E_BROWSER ?= firefox

check-e2e-ref:
	@test -n "$(E2E_REF)" || { echo "Set E2E_REF=<commit>" >&2; exit 1; }
	@case "$(E2E_BROWSER)" in \
	  firefox) build=build-dbg; out=dist ;; \
	  chrome) build=build-chrome-dbg; out=dist-chrome ;; \
	  *) echo "E2E_BROWSER must be firefox or chrome" >&2; exit 1 ;; \
	esac; \
	sha="$$(git rev-parse --verify --quiet "$(E2E_REF)^{commit}")" || { \
	  echo "E2E_REF does not resolve to a commit: $(E2E_REF)" >&2; exit 1; }; \
	dir="node_modules/.cache/e2e-ref/$$sha"; \
	test -e "$$dir/.e2e-built-$$build" || ( \
	  ( test -d "$$dir/.git" || { rm -rf "$$dir" && git clone --quiet . "$$dir"; } ) && \
	  git -C "$$dir" checkout --quiet "$$sha" && \
	  $(MAKE) -C "$$dir" $$build && \
	  touch "$$dir/.e2e-built-$$build" ) && \
	TZ=UTC E2E_BROWSER=$(E2E_BROWSER) E2E_DIST="$$dir/$$out" node --test $(E2E_SPECS)
.PHONY: check-e2e-ref
```

Keep the existing comment above the target and extend it: the marker is per build target, so a commit's Firefox and Chrome builds are cached side by side; a ref from before the Chrome MV3 work builds but won't load in Chrome, and the run fails at launch. Existing caches with the old `.e2e-built` marker are simply rebuilt once.

- [ ] **Step 2: `bin/e2e`**

Remove the Chrome-only refusal; pass the browser through:

```bash
    if [ -n "$ref" ]; then
        exec "$ROOT/bin/dev" run env UPDATE_SCREENSHOTS="$update" \
            make check-e2e-ref E2E_REF="$ref" E2E_BROWSER="$browser"
    fi
    exec "$ROOT/bin/dev" run make "check-e2e-$browser"
```

Update the usage text: `--ref` builds `<commit>` for the chosen browser; Firefox goldens come from upstream `622bf3d`, Chrome goldens from a pinned commit of this fork (upstream has no Chrome build that loads). Add the example `bin/e2e test --browser=chrome --ref=<commit> --update-goldens`.

- [ ] **Step 3: Runner message**

```ts
assert.fail(
  `No golden ${rel}. Generate it from a reviewed commit with: bin/e2e test --browser=${browser} --ref=<commit> --update-goldens`,
);
```

- [ ] **Step 4: Verify**

Run: `bin/e2e test --browser=firefox --ref=622bf3d` — expect 123/123 (rebuilds the cache once with the new marker).
Run: `bin/e2e test --browser=chrome --ref=HEAD` — expect the same results as Task 2's full Chrome run (same failures).
Run: `bin/e2e test --browser=chrome --ref=622bf3d` — expect a clear failure at launch, not a hang; note the message in the report.
Run: `bin/e2e help` and `bin/e2e test --browser=chrome --update-goldens` (no ref) — expect the help text and the "needs --ref" error.
Run: `bin/dev run node --test e2e/harness/runner.test.cts` and `bin/dev run make` — expect pass and exit 0.

- [ ] **Step 5: Commit** `test(rfc-0001): build and compare Chrome against a pinned commit`.

---

### Task 4: Triage every Chrome failure

This task is discovery, run by the controller as a loop. Each finding becomes its own small task and commit, dispatched to one implementer at a time and reviewed.

- [ ] **Step 1: Classify.** For each failing spec in the latest full Chrome run, find the root cause (superpowers:systematic-debugging) and write it to `.superpowers/sdd/p3-triage.md` as one row: spec, failing step, error, cause, class, proposed fix. Classes:
  - **suite**: the spec or suite asserts something Chrome legitimately does differently (a step needs `browser: firefox`/`chrome` variants, or a selector or wait is Firefox-specific). Fix: `test(rfc-0001): …`. A new `browser: chrome` step needs a mutation check (Task 5's rules).
  - **harness**: the Chrome adapter or the driver is wrong. Fix in `chrome.cts`/`driver.cts`: `test(rfc-0001): …`. Firefox must stay green.
  - **extension**: Tab Stash misbehaves on Chrome. Fix in `src/` at the source: `fix(rfc-0001): …`, with a unit test where the code is unit-testable, Firefox behaviour unchanged, and the spec as the end-to-end proof.
  - **architectural**: needs work RFC 0001 rules out (e.g. operations cut off when the popup closes). Don't fix: mark the step or spec `browser: firefox` with a note naming the gap, add it to `TASKS.md`, and list it for a further RFC in Task 7.
- [ ] **Step 2: Fix one finding per commit**, highest-impact first (a harness fix may clear several specs). After each: `bin/dev run make check-e2e-chrome E2E_SPECS=<affected suites>` green, the Firefox suite green on both builds, `bin/dev run make` exits 0.
- [ ] **Step 3: Repeat** until a full `bin/dev run make check-e2e-chrome` passes, or every remaining failure is classed architectural.
- [ ] **Step 4: Flakiness.** Chrome may stop an idle worker by itself mid-test. Run the full Chrome suite three times in a row; any intermittent failure goes back to Step 1 with its cause (don't add sleeps or retries that hide it).

Expected areas (from the research notes): launch timing out on `last_notified_version`; service-worker errors at start or wake; E10 after a worker stop (the kvs service's client list is lost on restart); restore ordering through the loading queue (E06, E07, E19); E08's undo; `refocusAwayFromTabs` when closing tabs; E05's and E02's unscoped folder-title selectors matching open-tab group rows.

---

### Task 5: Mutation checks for the Chrome-only steps

**Files:** the `spec.yml` notes of every spec with a `browser: chrome` step (today E02, E03, E05, E12, E20, plus any added in Task 4), and E10.

- [ ] **Step 1:** For each Chrome-only step, find a literal edit in `src/` that makes exactly that step fail on Chrome (e.g. for "The three tabs are closed": make the no-`tabs.hide` fallback in `src/model/tabs.ts` skip `this.remove()`). Run `bin/dev run make check-e2e-chrome E2E_SPECS=<suite>` with the edit, confirm the named step fails, restore with `git checkout -- <file>`.
- [ ] **Step 2:** For E10 on Chrome, show the restart is real: the existing notes' second mutation (`indexedDB.deleteDatabase(db_name);` at the top of `openPersistentDB()`, `src/datastore/kvs/service.ts`) must fail E10 on Chrome while E09 still passes.
- [ ] **Step 3:** Add a `Chrome mutation check:` line to each spec's notes, with the literal edit and the step that fails. Commit `test(rfc-0001): record mutation checks for the Chrome-only steps`.

---

### Task 6: Chrome goldens

**Files:** `e2e/tests/{e02,e06,e09,e13,e18}-*/screenshots/chrome/*.png`

- [ ] **Step 1:** Pin the commit: the stack's top after Task 5 (`git rev-parse --short HEAD`).
- [ ] **Step 2:** Run `bin/e2e test --browser=chrome --ref=<pin> --update-goldens`. Confirm with `git status` that only `screenshots/chrome/` files were written.
- [ ] **Step 3:** Review each PNG with the Read tool next to its Firefox golden: same content (folders, pages, footer), masks covering every date, time and the focused search box; Chrome-specific styling is expected. Anything wrong is a finding for Task 4, not a golden.
- [ ] **Step 4:** Run `bin/e2e test --browser=chrome` three times, some a minute or more apart: no screenshot differences.
- [ ] **Step 5:** Commit `test(rfc-0001): add Chrome goldens`, naming the pinned commit in the body.

---

### Task 7: Record the results (controller)

- [ ] **Step 1:** Run `bin/e2e test --browser=chrome` three times, `bin/e2e test --browser=firefox` three times and `bin/e2e test --browser=firefox --ref=622bf3d` once. All must pass. Record counts and times.
- [ ] **Step 2:** In RFC 0001, add `### Phase 3 parity results` after Phase 3: a table with one row per spec (ID, title, Chrome result: pass / skipped (Firefox-only) / deferred, and the Chrome mutation check where there is one), the extension bugs fixed (commit, cause), the architectural gaps handed to a further RFC, and which Phase 3 manual checks remain. Update Success criteria status if met. Commit `docs(rfc-0001): record the Chrome parity results`.
- [ ] **Step 3:** In RFC 0002, replace text that is now stale: the driver table's Chrome column (it says `page.click`/`page.waitForFunction`; the adapter only needs `goto`, `evaluate`, `screenshot`, `pageerror`, and the worker for restarts), "Firefox only, for now", the `bin/e2e`/Makefile docs (`check-e2e-chrome`, `--ref` for Chrome), the "Running the suite on Chrome" non-goal and "After this RFC" (now done in RFC 0001 Phase 3), and the catalogue's "Expected on Chrome (unverified)" column header. Commit `docs(rfc-0002): describe the Chrome adapter as built`.

---

## Deviations

Where the work departed from this plan:

- **The "Known facts" bullet on `about:` URLs was wrong for Chrome.** Chrome's bookmarks API stores `about:robots` as `chrome://robots/`, and `urlToOpen()` opens `chrome:` URLs directly, so the restore page never appears there. E16 gained a Chrome step that checks the tab opens on exactly `chrome://robots/`.
- **Triage found two extension bugs, not only suite fixes.** Restoring opened nothing on Chrome (`tabs.create` got an empty `cookieStoreId`), and "Stash all" did nothing (the insertion index advanced past skipped items). Both are fixed with unit tests, and the two fix commits were moved to the bottom of the stack so they can go upstream on their own.
- **Goldens needed a rendering flag, and were pinned to its commit.** Chrome's screenshots varied between runs until it was launched with `--disable-partial-raster`, which got its own commit. The goldens were pinned to that commit rather than to the stack's top after Task 5.
- **E05's Chrome step was strengthened.** It also checks that the restored tab is active, so it can fail on its own instead of repeating the shared "Exactly one tab" step.
- **The suite line in `check-e2e-chrome` lands with the goldens.** Task 2's commit adds only the adapter, so `make check-e2e-chrome` stays green at every commit; it runs the spec suites from the goldens commit on.
