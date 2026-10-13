const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

// The rename box that replaces a stash folder's title while it's edited.
const renameInput = "div.forest-item.folder > input.forest-title.editable";

steps(__dirname, {
  'The stash has a folder "Reading" with Page 1.': async h => {
    await h.seed({stash: [{title: "Reading", pages: [1]}]});
    await h.waitUntil(
      async () => (await h.stash()).some((f: any) => f.title === "Reading"),
      '"Reading" to be stashed',
    );
  },

  'The user clicks the title "Reading", types "Later" and presses Enter.':
    async h => {
      await h.showAllFolders();
      await h.clickInFolder("Reading", "span.forest-title.editable");
      await h.type(renameInput, "Later");
      await h.press(renameInput, "Enter");
    },

  'The folder is now called "Later" in the bookmarks.': async h => {
    await h.waitUntil(
      async () => (await h.stash()).some((f: any) => f.title === "Later"),
      'the folder to be renamed "Later"',
    );
    const stash = await h.stash();
    assert.deepEqual(stash, [{title: "Later", urls: [h.pageUrl(1)]}]);
  },
});
