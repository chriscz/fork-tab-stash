const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  'Three local pages are open, Page 1 is pinned, and "include pinned tabs" is on.':
    async h => {
      // Seeding reloads the page, so it comes before opening and pinning.
      await h.seed({options: {sync: {stash_include_pinned: true}}});
      await h.openPages(3);
      const [page1] = await h.tabs({url: h.pageUrl(1)});
      await h.eval(`browser.tabs.update(${page1.id}, {pinned: true})`);
      await h.waitUntil(
        async () =>
          (await h.tabs({url: h.pageUrl(1), pinned: true})).length === 1,
        "Page 1 to be pinned",
      );
    },

  'The user clicks "Stash all" in the open-tabs section of the stash list.':
    async h => {
      await h.click('nav.forest-toolbar > a[class="action stash"]');
      await h.waitUntil(
        async () => (await h.stash()).length === 1,
        "a stash folder to appear",
      );
    },

  "The new stash folder holds Pages 1 to 3.": async h => {
    await h.waitUntil(
      async () =>
        (await h.tabs({url: [h.pageUrl(2), h.pageUrl(3)], hidden: false}))
          .length === 0,
      "Pages 2 and 3 to leave the window",
    );
    const [folder, ...rest] = await h.stash();
    assert.equal(rest.length, 0);
    assert.deepEqual(folder.urls, h.pageUrls(3));
  },

  "Page 1 is now hidden and no longer pinned.": async h => {
    await h.waitUntil(async () => {
      const tabs = await h.tabs({url: h.pageUrl(1)});
      return tabs.length === 1 && tabs[0].hidden;
    }, "Page 1's one tab to be hidden");
    assert.deepEqual(await h.tabs({pinned: true}), []);
  },

  "Page 1 is closed.": async h => {
    await h.waitUntil(
      async () => (await h.tabs({url: h.pageUrl(1)})).length === 0,
      "Page 1's tab to close",
    );
  },
});
