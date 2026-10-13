# Firefox-Baseline E2E Suite, Phase A: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [RFC 0002](../0002_firefox-baseline-e2e-suite.md), Phase A. Section references such as "§2" point into it.

**Goal:** a spec-driven end-to-end suite for Firefox. It contains the step runner, the browser-neutral driver, the Firefox adapter, `bin/e2e`, and tests E1, E2 (with a golden screenshot) and E8. Every test passes against upstream's unmodified code (`622bf3d`) and against our branch.

**Architecture:**

- **Specs and suites.** Each test is a folder under `e2e/tests/` with a plain-English `spec.yml` and a `suite.cts` that binds one function to each step by exact text.
- **The runner.** `e2e/harness/runner.cts` reads the spec, checks the binding, and runs the steps in order as `node:test` subtests. It takes screenshots, compares them with goldens, and checks for errors.
- **The driver.** Suites only call `h`, the driver in `e2e/harness/driver.cts`.
- **The adapter.** The driver delegates the few browser-specific primitives to `e2e/harness/firefox.cts`. Chrome's adapter belongs to RFC 0001.

**Tech Stack:**

- Node 22.23, which runs `.cts` by stripping the types;
- `node:test` and `node:assert/strict`;
- Puppeteer 25.13.0 driving Firefox 157 over WebDriver BiDi;
- `js-yaml`, installed globally by `install-test-deps.sh`;
- GNU make, bash, and the `bin/dev` Docker wrapper.

## Global Constraints

- **Docker only.** Everything runs in the dev Docker image: node and make via `bin/dev run <cmd>`, e2e tests via `bin/e2e`. Git runs on the host.
- **Test-only tools.** Test-only packages (Puppeteer, `js-yaml`) are installed by `install-test-deps.sh`, never in `package.json` or `package-lock.json`. After changing that script, rebuild the image with `bin/dev image build`.
- **Protected files.** `assets/manifest.json`, `install-deps.sh`, `package.json`, `package-lock.json` and everything under `src/` must not change.
- **Suites are browser-neutral.** They never call BiDi, CDP or Firefox internals. `grep -rE "connection\.send|Services\.|gBrowser" e2e/tests` must print nothing. Browser-specific code lives only in `e2e/harness/firefox.cts`.
- **Spec format** (§1):
  - fields `id`, `title`, `given`, `when`, `then`, `notes`, and optional `browser` and `clock`;
  - a step is a string or `{step, browser?, screenshot?}`;
  - `screenshot: true` → `then-<n>`, counting every `then` step from 1, unfiltered;
  - `screenshot: <name>` → `<name>.png`;
  - goldens live in `screenshots/<browser>/`;
  - duplicate step text is an error.
- **Runner rules** (§2):
  - steps run in `given`, `when`, `then` order;
  - a failed `given` or `when` skips the remaining steps, while every `then` step runs;
  - binding is enforced for the browser under test only, plus "no function matches no step";
  - a final subtest asserts no errors were logged.
- **The baseline** is upstream commit `622bf3d`. Goldens are generated only from it: `bin/e2e test --browser=firefox --ref=622bf3d --update-goldens`.
- **Commits:** a Conventional Commit with scope `rfc-0002`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Each commit leaves `bin/dev run make` passing (625 tests), plus whatever e2e command its task names.
- **Comments** explain why. They never reference RFCs (`CLAUDE.md`).
- **Deviations.** If a task can't be done as written without contradicting RFC 0002, stop and report it. The controller updates the RFC first, in a `docs(rfc-0002)` commit.

## File Structure

| File                                                                                          | Change | Responsibility                                                                                                     |
| --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `bin/e2e`                                                                                     | create | Entrypoint: turns `test --browser … --ref … --update-goldens` into a Makefile target and runs it via `bin/dev run` |
| `Makefile`                                                                                    | modify | `check-e2e-firefox` runs the runner self-test and suites; new `check-e2e-ref`                                      |
| `install-test-deps.sh`                                                                        | modify | Also installs a pinned `js-yaml` globally                                                                          |
| `e2e/harness/runner.cts`                                                                      | create | Parses `spec.yml`, binds steps, runs them as subtests, compares goldens                                            |
| `e2e/harness/runner.test.cts`                                                                 | create | Self-test of parsing, binding, run order and golden comparison                                                     |
| `e2e/harness/driver.cts`                                                                      | create | `h`: browser-neutral actions and queries, the local page server, default options, the frozen clock                 |
| `e2e/harness/firefox.cts`                                                                     | create | Firefox adapter: launch, install, navigate, evaluate, screenshot (`drawSnapshot`), errors                          |
| `e2e/harness/fixtures.cts`                                                                    | create | Shared `given` steps (`threeOpenPages`)                                                                            |
| `e2e/tests/e01-stash-list-starts/{spec.yml,suite.cts}`                                        | create | E1 (replaces `e2e/firefox.test.cjs`)                                                                               |
| `e2e/tests/e02-stash-all/{spec.yml,suite.cts,screenshots/firefox/stash-list-after-stash.png}` | create | E2                                                                                                                 |
| `e2e/tests/e08-delete-and-undo/{spec.yml,suite.cts}`                                          | create | E8                                                                                                                 |
| `e2e/firefox.test.cjs`                                                                        | delete | Replaced by E1                                                                                                     |
| `rfcs/0002_firefox-baseline-e2e-suite.md`                                                     | modify | Task 7 records Phase A results                                                                                     |

## Commit stack

| Task | Commit subject                                                                      |
| ---- | ----------------------------------------------------------------------------------- |
| 1    | `test(rfc-0002): add bin/e2e and run the Firefox smoke test against a given commit` |
| 2    | `test(rfc-0002): add a spec-driven step runner for end-to-end tests`                |
| 3    | `test(rfc-0002): add the driver and Firefox adapter, and move the smoke test to E1` |
| 4    | `test(rfc-0002): add E2, stashing all open tabs`                                    |
| 5    | `test(rfc-0002): compare E2 against a golden screenshot`                            |
| 6    | `test(rfc-0002): add E8, deleting a bookmark and undoing it`                        |
| 7    | `docs(rfc-0002): record Phase A results`                                            |

---

### Task 1: `bin/e2e` and running against a given commit

**Files:**

- Create: `bin/e2e`
- Modify: `Makefile` (the e2e block, around lines 53-66)
- Modify: `e2e/firefox.test.cjs`, lines 24 (`EXTENSION_DIR`) and the header comment

**Interfaces:**

- Produces:
  - `bin/e2e test --browser=firefox|chrome [--ref=<commit>] [--update-goldens]`;
  - the Makefile target `check-e2e-ref`, with variable `E2E_REF`;
  - the environment variables `E2E_DIST` (the extension build to test, default `dist`), `E2E_BROWSER` and `UPDATE_SCREENSHOTS`.

- [ ] **Step 1: Make the Firefox smoke test read `E2E_DIST`**

In `e2e/firefox.test.cjs`, replace:

```js
const EXTENSION_DIR = path.resolve(__dirname, "..", "dist");
```

with:

```js
// E2E_DIST points at another build, e.g. the one check-e2e-ref makes.
const EXTENSION_DIR = path.resolve(process.env.E2E_DIST ?? "dist");
```

- [ ] **Step 2: Update the Makefile's e2e block**

Replace the block from `check-e2e-firefox: build-dbg` through its `.PHONY: check-e2e-firefox` line with:

