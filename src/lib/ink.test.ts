import { describe, expect, it } from "vitest";
import {
  emptyInk,
  parseInk,
  serializeInk,
  strokePath,
  touchesStroke,
  type InkStroke,
} from "./ink";

const pen: InkStroke = {
  id: "pen-1",
  tool: "pen",
  style: "pressure",
  color: "#253d35",
  size: 4,
  opacity: 1,
  simulatePressure: false,
  points: [
    { x: 110, y: 140, pressure: 0.15 },
    { x: 150, y: 168, pressure: 0.75 },
    { x: 190, y: 150, pressure: 0.9 },
  ],
};

describe("handwriting storage and rendering", () => {
  it("roundtrips real pressure, page metadata, highlighter opacity, and stable stroke ids", () => {
    const document = {
      ...emptyInk(),
      height: 2121,
      paper: "grid" as const,
      strokes: [
        pen,
        {
          ...pen,
          id: "highlight-1",
          tool: "highlighter" as const,
          size: 24,
          opacity: 0.3,
        },
      ],
    };
    const first = parseInk(serializeInk(document));
    expect(first.invalid).toBe(false);
    expect(first.document).toEqual(document);
    expect(parseInk(serializeInk(first.document)).document).toEqual(document);
  });

  it("keeps legacy drawing coordinates, aspect ratio, and constant line appearance", () => {
    const legacy = parseInk(
      JSON.stringify({
        version: 1,
        width: 800,
        height: 350,
        strokes: [
          {
            id: "old-1",
            color: "#292c36",
            size: 3,
            points: [
              { x: 22, y: 33 },
              { x: 700, y: 310 },
            ],
          },
        ],
      }),
    );
    expect(legacy.invalid).toBe(false);
    expect(legacy.document).toMatchObject({
      width: 800,
      height: 350,
      paper: "plain",
    });
    expect(legacy.document.strokes[0]).toMatchObject({
      id: "old-1",
      style: "constant",
      size: 3,
      points: [
        { x: 22, y: 33 },
        { x: 700, y: 310 },
      ],
    });
    expect(strokePath(legacy.document.strokes[0])).toBe("M 22 33 L 700 310");
  });

  it("reads CanvasDraw brush radius as diameter without stretching the original canvas", () => {
    const legacy = parseInk(
      JSON.stringify({
        width: 400,
        height: 900,
        lines: [
          { brushColor: "#333", brushRadius: 2, points: [{ x: 30, y: 600 }] },
        ],
      }),
    );
    expect(legacy.document).toMatchObject({ width: 400, height: 900 });
    expect(legacy.document.strokes[0]).toMatchObject({
      size: 4,
      points: [{ x: 30, y: 600 }],
    });
  });

  it("preserves blank custom paper settings while a blank default page is empty", () => {
    expect(serializeInk(emptyInk())).toBe("");
    const custom = { ...emptyInk(), height: 2121, paper: "dots" as const };
    expect(parseInk(serializeInk(custom)).document).toEqual(custom);
    expect(parseInk("").document).toEqual(emptyInk());
  });

  it("renders smooth closed pen outlines and detects crossing eraser gestures", () => {
    const path = strokePath(pen);
    expect(path).toMatch(/^M /);
    expect(path).toContain(" Q ");
    expect(path).toMatch(/ Z$/);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(touchesStroke(pen, { x: 150, y: 100 }, { x: 150, y: 220 }, 2)).toBe(
      true,
    );
    expect(touchesStroke(pen, { x: 500, y: 500 }, { x: 600, y: 600 }, 2)).toBe(
      false,
    );
  });

  it("deduplicates imported ids without changing unique ids on each reopen", () => {
    const parsed = parseInk(
      JSON.stringify({ ...emptyInk(), strokes: [pen, pen] }),
    );
    expect(parsed.document.strokes.map((stroke) => stroke.id)).toEqual([
      "pen-1",
      "pen-1-1",
    ]);
    expect(
      parseInk(serializeInk(parsed.document)).document.strokes.map(
        (stroke) => stroke.id,
      ),
    ).toEqual(["pen-1", "pen-1-1"]);
  });

  it("reports malformed data instead of treating it as an empty page", () => {
    expect(parseInk("not json").invalid).toBe(true);
    expect(parseInk(JSON.stringify({ version: 9, strokes: [] })).invalid).toBe(
      true,
    );
    expect(
      parseInk(
        JSON.stringify({ strokes: [{ points: [{ x: "wrong", y: 8 }] }] }),
      ).invalid,
    ).toBe(true);
  });
});
