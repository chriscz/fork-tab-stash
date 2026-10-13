const {steps} = require("../../harness/runner.cts");

const inStash = async (h: any) =>
  (await h.stash()).some((f: any) => f.title === "Reading");

steps(__dirname, {
  'The stash has a folder "Reading" with Page 1 and Page 2.': async h => {
    await h.seed({stash: [{title: "Reading", pages: [1, 2]}]});
    await h.waitUntil(() => inStash(h), '"Reading" to be stashed');
  },

  'The user clicks "Open all tabs in this group and delete the group" on "Reading".':
    async h => {
      await h.showAllFolders();
      await h.clickInFolder("Reading", 'a[class="action restore-remove"]');
      const urls = JSON.stringify(h.pageUrls(2));
      await h.waitFor(
        `browser.tabs.query({currentWindow: true}).then(ts => ${urls}.every(u =>
          ts.some(t => t.url === u && t.status === "complete")))`,
        "Page 1 and Page 2 to be open and loaded",
      );
    },

  "Page 1 and Page 2 are open and visible.": async h => {
    for (const url of h.pageUrls(2)) {
      await h.waitUntil(
        async () => (await h.tabs({url})).some((t: any) => !t.hidden),
        `${url} to be open and visible`,
      );
    }
  },

  '"Reading" is no longer in the stash.': async h => {
    await h.waitUntil(
      async () => !(await inStash(h)),
      '"Reading" to leave the stash',
    );
  },

  'Deleted Items lists "Reading".': async h => {
    await h.activate();
    await h.open("deleted-items.html");
    await h.waitFor(
      `[...document.querySelectorAll("div.forest-item.folder.deleted > .forest-title")]
        .some(e => e.textContent.trim() === "Reading")`,
      '"Reading" in Deleted Items',
    );
  },
});
