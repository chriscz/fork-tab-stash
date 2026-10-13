const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

// The stash's page URLs, in order, from the first folder; the Tab Stash page
// itself is left out because copying wrongly includes it.  Errors are treated
// as "not yet" since bookmarks are read while the folder is still being built.
const pagesInFolder = async (h: any) => {
  const urls = await h.stash().then(
    (fs: any[]) => fs[0]?.urls ?? [],
    () => [],
  );
  return urls.filter((u: string) => h.pageUrls(3).includes(u));
};

steps(__dirname, {
  "Three local pages are open in the window, and the stash is empty.":
    async h => {
      await given.threeOpenPages(h);
      assert.deepEqual(await h.stash(), []);
    },

  'The user Alt-clicks "Stash all" in the open-tabs section of the stash list.':
    async h => {
      await h.click('nav.forest-toolbar > a[class="action stash"]', {
        alt: true,
      });
      await h.waitUntil(
        async () => (await pagesInFolder(h)).length === 3,
        "the three pages to be copied into the stash",
      );
    },

  'A new folder in "Tab Stash" holds the three pages, in tab order.':
    async h => {
      const [folder, ...rest] = await h.stash();
      assert.equal(rest.length, 0);
      assert.deepEqual(await pagesInFolder(h), h.pageUrls(3));
    },

  "The three tabs are still visible and not marked as hidden by Tab Stash.":
    async h => {
      // Give a wrong move a moment to hide them before concluding it didn't.
      await new Promise(r => setTimeout(r, 1000));
      // Filter by URL here: tabs.query's url option takes match patterns, and
      // Firefox matches none for a URL with a port.
      const tabs = (await h.tabs()).filter((t: any) =>
        h.pageUrls(3).includes(t.url),
      );
      assert.equal(tabs.length, 3);
      for (const t of tabs) {
        assert.equal(t.hidden, false);
        // Chrome has no session values, so tabMarker throws there: unmarked.
        assert.equal(await h.tabMarker(t.id).catch(() => false), false);
      }
    },
});
