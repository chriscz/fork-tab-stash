const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

module.exports = steps(__dirname, {
  "Three local pages are open in the window, and the stash is empty.":
    async h => {
      await given.threeOpenPages(h);
      assert.deepEqual(await h.stash(), []);
    },

  'The user clicks "Stash all" in the open-tabs section of the stash list.':
    async h => {
      await h.click('nav.forest-toolbar > a[class="action stash"]');
      await h.waitFor(
        `browser.bookmarks.search({url: ${JSON.stringify(h.pageUrls(3)[0])}}).then(r => r.length > 0)`,
        "the first page to be stashed",
      );
    },

  'A new folder appears at the top of "Tab Stash" with the three pages, in tab order.':
    async h => {
      await h.waitFor(
        `browser.bookmarks.search({url: ${JSON.stringify(h.pageUrls(3)[2])}}).then(r => r.length > 0)`,
        "the third page to be stashed",
      );
      const [folder, ...rest] = await h.stash();
      assert.equal(rest.length, 0);
      assert.match(folder.title, /^saved-/);
      assert.deepEqual(folder.urls, h.pageUrls(3));
    },

  "The stash list shows the new folder, expanded, with its three tabs.":
    async h => {
      await h.showAllFolders(); // the runner takes and compares the screenshot after this
    },

  "The three tabs are hidden and marked as hidden by Tab Stash.": async h => {
    await h.waitFor(
      `browser.tabs.query({currentWindow: true, hidden: true}).then(t => t.length === 3)`,
      "three hidden tabs",
    );
    const hidden = await h.tabs({hidden: true});
    assert.deepEqual(
      hidden.map((t: any) => t.url),
      h.pageUrls(3),
    );
    // Tab Stash sets the markers one tab at a time after hiding, so wait.
    const end = Date.now() + 10000;
    for (;;) {
      const marked = await Promise.all(
        hidden.map((t: any) => h.tabMarker(t.id)),
      );
      if (marked.every(Boolean) || Date.now() > end) break;
      await new Promise(r => setTimeout(r, 100));
    }
    for (const t of hidden) assert.equal(await h.tabMarker(t.id), true);
  },

  "The three tabs are closed.": async h => {
    await h.waitFor(
      `browser.tabs.query({currentWindow: true, url: ${JSON.stringify(h.pageUrls(3))}}).then(t => t.length === 0)`,
      "the page tabs to close",
    );
    assert.equal((await h.tabs({url: h.pageUrls(3)})).length, 0);
  },

  "The window still has one visible tab.": async h => {
    assert.equal((await h.tabs({hidden: false})).length, 1);
  },
});
