const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

const page1Tabs = (h: any) => h.tabs({url: h.pageUrl(1)});

steps(__dirname, {
  'Three pages were stashed with "Stash all".': given.stashedThreePages,

  "The user clicks Page 1's bookmark in the stash list.": async h => {
    await h.showAllFolders();
    // "Stash all" names the folder after the time it was saved, and the list
    // shows that as a friendly date, so read the title from the page rather
    // than predict it.
    const title = await h.eval(
      `document.querySelector("div.forest-item.folder > span.forest-title.editable").textContent.trim()`,
    );
    await h.clickInFolder(
      title,
      'div.forest-item[title="Page 1"] a.forest-title',
    );
    await h.waitUntil(
      async () => (await page1Tabs(h)).some((t: any) => !t.hidden),
      "Page 1 to be visible",
    );
  },

  "Page 1's original tab is visible again, and Tab Stash's hidden mark is removed.":
    async h => {
      const original = h.vars.pageTabs.find((t: any) => t.url === h.pageUrl(1));
      const [tab, ...rest] = await page1Tabs(h);
      assert.equal(rest.length, 0);
      assert.equal(tab.id, original.id);
      assert.equal(tab.hidden, false);
      await h.waitUntil(
        async () => !(await h.tabMarker(tab.id)),
        "the hidden mark to be removed",
      );
    },

  "A new tab opens with Page 1.": async h => {
    const tabs = await page1Tabs(h);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].hidden, false);
  },

  "Exactly one tab shows Page 1, and its bookmark is still in the stash.":
    async h => {
      assert.equal((await page1Tabs(h)).length, 1);
      assert.ok((await h.stash())[0].urls.includes(h.pageUrl(1)));
    },
});
