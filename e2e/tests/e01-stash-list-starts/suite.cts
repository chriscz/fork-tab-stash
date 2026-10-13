const {steps} = require("../../harness/runner.cts");

module.exports = steps(__dirname, {
  // The driver installs the build in a fresh profile before any step runs.
  "Tab Stash is installed in a fresh profile.": async () => {},

  "The user opens the stash list.": async h => {
    await h.open("stash-list.html");
  },

  "The stash list renders.": async h => {
    await h.waitFor(
      `!!document.querySelector("main.stash-list")`,
      "the stash list to render",
    );
  },
});
