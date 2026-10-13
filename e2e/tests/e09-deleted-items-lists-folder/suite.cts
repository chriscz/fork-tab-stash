const {steps} = require("../../harness/runner.cts");

// The deleted folder's row, or null.  Deleted Items lists its pages in the
// ul right after it.
const oldRow = `[...document.querySelectorAll("div.forest-item.folder.deleted")]
  .find(r => r.querySelector(":scope > .forest-title")?.textContent.trim() === "Old")`;

const inStash = async (h: any) =>
  (await h.stash()).some((f: any) => f.title === "Old");

steps(__dirname, {
  'The stash has a folder "Old" with Page 1 and Page 2.': async h => {
    await h.seed({stash: [{title: "Old", pages: [1, 2]}]});
    await h.waitUntil(() => inStash(h), '"Old" to be stashed');
  },

  'The user deletes "Old" with "Delete Group" from its menu.': async h => {
    await h.showAllFolders();
    await h.clickInFolder("Old", "summary");
    await h.clickInFolder(
      "Old",
      `button[title="${h.message("deleteGroupTooltip")}"]`,
    );
    // Wait for the delete to finish; the then steps say what it did.
    await h.waitFor(
      `![...document.querySelectorAll("div.forest-item.folder")].some(r =>
        r.querySelector(".forest-title")?.textContent.trim() === "Old")`,
      '"Old" to leave the stash list',
    );
  },

  '"Old" is no longer in the stash.': async h => {
    await h.waitUntil(
      async () => !(await inStash(h)),
      '"Old" to leave the stash',
    );
  },

  'Deleted Items lists "Old" with its two pages.': async h => {
    await h.open("deleted-items.html");
    await h.waitFor(
      `(() => {
      const row = ${oldRow};
      const kids = row?.nextElementSibling?.matches("ul.forest-children")
        ? [...row.nextElementSibling.querySelectorAll(".forest-title")].map(e => e.textContent.trim())
        : [];
      return JSON.stringify(kids) === JSON.stringify(["Page 1", "Page 2"]);
    })()`,
      '"Old" with Page 1 and Page 2 in Deleted Items',
    );
  },

  'Deleted Items shows "Old" under today\'s date.': async h => {
    await h.waitFor(
      `(() => {
        const day = (${oldRow})?.closest("ul.forest > li.folder");
        const header = day?.querySelector(":scope > div.forest-item > .forest-title")?.textContent.trim();
        return header === ${JSON.stringify(h.message("deletedDateGroupHeader"))}.replace("$1", new Date().toLocaleDateString());
      })()`,
      '"Old" under today\'s header',
    );
    // The footer's spinner is gone once every deletion has loaded, so the
    // screenshot shows the settled list.
    await h.waitFor(
      `!!document.querySelector("footer.fully-loaded")`,
      "Deleted Items to finish loading",
    );
  },
});
