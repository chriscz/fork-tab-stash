const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

const stashOne = (n: number) => async (h: any) => {
  await h.click(
    `ul.forest.one-column div.forest-item[title="Page ${n}"] a[class="action stash one"]`,
  );
  await h.waitFor(
    `browser.bookmarks.search({url: ${JSON.stringify(h.pageUrl(n))}}).then(r => r.length === 1)`,
    `Page ${n} to be stashed`,
  );
};

steps(__dirname, {
  "Three local pages are open in the window, and the stash is empty.":
    async h => {
      await given.threeOpenPages(h);
      assert.deepEqual(await h.stash(), []);
    },

  'The user clicks "Stash this tab" on Page 1 in the open-tabs list.':
    stashOne(1),

  'The user clicks "Stash this tab" on Page 2 in the open-tabs list.':
    stashOne(2),

  "Page 1 and Page 2 are bookmarked in the same, single stash folder.":
    async h => {
      const folders = await h.stash();
      assert.equal(folders.length, 1);
      assert.deepEqual(
        [...folders[0].urls].sort(),
        [h.pageUrl(1), h.pageUrl(2)].sort(),
      );
    },

  "Page 1 and Page 2 are hidden, and Page 3 is still visible.": async h => {
    const pages = JSON.stringify([h.pageUrl(1), h.pageUrl(2)]);
    await h.waitFor(
      `browser.tabs.query({currentWindow: true, hidden: true}).then(ts => ${pages}.every(u => ts.some(t => t.url === u)))`,
      "Page 1 and Page 2 to be hidden",
    );
    const visible = (await h.tabs({hidden: false})).map((t: any) => t.url);
    assert.ok(visible.includes(h.pageUrl(3)));
  },

  "Page 1 and Page 2 are closed, and Page 3 is still open.": async h => {
    const isOpen = async (n: number) =>
      (await h.tabs({url: h.pageUrl(n)})).length > 0;
    await h.waitUntil(
      async () => !(await isOpen(1)) && !(await isOpen(2)),
      "Page 1 and Page 2 to close",
    );
    assert.ok(await isOpen(3));
  },
});
