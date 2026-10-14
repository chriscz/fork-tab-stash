const {steps} = require("../../harness/runner.cts");
const {given} = require("../../harness/fixtures.cts");

steps(__dirname, {
  'A folder "Old" with Page 1 and Page 2 was deleted.': async h => {
    await given.deletedFolder(h, "Old", [1, 2]);
  },

  "The extension's background restarts.": async h => {
    await h.restartBackground();
  },

  'Deleted Items still lists "Old".': async h => {
    await h.open("deleted-items.html");
    await h.waitFor(
      `[...document.querySelectorAll("div.forest-item.folder.deleted > .forest-title")]
        .some(e => e.textContent.trim() === "Old")`,
      '"Old" in Deleted Items after the restart',
    );
  },
});