```make
E2E_DIST ?= dist
E2E_REF_DIR = node_modules/.cache/e2e-ref/$(E2E_REF)

check-e2e-firefox: build-dbg
	TZ=UTC E2E_BROWSER=firefox E2E_DIST=$(E2E_DIST) node --test e2e/firefox.test.cjs
.PHONY: check-e2e-firefox

# Builds E2E_REF once (cached per commit, inside the bind-mounted repo so it
# survives between containers) and runs this checkout's Firefox tests against
# that build.  node_modules/ is gitignored, so git and Prettier skip the cache.
check-e2e-ref:
	@test -n "$(E2E_REF)" || { echo "Set E2E_REF=<commit>" >&2; exit 1; }
	test -d $(E2E_REF_DIR)/dist || ( \
	  rm -rf $(E2E_REF_DIR) && \
	  git clone --quiet . $(E2E_REF_DIR) && \
	  git -C $(E2E_REF_DIR) checkout --quiet $(E2E_REF) && \
	  $(MAKE) -C $(E2E_REF_DIR) build-dbg )
	TZ=UTC E2E_BROWSER=firefox E2E_DIST=$(E2E_REF_DIR)/dist node --test e2e/firefox.test.cjs
.PHONY: check-e2e-ref
```

Recipe lines start with a TAB.

- [ ] **Step 3: Create `bin/e2e`**

```bash
#!/usr/bin/env bash
# Run Tab Stash's end-to-end tests inside the dev Docker image.  This only
# picks the Makefile target and environment; bin/dev runs it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
    cat <<EOF
Usage: bin/e2e <command> [options]

Commands:
  test                Run the end-to-end tests (see "Test options" below)
  help                Show this help

Test options:
  --browser=<name>    Required: firefox or chrome
  --ref=<commit>      Build <commit> (cached per commit) and run this
                      checkout's tests against that build instead of the
                      working tree.  Firefox only.
  --update-goldens    Write golden screenshots instead of comparing them.
                      Needs --ref, so goldens only come from a commit.

The tests run only inside the dev Docker image (on macOS, use Colima or a
similar Docker runtime).

Examples:
  bin/e2e test --browser=firefox
  bin/e2e test --browser=firefox --ref=622bf3d
  bin/e2e test --browser=firefox --ref=622bf3d --update-goldens
  bin/e2e test --browser=chrome
EOF
}

die() {
    echo "bin/e2e: $*" >&2
    exit 1
}

run_test() {
    local browser="" ref="" update=0
    for arg in "$@"; do
        case "$arg" in
            --browser=firefox | --browser=chrome) browser="${arg#--browser=}" ;;
            --ref=?*) ref="${arg#--ref=}" ;;
            --update-goldens) update=1 ;;
            *) usage >&2; exit 1 ;;
        esac
    done

    [ -n "$browser" ] || die "--browser=firefox or --browser=chrome is required"
    [ "$update" = 0 ] || [ -n "$ref" ] || die "--update-goldens needs --ref=<commit>"

    if [ "$browser" = chrome ]; then
        [ -z "$ref" ] && [ "$update" = 0 ] ||
            die "--ref and --update-goldens are Firefox-only for now"
        exec "$ROOT/bin/dev" run make check-e2e-chrome
    fi

    if [ -n "$ref" ]; then
        exec "$ROOT/bin/dev" run env UPDATE_SCREENSHOTS="$update" \
            make check-e2e-ref E2E_REF="$ref"
    fi
    exec "$ROOT/bin/dev" run make check-e2e-firefox
}

case "${1:-help}" in
    test) shift; run_test "$@" ;;
    help | -h | --help) usage ;;
    *) usage >&2; exit 1 ;;
esac
```

Then make it executable: `chmod +x bin/e2e`.

- [ ] **Step 4: Check the argument handling**

Run:

```bash
bin/e2e help >/dev/null; echo "help=$?"
bin/e2e test; echo "nobrowser=$?"
bin/e2e test --browser=edge; echo "badbrowser=$?"
bin/e2e test --browser=firefox --update-goldens; echo "goldens-no-ref=$?"
bin/e2e test --browser=chrome --ref=622bf3d; echo "chrome-ref=$?"
```

Expected: `help=0`, then `1` for each of the others, each with a `bin/e2e:` message or the usage text on stderr.

- [ ] **Step 5: Run against this checkout and against the baseline**

Run: `bin/e2e test --browser=firefox`, then `bin/e2e test --browser=firefox --ref=622bf3d`.

Expected:

- Both end with `# pass 1` and `# fail 0`.
- The second run's first invocation clones and builds `622bf3d` into `node_modules/.cache/e2e-ref/622bf3d`, which takes a few minutes.
- Running the second command again skips the build.

- [ ] **Step 6: Check the normal build and commit**

Run: `bin/dev run make`. Expected: exit 0, 625 passing. Then:

```bash
git add bin/e2e Makefile e2e/firefox.test.cjs
git commit -F - <<'EOF'
test(rfc-0002): add bin/e2e and run the Firefox smoke test against a given commit

bin/e2e test --browser=firefox|chrome [--ref=<commit>] [--update-goldens]
picks the Makefile target and environment and runs it in the dev image,
keeping bin/dev generic. check-e2e-ref builds a commit once (cached
under node_modules/.cache) and runs this checkout's Firefox tests
against it, so tests can be checked against upstream's unmodified code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The step runner

**Files:**

- Modify: `install-test-deps.sh` (the version variables at the top; the global npm install line)
- Create: `e2e/harness/runner.cts`
- Create: `e2e/harness/runner.test.cts`
- Modify: `Makefile` (`check-e2e-firefox` recipe)

**Interfaces:**

- Consumes: `E2E_DIST`, `E2E_BROWSER` and `UPDATE_SCREENSHOTS` (Task 1).
- Produces, from `e2e/harness/runner.cts`:
  - `steps(dir: string, fns: Record<string, StepFn>): void` registers one `node:test` test for the spec in `dir`. It calls `require("./driver.cts").launch(browser, {dist, clock})`, which Task 3 provides.
  - `parseSpec(text: string, where: string): Spec`
  - `bind(spec: Spec, fns: Record<string, StepFn>, browser: Browser): Array<[Step, StepFn]>`
  - `run(pairs, h, subtest, afterStep?)`
  - `matchGolden(dir, browser, name, png: Buffer)`
  - Types: `type Step = {phase: "given"|"when"|"then"; text: string; browser?: "firefox"|"chrome"; screenshot?: string}` and `type StepFn = (h: any) => unknown`.

- [ ] **Step 1: Install `js-yaml` in the image**

Find the current version: `bin/dev run npm view js-yaml version` (expect `4.1.x`). In `install-test-deps.sh`, add it under `FIREFOX_VERSION=…`, using that exact version:

```sh
JS_YAML_VERSION=4.1.0 # the version printed above
```

Change the global install line to:

```sh
sudo env PUPPETEER_SKIP_DOWNLOAD=1 npm install -g \
    "puppeteer@$PUPPETEER_VERSION" "js-yaml@$JS_YAML_VERSION"
```

Then run `bin/dev image build`, then `bin/dev run node -e 'require("js-yaml"); console.log("ok")'`. Expected: `ok`, because `NODE_PATH` points at the global modules.

- [ ] **Step 2: Write the failing self-test**

Create `e2e/harness/runner.test.cts`:

```ts
// Self-test of the step runner: the rules that keep specs and suites in step.

const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {parseSpec, bind, run, matchGolden} = require("./runner.cts");

