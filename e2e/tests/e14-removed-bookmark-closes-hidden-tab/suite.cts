const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

steps(__dirname, {
  'Three pages were stashed with "Stash all".': async h => {
    await given.stashedThreePages(h);
    // The tabs are hidden one after another once the bookmarks exist.
    await h.waitUntil(
      async () =>
        (await h.tabs({url: h.pageUrls(3), hidden: true})).length === 3,
      "the three pages to be hidden",
    );
  },

  "Page 1's bookmark is removed outside Tab Stash, as in Firefox's Library.":
    async h => {
      await h.eval(`browser.bookmarks.search({url: ${JSON.stringify(h.pageUrl(1))}})
        .then(([b]) => browser.bookmarks.remove(b.id))`);
    },

  "Page 1's bookmark is gone and its hidden tab is closed.": async h => {
    await h.waitUntil(
      async () => !(await h.stash())[0].urls.includes(h.pageUrl(1)),
      "Page 1's bookmark to leave the stash",
    );
    await h.waitUntil(
      async () => (await h.tabs({url: h.pageUrl(1)})).length === 0,
      "Page 1's tab to close",
    );
  },

  "Page 2 and Page 3 are still stashed, open and hidden.": async h => {
    assert.deepEqual((await h.stash())[0].urls, [h.pageUrl(2), h.pageUrl(3)]);
    // The same tabs as before stashing, not reopened ones.
    const tabs = await h.tabs({url: [h.pageUrl(2), h.pageUrl(3)]});
    assert.deepEqual(
      tabs.map((t: any) => [t.id, t.url, t.hidden]),
      h.vars.pageTabs.slice(1).map((t: any) => [t.id, t.url, true]),
    );
  },
});
