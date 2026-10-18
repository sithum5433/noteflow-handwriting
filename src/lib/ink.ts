import { getStroke } from "perfect-freehand";

export type InkPoint = { x: number; y: number; pressure?: number };
export type PaperStyle = "plain" | "ruled" | "grid" | "dots";
export type InkStroke = {
  id: string;
  tool: "pen" | "highlighter";
  style: "pressure" | "constant";
  color: string;
  size: number;
  opacity: number;
  simulatePressure: boolean;
  points: InkPoint[];
};
export type InkDocument = {
  version: 2;
  width: number;
  height: number;
  paper: PaperStyle;
  strokes: InkStroke[];
};
type UnknownRecord = Record<string, unknown>;

export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414;
export const PAGE_EXTENSION = 707;
export const MAX_PAGE_HEIGHT = 20000;
export const clampInk = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
const safeColor = (value: unknown) =>
  typeof value === "string" &&
  /^(#[0-9a-f]{3,8}|[a-z]{1,20}|rgba?\([\d.,%\s]+\))$/i.test(value)
    ? value
    : "#253d35";
const paperStyle = (value: unknown): PaperStyle =>
  ["plain", "ruled", "grid", "dots"].includes(String(value))
    ? (value as PaperStyle)
    : "ruled";

export const emptyInk = (): InkDocument => ({
  version: 2,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  paper: "ruled",
  strokes: [],
});

/** Keep source coordinates and aspect ratio when opening earlier drawing formats. */
export function parseInk(data: string): {
  document: InkDocument;
  invalid: boolean;
} {
  if (!data) return { document: emptyInk(), invalid: false };
  try {
    const parsed: unknown = JSON.parse(data);
    const root = record(parsed);
    const source = Array.isArray(parsed)
      ? parsed
      : (root?.strokes ?? root?.lines ?? root?.paths);
    if (
      !Array.isArray(source) ||
      (root?.version !== undefined && ![1, 2].includes(Number(root.version)))
    )
      return { document: emptyInk(), invalid: true };
    const legacySketch = Array.isArray(parsed);
    const nativeV2 = root?.version === 2;
    const width = clampInk(
      finite(root?.width, legacySketch ? 600 : 1000),
      1,
      10000,
    );
    const height = clampInk(
      finite(root?.height, legacySketch ? 400 : 620),
      1,
      MAX_PAGE_HEIGHT,
    );
    const strokes: InkStroke[] = [];
    const usedIds = new Set<string>();
    let remainingPoints = 200000;
    let validEntries = 0;
    for (const [index, item] of source.slice(0, 10000).entries()) {
      const stroke = record(item);
      if (!stroke) continue;
      const rawPoints = stroke.points ?? stroke.paths;
      if (!Array.isArray(rawPoints)) continue;
      const points: InkPoint[] = [];
      for (const rawPoint of rawPoints.slice(
        0,
        Math.min(20000, remainingPoints),
      )) {
        const point = record(rawPoint);
        if (
          point &&
          typeof point.x === "number" &&
          typeof point.y === "number" &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y)
        ) {
          const next: InkPoint = {
            x: clampInk(point.x, 0, width),
            y: clampInk(point.y, 0, height),
          };
          if (
            typeof point.pressure === "number" &&
            Number.isFinite(point.pressure)
          )
            next.pressure = clampInk(point.pressure, 0, 1);
          points.push(next);
        }
      }
      remainingPoints -= points.length;
      if (!points.length) {
        if (rawPoints.length === 0) validEntries++;
        continue;
      }
      validEntries++;
      const size = clampInk(
        finite(
          stroke.size ??
            stroke.strokeWidth ??
            (typeof stroke.brushRadius === "number"
              ? stroke.brushRadius * 2
              : undefined),
          3,
        ),
        0.5,
        120,
      );
      if (stroke.drawMode === false) {
        for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
          const from = points[Math.max(0, pointIndex - 1)],
            to = points[pointIndex];
          for (
            let strokeIndex = strokes.length - 1;
            strokeIndex >= 0;
            strokeIndex--
          ) {
            if (touchesStroke(strokes[strokeIndex], from, to, size / 2))
              strokes.splice(strokeIndex, 1);
          }
        }
      } else {
        const tool = stroke.tool === "highlighter" ? "highlighter" : "pen";
        const sourceId =
          typeof stroke.id === "string" &&
          stroke.id.length > 0 &&
          stroke.id.length < 100
            ? stroke.id
            : `loaded-${index}`;
        let id = sourceId;
        let suffix = 1;
        while (usedIds.has(id)) id = `${sourceId}-${suffix++}`;
        usedIds.add(id);
        strokes.push({
          id,
          tool,
          style:
            nativeV2 && stroke.style !== "constant" ? "pressure" : "constant",
          color: safeColor(
            stroke.color ?? stroke.brushColor ?? stroke.strokeColor,
          ),
          size,
          opacity: clampInk(
            finite(stroke.opacity, tool === "highlighter" ? 0.3 : 1),
            0.05,
            1,
          ),
          simulatePressure: Boolean(stroke.simulatePressure),
          points,
        });
      }
      if (remainingPoints <= 0) break;
    }
    if (source.length > 0 && validEntries === 0)
      return { document: emptyInk(), invalid: true };
    return {
      document: {
        version: 2,
        width,
        height,
        paper: nativeV2 ? paperStyle(root?.paper) : "plain",
        strokes,
      },
      invalid: false,
    };
  } catch {
    return { document: emptyInk(), invalid: true };
  }
}

