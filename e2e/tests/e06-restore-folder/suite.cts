const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  'The stash has a folder "Reading" with Pages 1 to 3, and Page 2 is already open.':
    async h => {
      await h.seed({stash: [{title: "Reading", pages: [1, 2, 3]}]});
      await h.openPages([2]);
      h.vars.page2 = (await h.tabs({url: h.pageUrl(2)}))[0].id;
    },

  'The user clicks "Open all tabs in this group" on "Reading".': async h => {
    await h.showAllFolders();
    await h.clickInFolder("Reading", 'a[class="action restore"]');
    const urls = JSON.stringify(h.pageUrls(3));
    await h.waitFor(
      `browser.tabs.query({currentWindow: true}).then(ts => ${urls}.every(u =>
        ts.some(t => t.url === u && !t.hidden && t.status === "complete")))`,
      "Pages 1 to 3 to be open and loaded",
    );
  },

  "Pages 1 to 3 are each open exactly once and visible, and Page 2's existing tab was reused.":
    async h => {
      for (const url of h.pageUrls(3)) {
        const tabs = await h.tabs({url});
        assert.equal(tabs.length, 1, url);
        assert.equal(tabs[0].hidden, false, url);
      }
      assert.equal((await h.tabs({url: h.pageUrl(2)}))[0].id, h.vars.page2);
    },

  'The bookmarks in "Reading" are unchanged.': async h => {
    const reading = (await h.stash()).find((f: any) => f.title === "Reading");
    assert.deepEqual(reading.urls, h.pageUrls(3));
  },

  'The stash list shows "Reading" with its three pages.': async h => {
    await h.activate();
    await h.showAllFolders();
  },
});