const SPEC = `
id: E99
title: Example
given:
  - A given step.
when:
  - A when step.
then:
  - A then step.
  - step: A Firefox step.
    browser: firefox
    screenshot: true
  - step: A Chrome step.
    browser: chrome
  - step: A named shot.
    screenshot: named
notes: |
  Mutation check: none, this is a fixture.
`;

const spec = () => parseSpec(SPEC, "fixture");
const fn = () => async () => {};
const allFns = () => ({
  "A given step.": fn(),
  "A when step.": fn(),
  "A then step.": fn(),
  "A Firefox step.": fn(),
  "A Chrome step.": fn(),
  "A named shot.": fn(),
});

test("parseSpec keeps phase order and names screenshots", () => {
  const s = spec();
  assert.deepEqual(
    s.steps.map(x => [x.phase, x.text, x.browser, x.screenshot]),
    [
      ["given", "A given step.", undefined, undefined],
      ["when", "A when step.", undefined, undefined],
      ["then", "A then step.", undefined, undefined],
      ["then", "A Firefox step.", "firefox", "then-2"],
      ["then", "A Chrome step.", "chrome", undefined],
      ["then", "A named shot.", undefined, "named"],
    ],
  );
});

test("parseSpec rejects duplicate text, unknown keys and misplaced screenshots", () => {
  assert.throws(
    () => parseSpec(SPEC.replace("A when step.", "A given step."), "f"),
    /duplicate step text/,
  );
  assert.throws(
    () => parseSpec(SPEC + "extra: 1\n", "f"),
    /unknown key "extra"/,
  );
  assert.throws(
    () =>
      parseSpec(
        SPEC.replace(
          "  - A given step.",
          "  - step: A given step.\n    screenshot: x",
        ),
        "f",
      ),
    /screenshot is only allowed on then steps/,
  );
});

test("bind needs a function for every step of the browser under test", () => {
  const fns = allFns();
  delete fns["A then step."];
  assert.throws(
    () => bind(spec(), fns, "firefox"),
    /no function for then step: "A then step\."/,
  );
});

test("bind ignores other browsers' steps but rejects unmatched functions", () => {
  const fns = allFns();
  delete fns["A Chrome step."];
  assert.equal(bind(spec(), fns, "firefox").length, 5);
  assert.throws(
    () => bind(spec(), {...allFns(), "Not in the spec.": fn()}, "firefox"),
    /function matches no step: "Not in the spec\."/,
  );
});

test("run skips everything after a failed given or when step", async () => {
  const seen = [];
  const pairs = bind(
    spec(),
    {
      ...allFns(),
      "A given step.": async () => {
        throw new Error("boom");
      },
    },
    "firefox",
  );
  const h = {errors: async () => []};
  await run(pairs, h, async (name, body) => {
    if (!body) return (seen.push(["skip", name]), false);
    try {
      await body();
      seen.push(["pass", name]);
      return true;
    } catch {
      seen.push(["fail", name]);
      return false;
    }
  });
  assert.deepEqual(
    seen.map(([status]) => status),
    ["fail", "skip", "skip", "skip", "skip", "pass"],
  );
  assert.equal(seen.at(-1)[1], "no errors were logged");
});

test("run keeps going after a failed then step", async () => {
  const statuses = [];
  const pairs = bind(
    spec(),
    {
      ...allFns(),
      "A then step.": async () => {
        throw new Error("boom");
      },
    },
    "firefox",
  );
  await run(pairs, {errors: async () => []}, async (name, body) => {
    try {
      await body();
      statuses.push("pass");
      return true;
    } catch {
      statuses.push("fail");
      return false;
    }
  });
  assert.deepEqual(statuses, ["pass", "pass", "fail", "pass", "pass", "pass"]);
});

test("matchGolden writes, matches and reports differences", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-golden-"));
  const a = Buffer.from("png-a");
  process.env.UPDATE_SCREENSHOTS = "1";
  matchGolden(dir, "firefox", "shot", a);
  assert.ok(
    fs.readFileSync(path.join(dir, "screenshots/firefox/shot.png")).equals(a),
  );
  process.env.UPDATE_SCREENSHOTS = "0";
  matchGolden(dir, "firefox", "shot", a);
  assert.throws(
    () => matchGolden(dir, "firefox", "shot", Buffer.from("png-b")),
    /differs/,
  );
  assert.throws(() => matchGolden(dir, "firefox", "missing", a), /No golden/);
  delete process.env.UPDATE_SCREENSHOTS;
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bin/dev run node --test e2e/harness/runner.test.cts`
Expected: FAIL with `Cannot find module './runner.cts'`.

- [ ] **Step 4: Write `e2e/harness/runner.cts`**

```ts
// Runs an end-to-end test from its spec.yml.  The spec states the scenario in
// plain English; the suite binds one function to each step by its exact text.
// This file checks that binding, runs the steps in order as node:test
// subtests, compares screenshots with goldens, and checks for errors.

const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");

type Browser = "firefox" | "chrome";
type Phase = "given" | "when" | "then";
type Step = {
  phase: Phase;
  text: string;
  browser?: Browser;
  screenshot?: string;
};
type Spec = {
  id: string;
  title: string;
  browser?: Browser;
  clock?: string;
  notes: string;
  steps: Step[];
};
type StepFn = (h: any) => unknown;
type Subtest = (name: string, body?: () => Promise<void>) => Promise<boolean>;

const PHASES: Phase[] = ["given", "when", "then"];
const BROWSERS = ["firefox", "chrome"];
const SPEC_KEYS = [
  "id",
  "title",
  "browser",
  "clock",
  "given",
  "when",
  "then",
  "notes",
];
const STEP_KEYS = ["step", "browser", "screenshot"];

function parseSpec(text: string, where: string): Spec {
  const fail = (msg: string): never => {
    throw new Error(`${where}: ${msg}`);
  };
  const raw: any = yaml.load(text);
  if (!raw || typeof raw !== "object") fail("not a YAML mapping");
  for (const key of Object.keys(raw)) {
    if (!SPEC_KEYS.includes(key)) fail(`unknown key "${key}"`);
  }
  if (typeof raw.id !== "string" || typeof raw.title !== "string") {
    fail("needs a string id and title");
  }
  if (raw.browser !== undefined && !BROWSERS.includes(raw.browser)) {
    fail("browser must be firefox or chrome");
  }
  if (raw.clock !== undefined && Number.isNaN(Date.parse(raw.clock))) {
    fail("clock must be an ISO date and time");
  }
  if (typeof raw.notes !== "string") fail("needs notes");

  const steps: Step[] = [];
  for (const phase of PHASES) {
    const list = raw[phase];
    if (!Array.isArray(list) || list.length === 0)
      fail(`needs a non-empty "${phase}" list`);
    list.forEach((entry: any, i: number) => {
      const at = `${phase}[${i + 1}]`;
      const s = typeof entry === "string" ? {step: entry} : entry;
      if (!s || typeof s.step !== "string") fail(`${at} needs step text`);
      for (const key of Object.keys(s)) {
        if (!STEP_KEYS.includes(key)) fail(`${at}: unknown key "${key}"`);
      }
      if (s.browser !== undefined && !BROWSERS.includes(s.browser)) {
        fail(`${at}: browser must be firefox or chrome`);
      }
      let screenshot: string | undefined;
      if (s.screenshot !== undefined) {
        if (phase !== "then")
          fail(`${at}: screenshot is only allowed on then steps`);
        if (s.screenshot === true) screenshot = `then-${i + 1}`;
        else if (typeof s.screenshot === "string" && s.screenshot)
          screenshot = s.screenshot;
        else fail(`${at}: screenshot must be true or a file name`);
      }
      steps.push({phase, text: s.step, browser: s.browser, screenshot});
    });
  }

  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.text)) fail(`duplicate step text "${s.text}"`);
    seen.add(s.text);
  }
  return {
    id: raw.id,
    title: raw.title,
    browser: raw.browser,
    clock: raw.clock,
    notes: raw.notes,
    steps,
  };
}

