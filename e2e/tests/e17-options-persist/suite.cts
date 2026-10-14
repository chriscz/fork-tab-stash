const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

const storedChoice = `browser.storage.local.get("options")
  .then(o => o.options?.after_stashing_tab ?? null)`;

async function openOptions(h: any) {
  await h.open("options.html");
  await h.waitFor(
    `!!document.querySelector("#after_stashing_tab_close")`,
    "the options page",
  );
}

steps(__dirname, {
  "Tab Stash's options page is open.": async h => {
    await openOptions(h);
    // The default is to hide the tab, so the choice below is a change.
    assert.notEqual(await h.eval(storedChoice), "close");
    assert.equal(
      await h.eval(
        `document.querySelector("#after_stashing_tab_close").checked`,
      ),
      false,
    );
  },

  'The user selects "close the tab" for what happens after stashing a tab.':
    async h => {
      await h.click("#after_stashing_tab_close");
      // Reloading before the choice is saved would lose it.
      await h.waitUntil(
        async () => (await h.eval(storedChoice)) === "close",
        "the choice to be saved",
      );
    },

  "The user reloads the options page.": openOptions,

  'The "close the tab" choice is still selected.': async h => {
    await h.waitFor(
      `document.querySelector("#after_stashing_tab_close").checked`,
      '"close the tab" to be selected',
    );
    assert.equal(
      await h.eval(
        `document.querySelectorAll('input[name="after_stashing_tab"]:checked').length`,
      ),
      1,
    );
  },

  "Tab Stash's stored options say tabs are closed after stashing.": async h => {
    assert.equal(await h.eval(storedChoice), "close");
  },
});
