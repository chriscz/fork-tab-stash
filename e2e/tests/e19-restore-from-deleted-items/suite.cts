const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

const listed = `[...document.querySelectorAll("div.forest-item.folder.deleted > .forest-title")]
  .some(e => e.textContent.trim() === "Old")`;

steps(__dirname, {
  'A folder "Old" with Page 1 and Page 2 was deleted.': async h => {
    await given.deletedFolder(h, "Old", [1, 2]);
  },

  'The user clicks "Restore" on "Old" in Deleted Items.': async h => {
    await h.open("deleted-items.html");
    await h.clickInRow(
      "div.forest-item.folder.deleted",
      "Old",
      'a[class="action stash one"]',
    );
    // While restoring, the row is replaced by a "Restoring..." one (class
    // "loading"), and the deletion is dropped last, so the restore has
    // finished once neither row is left.
    await h.waitFor(
      `!(${listed}) && !document.querySelector("div.forest-item.deleted.loading")`,
      "the restore to finish",
    );
  },

  '"Old" is back in the stash with Page 1 and Page 2.': async h => {
    const old = (await h.stash()).find((f: any) => f.title === "Old");
    assert.ok(old, '"Old" is not in the stash');
    assert.deepEqual(old.urls, h.pageUrls(2));
  },

  'Deleted Items no longer lists "Old".': async h => {
    await h.open("deleted-items.html");
    await h.waitFor(
      `!!document.querySelector("footer.fully-loaded")`,
      "Deleted Items to finish loading",
    );
    assert.equal(await h.eval(listed), false);
  },
});
