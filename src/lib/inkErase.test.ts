import { describe, expect, it } from "vitest";
import { eraseInkStrokes } from "./inkErase";
import { parseInk, serializeInk, emptyInk, type InkStroke } from "./ink";

function stroke(overrides: Partial<InkStroke> = {}): InkStroke {
  return {
    id: "ink-1",
    tool: "pen",
    style: "pressure",
    color: "#253d35",
    size: 2,
    opacity: 1,
    simulatePressure: false,
    points: [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 100, y: 0, pressure: 0.8 },
    ],
    ...overrides,
  };
}

describe("partial handwriting eraser", () => {
  it("splits a sparsely sampled two-point stroke when a swept eraser crosses its middle", () => {
    const original = stroke();
    const result = eraseInkStrokes(
      [original],
      { x: 50, y: -20 },
      { x: 50, y: 20 },
      5,
      "point",
    );
    expect(result).toHaveLength(2);
    expect(result[0].points[0]).toEqual(original.points[0]);
    expect(result[0].points.at(-1)!.x).toBeCloseTo(43.5);
    expect(result[1].points[0].x).toBeCloseTo(56.5);
    expect(result[1].points.at(-1)).toEqual(original.points.at(-1));
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("interpolates pressure at cut boundaries and preserves every brush property without mutating undo data", () => {
    const original = stroke({
      tool: "highlighter",
      opacity: 0.3,
      color: "#edc94c",
      simulatePressure: true,
    });
    const before = structuredClone(original);
    const result = eraseInkStrokes(
      [original],
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      5,
      "point",
    );
    expect(result[0].points.at(-1)!.pressure).toBeCloseTo(0.464);
    expect(result[1].points[0].pressure).toBeCloseTo(0.536);
    for (const fragment of result) {
      expect(fragment).toMatchObject({
        tool: "highlighter",
        style: "pressure",
        opacity: 0.3,
        size: 2,
        color: "#edc94c",
        simulatePressure: true,
      });
    }
    expect(original).toEqual(before);
    expect(result[0]).not.toBe(original);
    expect(result[0].points).not.toBe(original.points);
  });

  it("trims an endpoint instead of retaining a dot or deleting the unaffected rest", () => {
    const result = eraseInkStrokes(
      [stroke()],
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      9,
      "point",
    );
    expect(result).toHaveLength(1);
    expect(result[0].points[0].x).toBeCloseTo(10.5);
    expect(result[0].points.at(-1)!.x).toBe(100);
    expect(result[0].id).toBe("ink-1");
  });

  it("leaves unaffected arrays and strokes identical and ignores unusable eraser coordinates", () => {
    const original = [stroke()];
    expect(
      eraseInkStrokes(
        original,
        { x: 300, y: 300 },
        { x: 400, y: 400 },
        5,
        "point",
      ),
    ).toBe(original);
    expect(
      eraseInkStrokes(
        original,
        { x: 300, y: 300 },
        { x: 400, y: 400 },
        5,
        "stroke",
      ),
    ).toBe(original);
    expect(
      eraseInkStrokes(
        original,
        { x: Number.NaN, y: 0 },
        { x: 50, y: 0 },
        5,
        "point",
      ),
    ).toBe(original);
    expect(
      eraseInkStrokes(original, { x: 50, y: 0 }, { x: 50, y: 0 }, 0, "point"),
    ).toBe(original);
  });

  it("removes a whole stroke only in whole-stroke mode and retains other stroke references", () => {
    const crossed = stroke();
    const unaffected = stroke({
      id: "other",
      points: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
    });
    const result = eraseInkStrokes(
      [crossed, unaffected],
      { x: 50, y: -20 },
      { x: 50, y: 20 },
      5,
      "stroke",
    );
    expect(result).toEqual([unaffected]);
    expect(result[0]).toBe(unaffected);
  });

  it("keeps legacy constant-width paths constant and does not add fake pressure", () => {
    const legacy = stroke({
      style: "constant",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });
    const result = eraseInkStrokes(
      [legacy],
      { x: 50, y: -20 },
      { x: 50, y: 20 },
      5,
      "point",
    );
    expect(result).toHaveLength(2);
    expect(result.every((fragment) => fragment.style === "constant")).toBe(
      true,
    );
    expect(
      result
        .flatMap((fragment) => fragment.points)
        .every((point) => !Object.hasOwn(point, "pressure")),
    ).toBe(true);
  });

  it("uses round sweep endpoints for diagonal movement and erases single-point taps", () => {
    const dot = stroke({
      id: "dot",
      points: [{ x: 20, y: 20, pressure: 0.5 }],
    });
    const original = [dot];
    expect(
      eraseInkStrokes(original, { x: 0, y: 0 }, { x: 16, y: 16 }, 5, "point"),
    ).toEqual([]);
    expect(
      eraseInkStrokes(original, { x: 0, y: 0 }, { x: 10, y: 10 }, 5, "point"),
    ).toBe(original);
  });

  it("keeps several surviving sections separate instead of connecting over erased crossings", () => {
    const zigzag = stroke({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 40 },
        { x: 0, y: 40 },
      ],
    });
    const result = eraseInkStrokes(
      [zigzag],
      { x: 50, y: -10 },
      { x: 50, y: 50 },
      5,
      "point",
    );
    expect(result).toHaveLength(3);
    expect(result[0].points.at(-1)!.x).toBeCloseTo(43.5);
    expect(result[1].points[0].x).toBeCloseTo(56.5);
    expect(result[1].points.at(-1)!.x).toBeCloseTo(56.5);
    expect(result[2].points[0].x).toBeCloseTo(43.5);
  });

  it("leaves clearance for wide pressure-pen caps so a tiny point eraser creates a real gap", () => {
    const wide = stroke({
      size: 40,
      points: [
        { x: 0, y: 0, pressure: 1 },
        { x: 200, y: 0, pressure: 1 },
      ],
    });
    const result = eraseInkStrokes(
      [wide],
      { x: 100, y: 0 },
      { x: 100, y: 0 },
      1,
      "point",
    );
    expect(result).toHaveLength(2);
    const gap = result[1].points[0].x - result[0].points.at(-1)!.x;
    expect(gap).toBeGreaterThanOrEqual(62 - 0.000001);
  });

  it("generates deterministic unique fragment IDs that remain stable after save and reopen", () => {
    const original = [
      stroke(),
      stroke({
        id: "ink-1~cut-1",
        points: [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
        ],
      }),
    ];
    const first = eraseInkStrokes(
      original,
      { x: 50, y: -10 },
      { x: 50, y: 10 },
      5,
      "point",
    );
    const repeated = eraseInkStrokes(
      original,
      { x: 50, y: -10 },
      { x: 50, y: 10 },
      5,
      "point",
    );
    expect(first.map((fragment) => fragment.id)).toEqual(
      repeated.map((fragment) => fragment.id),
    );
    expect(new Set(first.map((fragment) => fragment.id)).size).toBe(
      first.length,
    );
    expect(
      parseInk(serializeInk({ ...emptyInk(), strokes: first })).document
        .strokes,
    ).toEqual(first);
  });
});
