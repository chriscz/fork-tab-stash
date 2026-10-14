const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  "The toolbar button is set to stash all tabs and show nothing.": async h => {
    await h.seed({
      options: {
        sync: {browser_action_stash: "all", browser_action_show: "none"},
      },
    });
  },

  "The window holds only the stash list and Page 1, which is pinned.":
    async h => {
      await h.openPages([1]);
      const [page1] = await h.tabs({url: h.pageUrl(1)});
      await h.eval(`browser.tabs.update(${page1.id}, {pinned: true})`);
      await h.waitUntil(
        async () =>
          (await h.tabs({url: h.pageUrl(1), pinned: true})).length === 1,
        "Page 1 to be pinned",
      );
      assert.equal((await h.tabs()).length, 2);
      assert.deepEqual(await h.stash(), []);
    },

  "The user clicks Tab Stash's toolbar button.": async h => {
    await h.clickToolbarButton();
  },

  "No folder appears in the stash.": async h => {
    // Nothing signals that the background has finished with the click, so
    // give a wrong stash a moment to create its folder before concluding it
    // didn't.
    await new Promise(r => setTimeout(r, 1000));
    assert.deepEqual(await h.stash(), []);
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
