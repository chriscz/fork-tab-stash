import {expect} from "chai";

import * as M from "./oops.js";

describe("util/oops", () => {
  describe("logError()", () => {
    let logged: unknown[][];
    let consoleError: typeof console.error;

    beforeEach(() => {
      logged = [];
      consoleError = console.error;
      console.error = (...args: unknown[]) => logged.push(args);
    });

    afterEach(() => {
      console.error = consoleError;
      M.clearErrorLog();
    });

    it("logs an error's stack as text, as well as the error", () => {
      const error = new Error("x");
      M.logError(error);

      expect(logged.length).to.equal(1);
      expect(logged[0][0]).to.equal(error);
      expect(
        logged[0].some(a => typeof a === "string" && a.includes(error.stack!)),
      ).to.be.true;
    });

    it("logs other values as they are", () => {
      M.logError("oops");
      expect(logged).to.deep.equal([["oops"]]);
    });
  });
});
