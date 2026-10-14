const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  'The stash has a folder "Reading" with Page 1 and Page 2.': async h => {
    await h.seed({stash: [{title: "Reading", pages: [1, 2]}]});
    await h.waitUntil(
      async () => (await h.stash()).length === 1,
      "the folder to be stashed",
    );
  },

  "The user opens the stash list in its sidebar view.": async h => {
    await h.open("stash-list.html?view=sidebar");
  },

  "The page is in the sidebar view and the stash list renders.": async h => {
    await h.waitFor(
      `!!document.querySelector("main.stash-list")`,
      "the stash list",
    );
    assert.equal(
      await h.eval(`document.documentElement.dataset.view ?? null`),
      "sidebar",
    );
  },

  'The sidebar view shows "Reading" with its two pages.': async h => {
    await h.showAllFolders();
    await h.waitUntil(
      async () =>
        JSON.stringify(await h.visibleStashTitles()) ===
        JSON.stringify(["Reading", "Page 1", "Page 2"]),
      "Reading and its two pages to show",
    );
    // The view focuses its search box shortly after mounting; wait for that so
    // the screenshot is always taken in the same, settled state.
    await h.waitFor(
      `document.activeElement?.matches("div.search-input > input[type=search]")`,
      "the search box to have focus",
    );
  },
});
