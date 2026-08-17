import { describe, expect, it } from "vitest";
import { replaceUrlParameters, viewportStateFromSearch } from "./urlState";

const fallback = { centerX: 1, centerY: 2, area: 16 };

describe("viewport URL state", () => {
  it("reads finite coordinates and positive area", () => {
    expect(viewportStateFromSearch("?x=-3.5&y=8&area=0.125", fallback)).toEqual({
      centerX: -3.5,
      centerY: 8,
      area: 0.125,
    });
  });

  it("uses individual defaults for missing or invalid values", () => {
    expect(viewportStateFromSearch("?x=nope&y=4&area=0", fallback)).toEqual({
      centerX: 1,
      centerY: 4,
      area: 16,
    });
  });

  it("replaces selected parameters while preserving the rest of the URL", () => {
    window.history.replaceState(null, "", "/terrain?seed=old&debug=1#view");
    replaceUrlParameters({ area: "4", seed: "new value", x: "2", y: "-3" });

    expect(window.location.pathname).toBe("/terrain");
    expect(window.location.search).toBe("?seed=new+value&debug=1&area=4&x=2&y=-3");
    expect(window.location.hash).toBe("#view");
  });

  it("deletes parameters whose values are undefined", () => {
    window.history.replaceState(null, "", "/starfield?seed=world&x=2&y=3&area=4");
    replaceUrlParameters({ area: undefined, x: undefined });

    expect(window.location.search).toBe("?seed=world&y=3");
  });
});