export function serializeInk(document: InkDocument): string {
  return document.strokes.length === 0 &&
    document.width === PAGE_WIDTH &&
    document.height === PAGE_HEIGHT &&
    document.paper === "ruled"
    ? ""
    : JSON.stringify(document);
}

/** Outline rendering preserves real pen pressure; a mouse uses velocity pressure. */
export function strokePath(stroke: InkStroke, complete = true): string {
  if (!stroke.points.length) return "";
  if (stroke.style === "constant") {
    return stroke.points.length === 1
      ? `M ${stroke.points[0].x} ${stroke.points[0].y} l 0.01 0`
      : stroke.points
          .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
          .join(" ");
  }
  const outline = getStroke(stroke.points, {
    size: stroke.size,
    thinning: stroke.tool === "highlighter" ? 0 : 0.5,
    smoothing: 0.65,
    streamline: 0.35,
    simulatePressure: stroke.simulatePressure,
    last: complete,
    start: { cap: true },
    end: { cap: true },
  });
  if (!outline.length) return "";
  const [first, ...rest] = outline;
  let path = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} Q`;
  for (let index = 0; index < rest.length; index++) {
    const current = rest[index];
    const next = rest[(index + 1) % rest.length] || first;
    path += ` ${current[0].toFixed(2)} ${current[1].toFixed(2)} ${((current[0] + next[0]) / 2).toFixed(2)} ${((current[1] + next[1]) / 2).toFixed(2)}`;
  }
  return `${path} Z`;
}

function pointDistance(point: InkPoint, from: InkPoint, to: InkPoint) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const ratio =
    dx || dy
      ? clampInk(
          ((point.x - from.x) * dx + (point.y - from.y) * dy) /
            (dx * dx + dy * dy),
          0,
          1,
        )
      : 0;
  return Math.hypot(
    point.x - from.x - ratio * dx,
    point.y - from.y - ratio * dy,
  );
}
function segmentsCross(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint) {
  const cross = (p: InkPoint, q: InkPoint, r: InkPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return (
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  );
}
export function touchesStroke(
  stroke: InkStroke,
  from: InkPoint,
  to: InkPoint,
  radius: number,
): boolean {
  const reach = radius + stroke.size / 2;
  if (stroke.points.length === 1)
    return pointDistance(stroke.points[0], from, to) <= reach;
  for (let index = 1; index < stroke.points.length; index++) {
    const a = stroke.points[index - 1],
      b = stroke.points[index];
    if (
      segmentsCross(a, b, from, to) ||
      Math.min(
        pointDistance(a, from, to),
        pointDistance(b, from, to),
        pointDistance(from, a, b),
        pointDistance(to, a, b),
      ) <= reach
    )
      return true;
  }
  return false;
}
