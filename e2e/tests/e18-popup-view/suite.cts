const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

// Titles of the stash's folders and bookmarks that are rendered and visible;
// the open-tabs section is the separate ul.forest.one-column.
const visibleTitles = `[...document.querySelectorAll("ul.forest:not(.one-column) .forest-item")]
  .filter(e => e.offsetParent !== null)
  .map(e => e.querySelector(".forest-title")?.textContent.trim())`;

steps(__dirname, {
  'The stash has a folder "Reading" with Page 1 and Page 2.': async h => {
    await h.seed({stash: [{title: "Reading", pages: [1, 2]}]});
    await h.waitUntil(
      async () => (await h.stash()).length === 1,
      "the folder to be stashed",
    );
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
      await h.eval(`document.documentElement.dataset.view ?? null`),
      "popup",
    );
  },

  'The popup view shows "Reading" with its two pages.': async h => {
    await h.showAllFolders();
    await h.waitUntil(
      async () =>
        JSON.stringify(await h.eval(visibleTitles)) ===
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
