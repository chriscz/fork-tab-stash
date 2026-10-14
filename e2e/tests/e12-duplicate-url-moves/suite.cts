const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  'The stash has a folder "Reading" with Page 1, and Page 1 is also open.':
    async h => {
      await h.seed({stash: [{title: "Reading", pages: [1]}]});
      await h.openPages([1]);
      await h.waitUntil(
        async () => (await h.stash()).some((f: any) => f.title === "Reading"),
        '"Reading" to be stashed',
      );
    },

  'The user clicks "Stash all open tabs here" on "Reading".': async h => {
    await h.showAllFolders();
    await h.clickInFolder("Reading", 'a[class="action stash here"]');
  },

  '"Reading" still holds exactly one bookmark for Page 1.': async h => {
    // Tab Stash puts the bookmarks in place before it hides or closes the
    // tabs, so once Page 1 has left the window the folder is final.
    await h.waitUntil(
      async () =>
        (await h.tabs({url: h.pageUrl(1), hidden: false})).length === 0,
      "Page 1 to leave the window",
    );
    const stash = await h.stash();
    assert.deepEqual(stash, [{title: "Reading", urls: [h.pageUrl(1)]}]);
    // And no copy of it anywhere else in the bookmarks.
    assert.equal(
      await h.eval(
        `browser.bookmarks.search({url: ${JSON.stringify(h.pageUrl(1))}}).then(r => r.length)`,
      ),
      1,
    );
  },

  "Page 1's tab is hidden.": async h => {
    await h.waitUntil(async () => {
      const tabs = await h.tabs({url: h.pageUrl(1)});
      return tabs.length === 1 && tabs[0].hidden;
    }, "Page 1's one tab to be hidden");
  },

  "Page 1's tab is closed.": async h => {
    await h.waitUntil(
      async () => (await h.tabs({url: h.pageUrl(1)})).length === 0,
      "Page 1's tab to close",
    );
  },
});
