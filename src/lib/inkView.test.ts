import { describe, expect, it } from "vitest";
import {
  clampZoom,
  DEFAULT_INK_PREFERENCES,
  INK_PREFERENCES_KEY,
  readInkPreferences,
  zoomAnchorScroll,
} from "./inkView";

describe("handwriting view controls", () => {
  it("bounds zoom without modifying any page geometry", () => {
    expect(clampZoom(0.01)).toBe(0.5);
    expect(clampZoom(10)).toBe(3);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1.35782)).toBe(1.358);
  });
  it("keeps a source point under the same cursor while a page grows", () => {
    expect(zoomAnchorScroll(0, 100, 1000, 0.5, 400)).toBe(200);
    expect(zoomAnchorScroll(100, -300, 1500, 0.4, 300)).toBe(100);
    expect(zoomAnchorScroll(0, 100, 200, 0.2, 400)).toBe(0);
  });
  it("sanitizes independent tool sizes and migrates the existing input preference", () => {
    const storage = {
      getItem: (key: string) =>
        key === INK_PREFERENCES_KEY
          ? JSON.stringify({
              tool: "eraser",
              penSize: -50,
              highlighterSize: 500,
              eraserSize: 48,
              penColor: "url(unsafe)",
              highlighterColor: "#00aa99",
              pressure: false,
              eraserMode: "point",
            })
          : key === "noteflow.ink.inputMode"
            ? "finger"
            : null,
    };
    expect(readInkPreferences(storage)).toEqual({
      ...DEFAULT_INK_PREFERENCES,
      tool: "eraser",
      inputMode: "finger",
      penSize: 0.5,
      highlighterSize: 80,
      eraserSize: 48,
      highlighterColor: "#00aa99",
      pressure: false,
      eraserMode: "point",
    });
  });
  it("works when preferences are malformed or storage is blocked", () => {
    expect(readInkPreferences({ getItem: () => "{bad json" })).toEqual(
      DEFAULT_INK_PREFERENCES,
    );
    expect(
      readInkPreferences({
        getItem: () => {
          throw new Error("Storage blocked");
        },
      }),
    ).toEqual(DEFAULT_INK_PREFERENCES);
  });
});
