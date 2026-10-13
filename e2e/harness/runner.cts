// Runs an end-to-end test from its spec.yml.  The spec states the scenario in
// plain English; the suite binds one function to each step by its exact text.
// This file checks that binding, runs the steps in order as node:test
// subtests, compares screenshots with goldens, and checks for errors.

const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const assert = require("node:assert/strict");

// The repo's own node_modules holds an older js-yaml (a transitive dev
// dependency), and Node prefers it to NODE_PATH, so load the pinned global copy
// from NODE_PATH explicitly.
function requireFromNodePath(name: string): any {
  const paths = (process.env.NODE_PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  let resolved: string;
  try {
    resolved = require.resolve(name, {paths});
  } catch {
    throw new Error(
      `${name} isn't installed in NODE_PATH (${paths.join(path.delimiter) || "unset"}); install-test-deps.sh installs it in the dev image`,
    );
  }
  return require(resolved);
}
const yaml = requireFromNodePath("js-yaml");

type Browser = "firefox" | "chrome";
type Phase = "given" | "when" | "then";
// A CSS selector (the box of every element it matches) or an [x, y, w, h]
// rectangle in CSS pixels, blacked out before the screenshot is taken.
type Mask = string | [number, number, number, number];
type Step = {
  phase: Phase;
  text: string;
  browser?: Browser;
  screenshot?: {name: string; mask: Mask[]};
};
type Spec = {
  id: string;
  title: string;
  browser?: Browser;
  // The TASKS.md heading of the upstream bug this fork fixes and the spec
  // proves fixed.
  upstreamBug?: string;
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
  "upstream-bug",
  "given",
  "when",
  "then",
  "notes",
];
const STEP_KEYS = ["step", "browser", "screenshot"];
const SCREENSHOT_KEYS = ["name", "mask"];

function isMask(m: unknown): m is Mask {
  if (typeof m === "string") return m.length > 0;
  return (
    Array.isArray(m) &&
    m.length === 4 &&
    m.every(n => typeof n === "number" && Number.isFinite(n)) &&
    m[2] > 0 &&
    m[3] > 0
  );
}

function parseSpec(text: string, where: string): Spec {
  const fail = (msg: string): never => {
    throw new Error(`${where}: ${msg}`);
  };
  // The core schema has no timestamp type, so a date-like value stays a
  // string instead of becoming a Date.
  const raw: any = yaml.load(text, {schema: yaml.CORE_SCHEMA});
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
  const upstreamBug = raw["upstream-bug"];
  if (
    upstreamBug !== undefined &&
    (typeof upstreamBug !== "string" || !upstreamBug)
  ) {
    fail("upstream-bug must be a non-empty string");
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
      let screenshot: Step["screenshot"];
      const shot = s.screenshot;
      if (shot !== undefined) {
        if (phase !== "then")
          fail(`${at}: screenshot is only allowed on then steps`);
        const fallback = `then-${i + 1}`;
        if (shot === true) screenshot = {name: fallback, mask: []};
        else if (typeof shot === "string" && shot)
          screenshot = {name: shot, mask: []};
        else if (shot && typeof shot === "object" && !Array.isArray(shot)) {
          for (const key of Object.keys(shot)) {
            if (!SCREENSHOT_KEYS.includes(key))
              fail(`${at}: unknown screenshot key "${key}"`);
          }
          if (
            shot.name !== undefined &&
            (typeof shot.name !== "string" || !shot.name)
          )
            fail(`${at}: screenshot name must be a non-empty file name`);
          if (!Array.isArray(shot.mask) || shot.mask.length === 0)
            fail(`${at}: screenshot needs a non-empty mask list`);
          if (!shot.mask.every(isMask))
            fail(`${at}: mask entries must be a CSS selector or [x, y, w, h]`);
          screenshot = {name: shot.name ?? fallback, mask: shot.mask};
        } else
          fail(`${at}: screenshot must be true, a file name or {name, mask}`);
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
    upstreamBug,
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
      `No golden ${rel}. Generate it from a reviewed commit with: bin/e2e test --browser=${browser} --ref=<commit> --update-goldens`,
    );
  }
  if (fs.readFileSync(golden).equals(png)) return;
  // Anchor to the repo root so the image lands in the same cache whatever the
  // cwd is; show a cwd-relative path since that's what the reader can open.
  const actual = path.resolve(
    __dirname,
    "../../node_modules/.cache/e2e-actual",
    path.basename(dir),
    browser,
    `${name}.png`,
  );
  fs.mkdirSync(path.dirname(actual), {recursive: true});
  fs.writeFileSync(actual, png);
  assert.fail(
    `Screenshot differs from ${rel}; this run's image is ${path.relative(process.cwd(), actual)}`,
  );
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
  // A spec for an upstream bug this fork fixes can't pass on a build from
  // before the fix, so reference runs report it without failing the run.
  // node:test marks the subtests todo too, including "no errors were logged".
  const todo =
    spec.upstreamBug && process.env.E2E_REF_SHA
      ? `covers an upstream bug: ${spec.upstreamBug}`
      : false;

  test(`${spec.id} ${spec.title} (${browser})`, {skip, todo}, async t => {
    const pairs = bind(spec, fns, browser);
    const {launch} = require("./driver.cts");
    const h = await launch(browser, {dist});
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
            matchGolden(
              dir,
              browser,
              step.screenshot.name,
              await h.screenshot({mask: step.screenshot.mask}),
            );
        },
      );
    } finally {
      await h.close();
    }
  });
}

module.exports = {steps, parseSpec, bind, run, matchGolden};