// Every step for the browser under test needs exactly one function, and every
// function must match some step (of any browser).  This checks names, not
// meaning: whether a function checks its whole sentence is for review and the
// spec's mutation check.
function bind(
  spec: Spec,
  fns: Record<string, StepFn>,
  browser: Browser,
): Array<[Step, StepFn]> {
  const problems: string[] = [];
  const texts = new Set(spec.steps.map(s => s.text));
  for (const key of Object.keys(fns)) {
    if (!texts.has(key)) problems.push(`function matches no step: "${key}"`);
  }
  const pairs: Array<[Step, StepFn]> = [];
  for (const s of spec.steps) {
    if (s.browser && s.browser !== browser) continue;
    const fn = fns[s.text];
    if (fn) pairs.push([s, fn]);
    else problems.push(`no function for ${s.phase} step: "${s.text}"`);
  }
  if (problems.length > 0) {
    throw new Error(
      `${spec.id} doesn't match its suite:\n  ${problems.join("\n  ")}`,
    );
  }
  return pairs;
}

// Runs the steps in order.  A failed given or when step makes the remaining
// steps meaningless, so they're skipped; every then step runs, so one run
// reports every failed expectation.
async function run(
  pairs: Array<[Step, StepFn]>,
  h: any,
  subtest: Subtest,
  afterStep?: (step: Step) => Promise<void>,
): Promise<void> {
  let aborted = false;
  for (const [step, fn] of pairs) {
    const name = `${step.phase} › ${step.text}`;
    if (aborted) {
      await subtest(name);
      continue;
    }
    const ok = await subtest(name, async () => {
      await fn(h);
      if (afterStep) await afterStep(step);
    });
    if (!ok && step.phase !== "then") aborted = true;
  }
  await subtest("no errors were logged", async () => {
    assert.deepEqual(await h.errors(), []);
  });
}

// Compares a screenshot with its golden byte for byte.  With
// UPDATE_SCREENSHOTS=1 it writes the golden instead.  A mismatch leaves this
// run's image in the (gitignored) cache for a side-by-side look.
function matchGolden(
  dir: string,
  browser: Browser,
  name: string,
  png: Buffer,
): void {
  const golden = path.join(dir, "screenshots", browser, `${name}.png`);
  if (process.env.UPDATE_SCREENSHOTS === "1") {
    fs.mkdirSync(path.dirname(golden), {recursive: true});
    fs.writeFileSync(golden, png);
    return;
  }
  const rel = path.relative(process.cwd(), golden);
  if (!fs.existsSync(golden)) {
    assert.fail(
      `No golden ${rel}. Generate it with: bin/e2e test --browser=${browser} --ref=<baseline commit> --update-goldens`,
    );
  }
  if (fs.readFileSync(golden).equals(png)) return;
  const actual = path.join(
    "node_modules/.cache/e2e-actual",
    path.basename(dir),
    browser,
    `${name}.png`,
  );
  fs.mkdirSync(path.dirname(actual), {recursive: true});
  fs.writeFileSync(actual, png);
  assert.fail(`Screenshot differs from ${rel}; this run's image is ${actual}`);
}

function steps(dir: string, fns: Record<string, StepFn>): void {
  const file = path.join(dir, "spec.yml");
  const spec = parseSpec(
    fs.readFileSync(file, "utf8"),
    path.relative(process.cwd(), file),
  );
  const browser = (process.env.E2E_BROWSER ?? "firefox") as Browser;
  const dist = path.resolve(process.env.E2E_DIST ?? "dist");
  const skip =
    spec.browser && spec.browser !== browser
      ? `${spec.id} is ${spec.browser}-only`
      : false;

  test(`${spec.id} ${spec.title} (${browser})`, {skip}, async t => {
    const pairs = bind(spec, fns, browser);
    const {launch} = require("./driver.cts");
    const h = await launch(browser, {dist, clock: spec.clock});
    try {
      await run(
        pairs,
        h,
        async (name, body) => {
          if (!body) {
            await t.test(
              name,
              {skip: "an earlier given or when step failed"},
              () => {},
            );
            return false;
          }
          let ok = true;
          await t.test(name, async () => {
            try {
              await body();
            } catch (e) {
              ok = false;
              throw e;
            }
          });
          return ok;
        },
        async step => {
          if (step.screenshot)
            matchGolden(dir, browser, step.screenshot, await h.screenshot());
        },
      );
    } finally {
      await h.close();
    }
  });
}

module.exports = {steps, parseSpec, bind, run, matchGolden};
```

- [ ] **Step 5: Run the self-test and watch it pass**

Run: `bin/dev run node --test e2e/harness/runner.test.cts`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 6: Make `check-e2e-firefox` run the self-test too**

In the `check-e2e-firefox` recipe, change the node line to:

```make
	TZ=UTC E2E_BROWSER=firefox E2E_DIST=$(E2E_DIST) node --test e2e/harness/runner.test.cts e2e/firefox.test.cjs
```

Run `bin/e2e test --browser=firefox` (expected: `# pass 8`) and `bin/dev run make` (expected: exit 0, 625 passing). If Prettier complains, run `bin/dev run make fix-style` and re-run.

- [ ] **Step 7: Commit**

```bash
git add install-test-deps.sh e2e/harness/runner.cts e2e/harness/runner.test.cts Makefile
git commit -F - <<'EOF'
test(rfc-0002): add a spec-driven step runner for end-to-end tests

The runner reads a test's spec.yml (Given / When / Then in plain
English, with per-step browser and screenshot keys), checks that the
suite binds exactly one function to each step of the browser under
test, runs the steps in order as node:test subtests, compares
screenshots with goldens byte for byte, and checks for errors. Its
self-test runs with the Firefox suite. js-yaml is a test-only tool,
pinned in install-test-deps.sh.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The driver, the Firefox adapter, and E1

**Files:**

- Create: `e2e/harness/firefox.cts`
- Create: `e2e/harness/driver.cts`
- Create: `e2e/tests/e01-stash-list-starts/spec.yml`
- Create: `e2e/tests/e01-stash-list-starts/suite.cts`
- Delete: `e2e/firefox.test.cjs`
- Modify: `Makefile` (both Firefox recipes)
- Modify: `install-test-deps.sh`, the final `echo` (point at `bin/e2e`)

**Interfaces:**

- Consumes: `steps()` from Task 2.
- Produces:
  - `launch(browser, {dist, clock?}): Promise<Driver>` in `driver.cts`.
  - **Navigation and evaluation:** `open(page)`, `eval(js)`, `waitFor(js, what?)`, `click(selector, mods?)`.
  - **Local pages:** `openPages(n)`, `pageUrls(n)`.
  - **Browser state:** `stash()`, `tabs(query?)`, `tabMarker(tabId)`, `seed(state)`.
  - **Rendering, errors and teardown:** `showAllFolders()`, `screenshot()`, `errors()`, `close()`.
  - **The adapter interface,** in `firefox.cts`: `launchAdapter({dist}): Promise<{open(page), eval(js), screenshot(), errors(), close()}>`.

- [ ] **Step 1: Write the E1 spec and suite (the failing test)**

`e2e/tests/e01-stash-list-starts/spec.yml`:

```yaml
id: E01
title: The extension installs and its stash list starts
given:
  - Tab Stash is installed in a fresh profile.
