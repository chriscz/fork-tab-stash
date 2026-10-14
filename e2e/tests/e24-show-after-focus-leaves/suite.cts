const {steps} = require("../../harness/runner.cts");

steps(__dirname, {
  "The toolbar button is set to show the stash in a tab and stash nothing.":
    async h => {
      await h.seed({
        options: {
          sync: {browser_action_show: "tab", browser_action_stash: "none"},
        },
      });
    },

  "The user is on Tab Stash's options page.": async h => {
    await h.open("options.html");
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

  "The user clicks Tab Stash's toolbar button.": async h => {
    await h.clickToolbarButton();
  },

  "A tab showing the stash list opens in the user's window.": async h => {
    const url = await h.eval(`browser.runtime.getURL("stash-list.html")`);
    await h.waitUntil(
      async () => (await h.tabs({url})).length === 1,
      "a stash-list tab in the user's window",
    );
  },
});
