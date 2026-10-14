const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

// The URL of the test's own tab, the stash list.
const stashListUrl = (h: any) =>
  h.eval(`browser.tabs.getCurrent().then(t => t.url)`);

steps(__dirname, {
  "Stashing from a menu is set to show nothing, and the stash is empty.":
    async h => {
      await h.seed({options: {sync: {open_stash_in: "none"}}});
      assert.deepEqual(await h.stash(), []);
    },

  'The user stashed Page 1 with "Stash This Tab to a New Group" from its tab menu, so the stash holds one folder with Page 1.':
    async h => {
      // Proves the menu click reaches the background, so an unchanged stash
      // after the when step means the click did nothing, not that it was lost.
      await h.openPages(1);
      await h.clickTabMenuItem(
        h.pageUrl(1),
        h.message("stashThisTabToNewGroupMenu"),
      );
      const [folder] = await h.waitUntil(async () => {
        const stash = await h.stash();
        return stash.length === 1 && stash[0].urls.length === 1 && stash;
      }, "a folder holding Page 1");
      assert.match(folder.title, /^saved-/);
      assert.deepEqual(folder.urls, [h.pageUrl(1)]);
    },

  'The user picks "Stash This Tab to a New Group" from the stash list\'s own tab menu.':
    async h => {
      await h.clickTabMenuItem(
        await stashListUrl(h),
        h.message("stashThisTabToNewGroupMenu"),
      );
    },

  "No further folder appears in the stash.": async h => {
    // Nothing signals that the background has finished with the click, so
    // give a wrong stash a moment to create its folder before concluding it
    // didn't.
    await new Promise(r => setTimeout(r, 1000));
    const stash = await h.stash();
    assert.deepEqual(
      stash.map(f => f.urls),
      [[h.pageUrl(1)]],
    );
  },

  "The stash list's tab is still open.": async h => {
    const url = await stashListUrl(h);
    const tabs = await h.tabs({url});
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].hidden, false);
  },
});
