const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

const option = (select: string, value: string) =>
  `document.querySelector('#${select} option[value="${value}"]')`;

steps(__dirname, {
  "The toolbar button is set to stash all tabs and show the stash in a tab.":
    async h => {
      await h.seed({
        options: {
          sync: {browser_action_stash: "all", browser_action_show: "tab"},
        },
      });
    },

  "The user opens Tab Stash's options page.": async h => {
    await h.open("options.html");
    await h.waitFor(
      `document.querySelector("#browser_action_stash")?.value === "all"
        && document.querySelector("#browser_action_show")?.value === "tab"`,
      "the options page to show the toolbar's choices",
    );
  },

  'The "popup" choice for what the toolbar button shows is disabled.':
    async h => {
      assert.equal(
        await h.eval(`${option("browser_action_show", "popup")}.disabled`),
        true,
      );
      assert.equal(
        await h.eval(`${option("browser_action_show", "tab")}.disabled`),
        false,
      );
    },
});
