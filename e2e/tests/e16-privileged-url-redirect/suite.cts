const assert = require("node:assert/strict");
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
    const restore =
      (await h.eval(`browser.runtime.getURL("restore.html")`)) +
      "?url=" +
      encodeURIComponent("about:robots");
    await h.waitUntil(
      async () => (await h.tabs({url: restore})).length === 1,
      "one tab on the restore page for about:robots",
    );
    assert.deepEqual(await h.tabs({url: "about:robots"}), []);
  },
});
