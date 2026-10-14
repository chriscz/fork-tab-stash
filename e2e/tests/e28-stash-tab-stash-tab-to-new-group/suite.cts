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

  'The user picks "Stash This Tab to a New Group" from the stash list\'s own tab menu.':
    async h => {
      await h.clickTabMenuItem(
        await stashListUrl(h),
        h.message("stashThisTabToNewGroupMenu"),
      );
    },

  "No folder appears in the stash.": async h => {
    // Nothing signals that the background has finished with the click, so
    // give a wrong stash a moment to create its folder before concluding it
    // didn't.
    await new Promise(r => setTimeout(r, 1000));
    assert.deepEqual(await h.stash(), []);
  },

  "The stash list's tab is still open.": async h => {
    const url = await stashListUrl(h);
    const tabs = await h.tabs({url});
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].hidden, false);
  },
});
