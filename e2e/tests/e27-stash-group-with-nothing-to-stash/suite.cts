const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

// The id of the tab group holding the test's own tab, the stash list.
const groupOfStashList = (h: any) =>
  h.eval(`browser.tabs.getCurrent().then(t => t.groupId)`);

steps(__dirname, {
  'The stash list\'s own tab is in a tab group named "Reading", and the stash is empty.':
    async h => {
      await h.eval(`(async () => {
        const tab = await browser.tabs.getCurrent();
        const groupId = await browser.tabs.group({tabIds: [tab.id]});
        await browser.tabGroups.update(groupId, {title: "Reading"});
      })()`);
      await h.waitFor(
        `!![...document.querySelectorAll("div.forest-item.folder .forest-title")]
          .find(e => e.textContent.trim() === "Reading")`,
        'the "Reading" group in the stash list',
      );
      assert.deepEqual(await h.stash(), []);
    },

  'The user clicks the stash action on "Reading" in the open-tabs section of the stash list.':
    async h => {
      await h.clickInRow(
        "div.forest-item.folder",
        "Reading",
        "nav.forest-toolbar > a.action.stash.many",
      );
    },

  "No folder appears in the stash.": async h => {
    // Nothing signals that the click has finished, so give a wrong stash a
    // moment to create its folder before concluding it didn't.
    await new Promise(r => setTimeout(r, 1000));
    assert.deepEqual(await h.stash(), []);
  },

  'The stash list\'s tab is still in "Reading".': async h => {
    const groupId = await groupOfStashList(h);
    assert.ok(groupId !== undefined && groupId !== -1);
    const title = await h.eval(
      `browser.tabGroups.get(${groupId}).then(g => g.title)`,
    );
    assert.equal(title, "Reading");
  },
});
