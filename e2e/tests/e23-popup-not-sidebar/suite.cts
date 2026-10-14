const assert = require("node:assert/strict");
const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  "The toolbar button shows the popup, and stashing from a menu is set to show the popup too.":
    async h => {
      await h.seed({
        options: {
          sync: {
            browser_action_stash: "none",
            browser_action_show: "popup",
            open_stash_in: "popup",
          },
        },
      });
    },

  "Page 1 is open and the sidebar is closed.": async h => {
    await h.openPages(1);
    await h.closeSidebar();
    assert.equal(await h.sidebarOpen(), false);
  },

  'The user picks "Stash This Tab" from Page 1\'s tab menu.': async h => {
    await h.clickTabMenuItem(h.pageUrl(1), h.message("stashThisTabMenu"));
  },

  "Tab Stash's popup is shown.": async h => {
    const popups = await h.waitUntil(async () => {
      const p = await h.popups();
      return p.length > 0 ? p : undefined;
    }, "the popup to show");
    assert.deepEqual(popups, [
      await h.eval(`browser.runtime.getURL("stash-list.html?view=popup")`),
    ]);
  },

  "The sidebar stays closed.": async h => {
    assert.equal(await h.sidebarOpen(), false);
  },
});
