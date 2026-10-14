const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  "Three local pages are open, and Page 1 is pinned.": async h => {
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

  "The new stash folder holds Page 2 and Page 3 only.": async h => {
    await h.waitUntil(
      async () =>
        (await h.tabs({url: [h.pageUrl(2), h.pageUrl(3)], hidden: false}))
          .length === 0,
      "Pages 2 and 3 to leave the window",
    );
    const [folder, ...rest] = await h.stash();
    assert.equal(rest.length, 0);
    assert.deepEqual(folder.urls, [h.pageUrl(2), h.pageUrl(3)]);
  },

  "Page 1 is still open, pinned and visible.": async h => {
    const tabs = await h.tabs({url: h.pageUrl(1)});
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].hidden, false);
    assert.deepEqual(
      (await h.tabs({pinned: true})).map(t => t.url),
      [h.pageUrl(1)],
    );
  },
});
