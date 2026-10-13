const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

// Titles of the stash's folders and bookmarks that are rendered and visible.
// A folder that only holds a match is dimmed (.no-match) but still shown.
const visibleTitles = `[...document.querySelectorAll("ul.forest:not(.one-column) .forest-item")]
  .filter(e => e.offsetParent !== null)
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
      await h.waitUntil(
        async () => (await h.stash()).length === 2,
        "both folders to be stashed",
      );
    },

  'The user opens the stash list with the search "Page 3".': async h => {
    await h.open("stash-list.html?q=Page%203");
    await h.showAllFolders();
  },

  'Only "Cooking" and its Page 3 are shown; "Reading" and its pages are not.':
    async h => {
      // Wait for the list to show exactly the match, so a list that never
      // filters (or never renders "Cooking") fails here.
      await h.waitUntil(
        async () =>
          JSON.stringify(await h.eval(visibleTitles)) ===
          JSON.stringify(["Cooking", "Page 3"]),
        "the list to show only Cooking and Page 3",
      );
      assert.deepEqual(await h.eval(visibleTitles), ["Cooking", "Page 3"]);
    },

  "The stash list shows only the matching folder.": async h => {
    await h.waitFor(
      `document.querySelector("input[type=search]")?.value === "Page 3"`,
      "the search box to hold the search",
    );
    await h.eval(`window.scrollTo(0, 0)`);
  },
});
