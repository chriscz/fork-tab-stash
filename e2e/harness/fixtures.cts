// Given steps several specs share, so a spec that starts "after E2" binds to
// the same setup instead of depending on another test.

const given = {
  async threeOpenPages(h: any): Promise<void> {
    await h.openPages(3);
  },

  // E2's end state: three pages stashed with "Stash all" into one new
  // folder.  The pages' tab ids are kept in h.vars.pageTabs for later steps.
  async stashedThreePages(h: any): Promise<void> {
    await h.openPages(3);
    h.vars.pageTabs = await h.tabs({url: h.pageUrls(3)});
    await h.click('nav.forest-toolbar > a[class="action stash"]');
    await h.waitUntil(
      async () =>
        (await h.tabs({url: h.pageUrls(3), hidden: false})).length === 0,
      "the three pages to leave the window",
    );
    await h.waitUntil(
      async () => (await h.stash())[0]?.urls.length === 3,
      "the stash folder to hold three pages",
    );
  },

  // A folder seeded into the stash and then deleted through its menu, so it
  // is in Deleted Items.
  async deletedFolder(h: any, title: string, pages: number[]): Promise<void> {
    await h.seed({stash: [{title, pages}]});
    await h.showAllFolders();
    await h.clickInFolder(title, "summary");
    await h.clickInFolder(
      title,
      `button[title="${h.message("deleteGroupTooltip")}"]`,
    );
    await h.waitUntil(
      async () => !(await h.stash()).some((f: any) => f.title === title),
      `"${title}" to be deleted`,
    );
  },
};

module.exports = {given};