when:
  - The user opens the stash list.
then:
  - The stash list renders.
notes: |
  The stash list mounts its Vue app only after it connects to the
  background's stores, so rendering also shows the background is running.
  Mutation check: in dist/, delete index.js (the background script) before
  running; the list never renders.
```

`e2e/tests/e01-stash-list-starts/suite.cts`:

```ts
const {steps} = require("../../harness/runner.cts");

module.exports = steps(__dirname, {
  // The driver installs the build in a fresh profile before any step runs.
  "Tab Stash is installed in a fresh profile.": async () => {},

  "The user opens the stash list.": async h => {
    await h.open("stash-list.html");
  },

  "The stash list renders.": async h => {
    await h.waitFor(
      `!!document.querySelector("main.stash-list")`,
      "the stash list to render",
    );
  },
});
```

Run: `bin/dev run sh -c 'TZ=UTC node --test e2e/tests/*/suite.cts'`
Expected: FAIL with `Cannot find module './driver.cts'`.

- [ ] **Step 2: Write `e2e/harness/firefox.cts`**

The Firefox-specific half, moved from `e2e/firefox.test.cjs` plus the verified `drawSnapshot` screenshot:

```ts
// Firefox adapter for the end-to-end driver.  Firefox's WebDriver BiDi ignores
// extension pages (Mozilla bug 1755014): it sends no load, console or error
// events for them and runs no preload scripts there, so Puppeteer's page API
// doesn't work.  This adapter navigates and evaluates with raw BiDi commands,
// snapshots tabs from the chrome (browser UI) context because BiDi refuses to
// screenshot privileged pages, and reads errors from Firefox's console
// service.  --remote-allow-system-access is what allows the last two and
// navigation to moz-extension:// URLs.

const puppeteer = require("puppeteer");

const ADDON_ID = "tab-stash@condordes.net";
// Firefox gives each add-on a random moz-extension:// host per profile; this
// pins it so the adapter knows the URL of the extension's pages.
const ADDON_UUID = "6b1e2b9c-6c5e-4a8f-9a57-3d3c0e5f7a10";
const BASE_URL = `moz-extension://${ADDON_UUID}/`;

