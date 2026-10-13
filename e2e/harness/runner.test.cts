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
    s.steps.map(x => [x.phase, x.text, x.browser, x.screenshot?.name]),
    [
      ["given", "A given step.", undefined, undefined],
      ["when", "A when step.", undefined, undefined],
      ["then", "A then step.", undefined, undefined],
      ["then", "A Firefox step.", "firefox", "then-2"],
      ["then", "A Chrome step.", "chrome", undefined],
      ["then", "A named shot.", undefined, "named"],
    ],
  );
  assert.deepEqual(s.steps[3].screenshot.mask, []);
  assert.deepEqual(s.steps[5].screenshot.mask, []);
});

test("parseSpec reads masked screenshots and rejects bad masks", () => {
  const withShot = (yamlShot: string) =>
    parseSpec(
      SPEC.replace("    screenshot: named", `    screenshot: ${yamlShot}`),
      "f",
    ).steps[5].screenshot;
  assert.deepEqual(withShot(`{name: shot, mask: [".a", [1, 2, 3, 4]]}`), {
    name: "shot",
    mask: [".a", [1, 2, 3, 4]],
  });
  assert.deepEqual(withShot(`{mask: [".a"]}`), {
    name: "then-4",
    mask: [".a"],
  });
  for (const bad of ["[1, 2, 3]", "[1, 2, 0, 4]", '""', "5"]) {
    assert.throws(
      () => withShot(`{mask: [${bad}]}`),
      /then\[4\]: mask entries must be a CSS selector or \[x, y, w, h\]/,
      bad,
    );
  }
  assert.throws(
    () => withShot(`{mask: [".a"], extra: 1}`),
    /unknown screenshot key "extra"/,
  );
  assert.throws(() => withShot(`{mask: []}`), /non-empty mask list/);
  assert.throws(() => withShot(`{name: x}`), /non-empty mask list/);
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
  const actualDir = path.resolve(
    __dirname,
    "../../node_modules/.cache/e2e-actual",
    path.basename(dir),
  );
  const prev = process.env.UPDATE_SCREENSHOTS;
  try {
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
    assert.equal(
      fs.readFileSync(path.join(actualDir, "firefox/shot.png"), "utf8"),
      "png-b",
    );
    assert.throws(() => matchGolden(dir, "firefox", "missing", a), /No golden/);
  } finally {
    if (prev === undefined) delete process.env.UPDATE_SCREENSHOTS;
    else process.env.UPDATE_SCREENSHOTS = prev;
    fs.rmSync(actualDir, {recursive: true, force: true});
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test("parseSpec rejects the removed clock key", () => {
  assert.throws(
    () =>
      parseSpec(
        SPEC.replace(
          "title: Example",
          "title: Example\nclock: 2026-01-01T09:00:00Z",
        ),
        "f",
      ),
    /unknown key "clock"/,
  );
});

test("run calls afterStep once per executed step, not for skipped ones", async () => {
  const pairs = bind(
    spec(),
    {
      ...allFns(),
      "A when step.": async () => {
        throw new Error("boom");
      },
    },
    "firefox",
  );
  const after = [];
  await run(
    pairs,
    {errors: async () => []},
    async (name, body) => {
      if (!body) return false;
      try {
        await body();
        return true;
      } catch {
        return false;
      }
    },
    async step => {
      after.push(step.text);
    },
  );
  assert.deepEqual(after, ["A given step."]);
});
