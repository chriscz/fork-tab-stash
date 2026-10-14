const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

const reading = async (h: any) =>
  (await h.stash()).find((f: any) => f.title === "Reading");

steps(__dirname, {
  'A folder named "Reading" in the stash holds Page 1 and Page 2.': async h => {
    await h.seed({stash: [{title: "Reading", pages: [1, 2]}]});
    assert.deepEqual((await reading(h)).urls, h.pageUrls(2));
  },

  'The user deletes Page 1 from "Reading" in the stash list.': async h => {
    await h.showAllFolders();
    await h.click('div.forest-item[title="Page 1"] a[class="action remove"]');
    const page1 = JSON.stringify(h.pageUrls(1)[0]);
    await h.waitFor(
      `browser.bookmarks.search({url: ${page1}}).then(r => r.length === 0)`,
      "Page 1 to be deleted",
    );
  },

  "The user clicks the undo notification.": async h => {
    // Other notifications (what's new, a stash-root warning) come before the
    // undo one in src/stash-list/index.vue, and the undo one is always last.
    // Wait until the last notification is the undo for Page 1, so the click
    // can't land on another one.
    await h.waitFor(
      `[...document.querySelectorAll("aside.notification")].at(-1)?.textContent.includes("Page 1")`,
      "the undo notification for Page 1",
    );
    await h.click(
      "aside.notification-overlay > aside.notification:last-child .contents",
    );
  },

  '"Reading" holds Page 1 and Page 2 again.': async h => {
    const page1 = JSON.stringify(h.pageUrls(1)[0]);
    await h.waitFor(
      `browser.bookmarks.search({url: ${page1}}).then(r => r.length === 1)`,
      "Page 1 to be restored",
    );
    assert.deepEqual((await reading(h)).urls.sort(), h.pageUrls(2).sort());
  },
});