async function launchAdapter({dist}: {dist: string}) {
  const browser = await puppeteer.launch({
    browser: "firefox",
    headless: true,
    args: ["--remote-allow-system-access"],
    extraPrefsFirefox: {
      "extensions.webextensions.uuids": JSON.stringify({
        [ADDON_ID]: ADDON_UUID,
      }),
      "intl.locale.requested": "en-US",
    },
  });
  const bidi = async (method: string, params: object) =>
    (await browser.connection.send(method, params)).result;
  const evaluateIn = async (context: string, expression: string) => {
    const r = await bidi("script.evaluate", {
      expression,
      target: {context},
      awaitPromise: true,
    });
    if (r.type === "exception") throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const chromeContext = async () =>
    (
      await bidi("browsingContext.getTree", {
        "moz:scope": "chrome",
        maxDepth: 0,
      })
    ).contexts[0].context;

  // webExtension.install is a temporary install, like about:debugging, so the
  // add-on needn't be signed.
  const id = await browser.installExtension(dist);
  if (id !== ADDON_ID) throw new Error(`Installed ${id}, expected ${ADDON_ID}`);

  // Use the tab Firefox starts with, so the window holds only the tabs a test
  // opens itself; "stash all" would also stash an extra blank tab.
  const tree = await bidi("browsingContext.getTree", {maxDepth: 0});
  if (tree.contexts.length !== 1) {
    throw new Error(`Expected one tab at start, found ${tree.contexts.length}`);
  }
  const context: string = tree.contexts[0].context;
  await bidi("browsingContext.setViewport", {
    context,
    viewport: {width: 1000, height: 700},
  });

  return {
    async open(page: string) {
      await bidi("browsingContext.navigate", {
        context,
        url: BASE_URL + page,
        wait: "complete",
      });
    },

    // Evaluates js (an expression, possibly a promise) in the page and returns
    // its JSON-serialisable value.
    async eval(js: string) {
      const json = await evaluateIn(
        context,
        `(async () => JSON.stringify(await (${js})) ?? "null")()`,
      );
      return JSON.parse(json);
    },

    async screenshot(): Promise<Buffer> {
      const url: string = await evaluateIn(
        await chromeContext(),
        `(async () => {
          const b = gBrowser.browsers.find(b => b.currentURI.spec.startsWith(${JSON.stringify(BASE_URL)}));
          const bmp = await b.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
          const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext("2d").drawImage(bmp, 0, 0);
          return c.toDataURL("image/png");
        })()`,
      );
      return Buffer.from(url.split(",")[1], "base64");
    },

    // Uncaught errors from any of the extension's scripts (pages, background,
    // sidebar), as Firefox's console records them.
    async errors(): Promise<string[]> {
      return JSON.parse(
        await evaluateIn(
          await chromeContext(),
          `JSON.stringify(Services.console.getMessageArray()
            .filter(m => m instanceof Ci.nsIScriptError
              && !(m.flags & Ci.nsIScriptError.warningFlag)
              && m.sourceName.startsWith(${JSON.stringify(BASE_URL)}))
            .map(m => m.sourceName + ": " + m.errorMessage))`,
        ),
      );
    },

    close: () => browser.close(),
  };
}

module.exports = {launchAdapter};
```

- [ ] **Step 3: Write `e2e/harness/driver.cts`**

```ts
// The browser-neutral driver every suite uses (`h`).  Suites never talk to a
// browser's automation protocol: the few browser-specific primitives (open,
// eval, screenshot, errors) come from an adapter (firefox.cts), and
// everything else is built here on the page's own browser.* APIs, which are
// the same in every browser.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const TIMEOUT_MS = 30_000;
const STASH_ROOT = "Tab Stash";
const HIDDEN_MARKER = "hidden_by_tab_stash"; // src/model/tabs.ts

type Options = {sync?: object; local?: object};
type SeedFolder = {title: string; pages: number[]};

// Serves /page/<n> as a tiny titled page, so tests have real, distinct tabs to
// stash without touching the network.
function startPageServer(): Promise<any> {
  const server = http.createServer((req: any, res: any) => {
    const m = /^\/page\/(\d+)$/.exec(req.url);
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
    res.end(`<!doctype html><title>Page ${m[1]}</title><h1>Page ${m[1]}</h1>`);
  });
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

// Freezes Date in the page at `iso`, so generated folder names and dates render
// the same on every run.  It covers the page only: bookmarks' dateAdded still
// comes from the browser's real clock.
const clockJs = (iso: string) => `(() => {
  if (globalThis.__e2eClock) return;
  const T = Date.parse(${JSON.stringify(iso)});
  const Real = Date;
  class FrozenDate extends Real {
    constructor(...a) { if (a.length === 0) super(T); else super(...a); }
    static now() { return T; }
  }
  globalThis.Date = FrozenDate;
  globalThis.__e2eClock = true;
})()`;

class Driver {
  adapter: any;
  server: any;
  clock?: string;
  version: string;
  page = "stash-list.html";

  constructor(adapter: any, server: any, dist: string, clock?: string) {
    this.adapter = adapter;
    this.server = server;
    this.clock = clock;
    this.version = JSON.parse(
      fs.readFileSync(path.join(dist, "manifest.json"), "utf8"),
    ).version;
  }

  pageUrls(n: number): string[] {
    const {port} = this.server.address();
    return Array.from(
      {length: n},
      (_, i) => `http://127.0.0.1:${port}/page/${i + 1}`,
    );
  }

  async open(page: string): Promise<void> {
    this.page = page;
    await this.adapter.open(page);
    if (this.clock) await this.adapter.eval(clockJs(this.clock));
  }

  eval(js: string): Promise<any> {
    return this.adapter.eval(js);
  }

  async waitFor(js: string, what = js, timeout = TIMEOUT_MS): Promise<any> {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await this.eval(js);
      if (value) return value;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // A synthetic click, which Tab Stash's @click.prevent.stop handlers accept.
  // Modifier keys: alt copies, ctrl opens in the background, shift flips the
  // tab-group choice.
  async click(
    selector: string,
    mods: {alt?: boolean; ctrl?: boolean; shift?: boolean} = {},
  ) {
    const sel = JSON.stringify(selector);
    await this.waitFor(
      `!!document.querySelector(${sel})`,
      `an element matching ${selector}`,
    );
    await this
      .eval(`document.querySelector(${sel}).dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true,
      altKey: ${!!mods.alt}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift},
    }))`);
  }

  // Opens n local pages as background tabs in the page's window and waits for
  // them to load, so their titles are known.
  async openPages(n: number): Promise<void> {
    const urls = this.pageUrls(n);
    for (const url of urls) {
      await this.eval(
        `browser.tabs.create({url: ${JSON.stringify(url)}, active: false})`,
      );
    }
    const list = JSON.stringify(urls);
    await this.waitFor(
      `browser.tabs.query({currentWindow: true}).then(ts => ${list}.every(u =>
        ts.some(t => t.url === u && t.status === "complete")))`,
      `${n} pages to load`,
    );
  }

  // The stash's folders, top to bottom, as {title, urls}.
  stash(): Promise<Array<{title: string; urls: string[]}>> {
    return this.eval(`(async () => {
      const [root] = (await browser.bookmarks.search({title: ${JSON.stringify(STASH_ROOT)}}))
        .filter(b => !b.url);
      if (!root) return [];
      const [tree] = await browser.bookmarks.getSubTree(root.id);
      return (tree.children ?? []).filter(c => !c.url).map(f => ({
        title: f.title,
        urls: (f.children ?? []).filter(c => c.url).map(c => c.url),
      }));
    })()`);
  }

  // Tabs in the page's window, in tab order.
  tabs(
    query: object = {},
  ): Promise<
    Array<{id: number; url: string; hidden: boolean; active: boolean}>
  > {
    return this
      .eval(`browser.tabs.query(${JSON.stringify({...query, currentWindow: true})})
      .then(ts => ts.map(t => ({id: t.id, url: t.url, hidden: !!t.hidden, active: t.active})))`);
  }

  // Whether Tab Stash marked this tab as hidden by itself (Firefox only: Chrome
  // has no session values).
  tabMarker(tabId: number): Promise<boolean> {
    return this
      .eval(`browser.sessions.getTabValue(${tabId}, ${JSON.stringify(HIDDEN_MARKER)})
      .then(v => v === true)`);
  }

  // Sets options and stash folders, then reloads the current page so it starts
  // from that state.  Options merge into the defaults set at launch.
  async seed(
    state: {options?: Options; stash?: SeedFolder[]} = {},
  ): Promise<void> {
    const urls = this.pageUrls(20);
    await this.eval(`(async () => {
      const opts = ${JSON.stringify(state.options ?? {})};
      for (const area of ["sync", "local"]) {
        if (!opts[area]) continue;
        const {options = {}} = await browser.storage[area].get("options");
        await browser.storage[area].set({options: {...options, ...opts[area]}});
      }
      const folders = ${JSON.stringify(state.stash ?? [])};
      if (folders.length === 0) return;
      let [root] = (await browser.bookmarks.search({title: ${JSON.stringify(STASH_ROOT)}}))
        .filter(b => !b.url);
      if (!root) root = await browser.bookmarks.create({title: ${JSON.stringify(STASH_ROOT)}});
      const urls = ${JSON.stringify(urls)};
      for (const f of folders) {
        const folder = await browser.bookmarks.create({parentId: root.id, title: f.title});
        for (const n of f.pages) {
          await browser.bookmarks.create({parentId: folder.id, title: "Page " + n, url: urls[n - 1]});
        }
      }
    })()`);
    await this.open(this.page);
  }

  // The stash list renders a folder's children only once the folder has been
  // scrolled into view, so scroll each one in and wait for its children.
  async showAllFolders(): Promise<void> {
    await this.waitFor(
      `!!document.querySelector("main.stash-list")`,
      "the stash list",
    );
    await this.waitFor(
      `(() => {
        const folders = [...document.querySelectorAll("div.forest-item.folder")];
        for (const f of folders) f.scrollIntoView();
        return folders.every(f => f.nextElementSibling?.matches("ul.forest-children"));
      })()`,
      "every folder's children to render",
    );
    await this.eval(`window.scrollTo(0, 0)`);
  }

  // A PNG of the visible page, after a short settle so animations finish.
  async screenshot(): Promise<Buffer> {
    await new Promise(r => setTimeout(r, 500));
    return this.adapter.screenshot();
  }

  // Errors from the browser's console plus those Tab Stash caught itself.
  async errors(): Promise<string[]> {
    const caught = await this.eval(
      `(globalThis.error_log ?? []).map(e => String(e.summary))`,
    );
    return [...(await this.adapter.errors()), ...caught];
  }

  async close(): Promise<void> {
    try {
      await this.adapter.close();
    } finally {
      this.server.close();
    }
  }
}

// Starts a browser with the build in `dist` installed, opens the stash list in
// its only tab, and sets options that keep tests deterministic: no
// restore-choice prompt, no close confirmation, no "what's new" notice.
async function launch(
  browser: string,
  {dist, clock}: {dist: string; clock?: string},
) {
  const server = await startPageServer();
  try {
    const {launchAdapter} = require(`./${browser}.cts`);
    const h = new Driver(await launchAdapter({dist}), server, dist, clock);
    await h.open("stash-list.html");
    await h.seed({
      options: {
        sync: {restore_folders_into: "target-window"},
        local: {
          confirm_close_open_tabs: false,
          last_notified_version: h.version,
        },
      },
    });
    return h;
  } catch (e) {
    server.close();
    throw e;
  }
}

module.exports = {launch};
```

- [ ] **Step 4: Run E1 and watch it pass**

Run: `bin/dev run sh -c 'TZ=UTC node --test e2e/tests/*/suite.cts'`
Expected: `# pass` covering E01's subtests, `# fail 0`. If `launch` fails with "Expected one tab at start", Firefox opened more than one tab. Report this; don't work around it.

- [ ] **Step 5: Mutation check for E1**

Run:

```bash
bin/dev run sh -c 'cp -r dist /tmp/broken && rm /tmp/broken/index.js && TZ=UTC E2E_DIST=/tmp/broken node --test e2e/tests/e01-stash-list-starts/suite.cts; echo exit=$?'
```

Expected: fails with "Timed out waiting for the stash list to render", and `exit=1`.

- [ ] **Step 6: Switch the Makefile to the suites and retire the smoke test**

In both Firefox recipes, replace `e2e/firefox.test.cjs` with the suite globs. The `check-e2e-firefox` line becomes:

```make
	TZ=UTC E2E_BROWSER=firefox E2E_DIST=$(E2E_DIST) node --test e2e/harness/runner.test.cts e2e/tests/*/suite.cts
```

In the `check-e2e-ref` recipe, change only the test files on its last line: replace `node --test e2e/firefox.test.cjs` with `node --test e2e/tests/*/suite.cts`. Leave its hash-keyed cache logic as it is.

Then run `git rm e2e/firefox.test.cjs`. In `install-test-deps.sh`, change the final message to `echo ">>> All done!  Run the end-to-end tests with: bin/e2e test --browser=firefox"`.

- [ ] **Step 7: Verify against this checkout, the baseline, and the normal build**

Run: `bin/e2e test --browser=firefox`, `bin/e2e test --browser=firefox --ref=622bf3d`, and `bin/dev run make`.
Expected:

- both e2e runs end with `# fail 0`;
- `make` passes with 625 tests;
- `grep -rE "connection\.send|Services\.|gBrowser" e2e/tests` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add e2e/harness/firefox.cts e2e/harness/driver.cts e2e/tests/e01-stash-list-starts Makefile install-test-deps.sh
git commit -F - <<'EOF'
test(rfc-0002): add the driver and Firefox adapter, and move the smoke test to E1

Suites now only use a browser-neutral driver. It builds actions and
queries on the page's own browser.* APIs and delegates navigation,
evaluation, screenshots and error collection to a per-browser adapter.
The Firefox adapter holds the WebDriver BiDi workarounds: raw
navigation, drawSnapshot from the chrome context, and the console
service. The Firefox smoke test becomes spec E01, and check-e2e-firefox
and check-e2e-ref run the spec suites.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: E2, stashing all open tabs

**Files:**

- Create: `e2e/harness/fixtures.cts`
- Create: `e2e/tests/e02-stash-all/spec.yml`
- Create: `e2e/tests/e02-stash-all/suite.cts`

**Interfaces:**

- Consumes: the driver (Task 3).
- Produces: `fixtures.cts` exports `given.threeOpenPages: (h) => Promise<void>`.

- [ ] **Step 1: Write the fixture**

`e2e/harness/fixtures.cts`:

```ts
// Given steps several specs share, so a spec that starts "after E2" binds to
// the same setup instead of depending on another test.

const given = {
  async threeOpenPages(h: any): Promise<void> {
    await h.openPages(3);
  },
};

module.exports = {given};
```

- [ ] **Step 2: Write the E2 spec, without a screenshot yet**

`e2e/tests/e02-stash-all/spec.yml`:

```yaml
id: E02
title: Stash all open tabs
given:
  - Three local pages are open in the window, and the stash is empty.
when:
  - The user clicks "Stash all" in the open-tabs section of the stash list.
then:
  - A new folder appears at the top of "Tab Stash" with the three pages, in tab order.
  - step: The three tabs are hidden and marked as hidden by Tab Stash.
    browser: firefox
  - step: The three tabs are closed.
    browser: chrome
  - The window still has one visible tab.
notes: |
  Folder names are "saved-<ISO time>"; assertions match the prefix.
  The stash list's own tab isn't stashable, so it is the visible tab left.
  "Stash all" is the only link with class exactly "action stash"
  (src/stash-list/window.vue); a.action.stash alone matches a dozen links.
  Hidden tabs carry the session value hidden_by_tab_stash.
  Mutation check: in src/model/tabs.ts, make hide() return before calling
  browser.tabs.hide; the "hidden and marked" step fails.
```

- [ ] **Step 3: Write the suite**

`e2e/tests/e02-stash-all/suite.cts`:

```ts
const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

module.exports = steps(__dirname, {
  "Three local pages are open in the window, and the stash is empty.":
    async h => {
      await given.threeOpenPages(h);
      assert.deepEqual(await h.stash(), []);
    },

  'The user clicks "Stash all" in the open-tabs section of the stash list.':
    async h => {
      await h.click('nav.forest-toolbar > a[class="action stash"]');
      await h.waitFor(
        `browser.bookmarks.search({title: "Tab Stash"}).then(r => r.length > 0)`,
        "the stash folder",
      );
    },

  'A new folder appears at the top of "Tab Stash" with the three pages, in tab order.':
    async h => {
      await h.waitFor(
        `browser.bookmarks.search({url: ${JSON.stringify(h.pageUrls(3)[2])}}).then(r => r.length > 0)`,
        "the third page to be stashed",
      );
      const [folder, ...rest] = await h.stash();
      assert.equal(rest.length, 0);
      assert.match(folder.title, /^saved-/);
      assert.deepEqual(folder.urls, h.pageUrls(3));
    },

  "The three tabs are hidden and marked as hidden by Tab Stash.": async h => {
    await h.waitFor(
      `browser.tabs.query({currentWindow: true, hidden: true}).then(t => t.length === 3)`,
      "three hidden tabs",
    );
    const hidden = await h.tabs({hidden: true});
    assert.deepEqual(
      hidden.map((t: any) => t.url),
      h.pageUrls(3),
    );
    for (const t of hidden) assert.equal(await h.tabMarker(t.id), true);
  },

  "The three tabs are closed.": async h => {
    assert.equal((await h.tabs({url: h.pageUrls(3)})).length, 0);
  },

  "The window still has one visible tab.": async h => {
    assert.equal((await h.tabs({hidden: false})).length, 1);
  },
});
```

- [ ] **Step 4: Run E2 against this checkout and the baseline**

Run: `bin/e2e test --browser=firefox`, then `bin/e2e test --browser=firefox --ref=622bf3d`.
Expected: both pass. The Chrome step isn't run.

- [ ] **Step 5: Mutation check**

Apply the mutation from the spec's notes in `src/model/tabs.ts`: make `hide()` return early, before `browser.tabs.hide`. Then run `bin/e2e test --browser=firefox`.

- **Expected:** the step `then › The three tabs are hidden and marked as hidden by Tab Stash.` fails.
- **Restore:** run `git checkout -- src/model/tabs.ts`, then run `bin/e2e test --browser=firefox` again and expect it to pass.

- [ ] **Step 6: Commit**

```bash
git add e2e/harness/fixtures.cts e2e/tests/e02-stash-all
git commit -F - <<'EOF'
test(rfc-0002): add E2, stashing all open tabs

Three local pages are stashed from the stash list's open-tabs toolbar;
the test checks the new saved-* folder holds them in tab order, that
Firefox hid them with Tab Stash's session marker, and that the window
keeps one visible tab. The Chrome expectation is written as a
browser-specific step for later.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: E2's golden screenshot

**Files:**

- Modify: `e2e/tests/e02-stash-all/spec.yml` (add `clock` and a screenshot step)
- Modify: `e2e/tests/e02-stash-all/suite.cts` (bind the new step)
- Create: `e2e/tests/e02-stash-all/screenshots/firefox/stash-list-after-stash.png` (generated)

**Interfaces:**

- Consumes: `showAllFolders()`, `screenshot()` and `clock` (Task 3), and `matchGolden` (Task 2).

- [ ] **Step 1: Add the clock and the screenshot step to the spec**

In `e2e/tests/e02-stash-all/spec.yml`, add the top-level key directly under `title:`:

```yaml
clock: 2026-01-01T09:00:00Z
```

Then insert this step in `then:`, right after the "A new folder appears…" step:

```yaml
- step: The stash list shows the new folder, expanded, with its three tabs.
  screenshot: stash-list-after-stash
```

Finally, add to `notes`:

```
  The clock makes the folder's displayed name ("Saved 1/1/2026, 9:00:00 AM")
  the same on every run; the folder is created after the clock is set, so
  freezing it once the page has loaded is enough here.
```

- [ ] **Step 2: Bind the step in the suite**

Add to the object passed to `steps(...)`:

```ts
  "The stash list shows the new folder, expanded, with its three tabs.": async h => {
    await h.showAllFolders(); // the runner takes and compares the screenshot after this
  },
```

- [ ] **Step 3: Run without a golden and watch it fail**

Run: `bin/e2e test --browser=firefox`
Expected: the screenshot step fails with `No golden e2e/tests/e02-stash-all/screenshots/firefox/stash-list-after-stash.png`.

- [ ] **Step 4: Generate the golden from the baseline**

Run: `bin/e2e test --browser=firefox --ref=622bf3d --update-goldens`
Then look at the image (`e2e/tests/e02-stash-all/screenshots/firefox/stash-list-after-stash.png`). It must show:

- the stash list with an "Unstashed Tabs" section;
- one folder titled "Saved 1/1/2026, 9:00:00 AM", expanded, containing "Page 1", "Page 2" and "Page 3".

If the folder's time isn't 9:00:00, the clock didn't take effect. Stop and report this (RFC 0002, Open question 1).

- [ ] **Step 5: Prove it's deterministic, on both builds**

Run `bin/e2e test --browser=firefox --ref=622bf3d` three times, then `bin/e2e test --browser=firefox` three times.

- **Expected:** all six runs pass with no screenshot difference.
- **On any difference:** compare `node_modules/.cache/e2e-actual/e02-stash-all/firefox/stash-list-after-stash.png` with the golden, and report what differs. Don't loosen the comparison, because that is RFC 0002's open question.

- [ ] **Step 6: Commit**

```bash
git add e2e/tests/e02-stash-all
git commit -F - <<'EOF'
test(rfc-0002): compare E2 against a golden screenshot

E2 freezes the page's clock so the new folder's displayed name is
stable, and compares the stash list after stashing with a golden image
generated from upstream's unmodified code (622bf3d). Six consecutive
runs, three on that build and three on this branch, match it byte for
byte.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: E8, deleting a bookmark and undoing it

**Files:**

- Create: `e2e/tests/e08-delete-and-undo/spec.yml`
- Create: `e2e/tests/e08-delete-and-undo/suite.cts`

**Interfaces:**

- Consumes: `seed()`, `showAllFolders()`, `click()`, `stash()` and `waitFor()` (Task 3).

- [ ] **Step 1: Write the spec**

`e2e/tests/e08-delete-and-undo/spec.yml`:

```yaml
id: E08
title: Delete a bookmark, then undo it
given:
  - A folder named "Reading" in the stash holds Page 1 and Page 2.
when:
  - The user deletes Page 1 from "Reading" in the stash list.
  - The user clicks the undo notification.
then:
  - '"Reading" holds Page 1 and Page 2 again, in their original order.'
notes: |
  The delete step waits until Page 1 is gone from the bookmarks before it
  ends, so the undo step really restores a deleted bookmark.
  The undo notification lasts 8 seconds (RECENT_DELETION_TIMEOUT); the undo
  step must run well within that.
  A bookmark row is div.forest-item[title=<title>]; its delete link has class
  exactly "action remove" (src/stash-list/bookmark.vue).
  Mutation check: in src/stash-list/index.vue, remove the undo
  notification's @activate handler; the then step fails.
```

- [ ] **Step 2: Write the suite**

`e2e/tests/e08-delete-and-undo/suite.cts`:

```ts
const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

const reading = async (h: any) =>
  (await h.stash()).find((f: any) => f.title === "Reading");

module.exports = steps(__dirname, {
  'A folder named "Reading" in the stash holds Page 1 and Page 2.': async h => {
    await h.seed({stash: [{title: "Reading", pages: [1, 2]}]});
    assert.deepEqual((await reading(h)).urls, h.pageUrls(2));
  },

  'The user deletes Page 1 from "Reading" in the stash list.': async h => {
    await h.showAllFolders();
    await h.click('div.forest-item[title="Page 1"] a[class="action remove"]');
    const page1 = JSON.stringify(h.pageUrls(1)[0]);
    await h.waitFor(
      `browser.bookmarks.search({url: ${page1}}).then(r => r.length === 0)`,
      "Page 1 to be deleted",
    );
  },

  "The user clicks the undo notification.": async h => {
    await h.click("aside.notification .contents");
  },

  '"Reading" holds Page 1 and Page 2 again, in their original order.':
    async h => {
      const page1 = JSON.stringify(h.pageUrls(1)[0]);
      await h.waitFor(
        `browser.bookmarks.search({url: ${page1}}).then(r => r.length === 1)`,
        "Page 1 to be restored",
      );
      assert.deepEqual((await reading(h)).urls, h.pageUrls(2));
    },
});
```

- [ ] **Step 3: Run against this checkout and the baseline**

Run: `bin/e2e test --browser=firefox`, then `bin/e2e test --browser=firefox --ref=622bf3d`.
Expected: E01, E02 and E08 all pass on both builds.

- [ ] **Step 4: Mutation check**

Apply the spec's mutation: in `src/stash-list/index.vue`, find the undo notification (the `<Notification` element around the `deletedItemUndo` text) and delete its `@activate="..."` attribute. Then run `bin/e2e test --browser=firefox`.

- **Expected:** `then › "Reading" holds Page 1 and Page 2 again…` fails with "Timed out waiting for Page 1 to be restored".
- **Restore:** run `git checkout -- src/stash-list/index.vue` and re-run; it must pass.

If the attribute isn't named `@activate`, use the handler that calls the model's `undelete`, and record the exact edit in the spec's `notes`.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/e08-delete-and-undo
git commit -F - <<'EOF'
test(rfc-0002): add E8, deleting a bookmark and undoing it

A seeded "Reading" folder loses Page 1 through its delete link in the
stash list, and the undo notification puts it back in its original
position.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Phase A exit, recorded in the RFC (controller)

The controller runs this task, with a subagent only for the RFC edit. It checks RFC 0002's Phase A exit criteria and records the evidence.

**Files:**

- Modify: `rfcs/0002_firefox-baseline-e2e-suite.md`. Add a "Phase A results" subsection at the end of `## Rollout`, and resolve Open question 1 where the evidence allows.

- [ ] **Step 1: Run the exit checks**

1. Run `bin/e2e test --browser=firefox --ref=622bf3d` three times. Every run must pass.
2. Run `bin/e2e test --browser=firefox` three times. Every run must pass.
3. Check that each spec's mutation check (E01, E02 and E08) has been run and fails the test. The evidence is in the task reports.
4. Time one full run's test phase, from the `node --test` start to its end, excluding builds, and divide by the number of tests.
5. Run `grep -rE "connection\.send|Services\.|gBrowser" e2e/tests`. It must print nothing.

- [ ] **Step 2: Record the results in the RFC**

Under `## Rollout`, add `### Phase A results` with:

- the date and commit;
- pass counts per build;
- the mutation checks and their failing steps;
- the measured seconds per test, and the projected time for 18 tests against the five-minute budget;
- the outcome of Open question 1: was freezing the clock after load enough for E2, and is a pre-render hook still needed for E9's Deleted Items screenshot?

Then mark Open question 1 resolved or narrowed accordingly. Run `bin/dev run make check-style`.

- [ ] **Step 3: Commit**

```bash
git add rfcs/0002_firefox-baseline-e2e-suite.md
git commit -F - <<'EOF'
docs(rfc-0002): record Phase A results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
