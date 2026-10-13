// Given steps several specs share, so a spec that starts "after E2" binds to
// the same setup instead of depending on another test.

const given = {
  async threeOpenPages(h: any): Promise<void> {
    await h.openPages(3);
  },
};

module.exports = {given};
