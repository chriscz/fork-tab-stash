const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  "The user is on Tab Stash's options page, with Page 1 open in another tab.":
    async h => {
      await h.open("options.html");
      await h.openPages(1);
    },

  "The user opened a second window and closed it, so no window has focus.":
    async h => {
      // Every extension context gets the focus events the background gets,
      // so the page can tell when Chrome has reported them.
      await h.eval(`(() => {
        globalThis.focusEvents = [];
        browser.windows.onFocusChanged.addListener(id => focusEvents.push(id));
      })()`);
      const id = await h.eval(
        `browser.windows.create({url: "about:blank"}).then(w => w.id)`,
      );
      await h.waitFor(
        `focusEvents.includes(${id})`,
        "the second window to have focus",
      );
      await h.eval(`browser.windows.remove(${id})`);
      await h.waitFor(
        `browser.windows.getAll().then(ws => ws.length === 1)`,
        "the second window to close",
      );
      await h.waitFor(
        `focusEvents.at(-1) === browser.windows.WINDOW_ID_NONE`,
        "focus to leave every window",
      );
    },

  'The user picks "Show Stashed Tabs" from Page 1\'s tab menu.': async h => {
    await h.clickTabMenuItem(h.pageUrl(1), h.message("showStashedTabsMenu"));
  },

  "A tab showing the stash list opens in the user's window.": async h => {
    const url = await h.eval(`browser.runtime.getURL("stash-list.html")`);
    await h.waitUntil(
      async () => (await h.tabs({url})).length === 1,
      "a stash-list tab in the user's window",
    );
  },
});
