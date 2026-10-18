import type { InkPoint, InkStroke } from "./ink";

type Interval = readonly [number, number];
const EPSILON = 1e-9;

function distanceSquared(
  point: InkPoint,
  from: InkPoint,
  to: InkPoint,
): number {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared,
        ),
      )
    : 0;
  return (
    (point.x - from.x - ratio * dx) ** 2 + (point.y - from.y - ratio * dy) ** 2
  );
}

function circleInterval(
  start: InkPoint,
  end: InkPoint,
  center: InkPoint,
  radius: number,
): Interval | null {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const px = start.x - center.x,
    py = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a <= EPSILON ** 2)
    return px * px + py * py <= radius * radius ? [0, 1] : null;
  const b = 2 * (px * dx + py * dy);
  const c = px * px + py * py - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const low = Math.max(0, (-b - root) / (2 * a));
  const high = Math.min(1, (-b + root) / (2 * a));
  return low <= high ? [low, high] : null;
}

function linearInterval(
  origin: number,
  direction: number,
  minimum: number,
  maximum: number,
): Interval | null {
  if (Math.abs(direction) <= EPSILON)
    return origin >= minimum && origin <= maximum ? [0, 1] : null;
  const first = (minimum - origin) / direction,
    second = (maximum - origin) / direction;
  const low = Math.max(0, Math.min(first, second)),
    high = Math.min(1, Math.max(first, second));
  return low <= high ? [low, high] : null;
}

/** Intersect an ink segment with the eraser's swept capsule, including both round ends. */
function capsuleInterval(
  start: InkPoint,
  end: InkPoint,
  from: InkPoint,
  to: InkPoint,
  radius: number,
): Interval | null {
  if (
    Math.max(start.x, end.x) < Math.min(from.x, to.x) - radius ||
    Math.min(start.x, end.x) > Math.max(from.x, to.x) + radius ||
    Math.max(start.y, end.y) < Math.min(from.y, to.y) - radius ||
    Math.min(start.y, end.y) > Math.max(from.y, to.y) + radius
  )
    return null;
  const intervals = [
    circleInterval(start, end, from, radius),
    circleInterval(start, end, to, radius),
  ];
  const sweepX = to.x - from.x,
    sweepY = to.y - from.y;
  const length = Math.hypot(sweepX, sweepY);
  if (length > EPSILON) {
    const ux = sweepX / length,
      uy = sweepY / length;
    const px = start.x - from.x,
      py = start.y - from.y;
    const dx = end.x - start.x,
      dy = end.y - start.y;
    const along = linearInterval(
      px * ux + py * uy,
      dx * ux + dy * uy,
      0,
      length,
    );
    const across = linearInterval(
      -px * uy + py * ux,
      -dx * uy + dy * ux,
      -radius,
      radius,
    );
    if (along && across) {
      const low = Math.max(along[0], across[0]),
        high = Math.min(along[1], across[1]);
      if (low <= high) intervals.push([low, high]);
    }
  }
  const hits = intervals.filter(
    (interval): interval is Interval => interval !== null,
  );
  // A capsule is convex, so its intersections with a straight segment form one interval.
  return hits.length
    ? [
        Math.min(...hits.map((hit) => hit[0])),
        Math.max(...hits.map((hit) => hit[1])),
      ]
    : null;
}

function interpolate(start: InkPoint, end: InkPoint, ratio: number): InkPoint {
  if (ratio <= EPSILON) return start;
  if (ratio >= 1 - EPSILON) return end;
  const point: InkPoint = {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
  if (start.pressure !== undefined || end.pressure !== undefined) {
    point.pressure =
      (start.pressure ?? 0.5) +
      ((end.pressure ?? 0.5) - (start.pressure ?? 0.5)) * ratio;
  }
  return point;
}

function append(points: InkPoint[], point: InkPoint): void {
  const last = points.at(-1);
  if (
    !last ||
    last.x !== point.x ||
    last.y !== point.y ||
    last.pressure !== point.pressure
  )
    points.push(point);
}

function splitPoints(
  stroke: InkStroke,
  from: InkPoint,
  to: InkPoint,
  reach: number,
): InkPoint[][] | null {
  const source = stroke.points;
  if (!source.length) return null;
  if (source.length === 1)
    return distanceSquared(source[0], from, to) <= reach * reach ? [] : null;
  const fragments: InkPoint[][] = [];
  let current: InkPoint[] = [];
  let changed = false;
  const flush = () => {
    if (current.length) fragments.push(current);
    current = [];
  };
  for (let index = 1; index < source.length; index++) {
    const start = source[index - 1],
      end = source[index];
    const erased = capsuleInterval(start, end, from, to, reach);
    if (!erased || erased[1] - erased[0] <= EPSILON) {
      append(current, start);
      append(current, end);
      continue;
    }
    changed = true;
    if (erased[0] > EPSILON) {
      append(current, start);
      append(current, interpolate(start, end, erased[0]));
    }
    flush();
    if (erased[1] < 1 - EPSILON) {
      append(current, interpolate(start, end, erased[1]));
      append(current, end);
    }
  }
  flush();
  return changed ? fragments : null;
}

function fragmentId(
  sourceId: string,
  index: number,
  reserved: Set<string>,
): string {
  // Leave room for the suffix so generated IDs survive the existing import validator's length limit.
  const prefix = sourceId.slice(0, 80);
  let number = index;
  let candidate = `${prefix}~cut-${number}`;
  while (reserved.has(candidate)) candidate = `${prefix}~cut-${++number}`;
  reserved.add(candidate);
  return candidate;
}

/** Pure erasure: return the same array when unaffected; changed fragments never reconnect across a gap. */
export function eraseInkStrokes(
  strokes: InkStroke[],
  from: InkPoint,
  to: InkPoint,
  radius: number,
  mode: "point" | "stroke",
): InkStroke[] {
  if (
    !(radius > 0) ||
    ![from.x, from.y, to.x, to.y, radius].every(Number.isFinite)
  )
    return strokes;
  const reserved = new Set(strokes.map((stroke) => stroke.id));
  const result: InkStroke[] = [];
  let changed = false;
  for (const stroke of strokes) {
    // Pressure pen outlines can reach 0.75 × size at full pressure; constant-width
    // paths and highlighters use half size. Leave clearance for the new round caps.
    const inkRadius =
      stroke.size *
      (stroke.style === "pressure" && stroke.tool === "pen" ? 0.75 : 0.5);
    const reach = radius + Math.max(0, inkRadius);
    if (mode === "stroke") {
      const hit =
        stroke.points.length === 1
          ? distanceSquared(stroke.points[0], from, to) <= reach * reach
          : stroke.points.some(
              (end, index) =>
                index > 0 &&
                capsuleInterval(
                  stroke.points[index - 1],
                  end,
                  from,
                  to,
                  reach,
                ) !== null,
            );
      if (hit) changed = true;
      else result.push(stroke);
      continue;
    }
    const fragments = splitPoints(stroke, from, to, reach);
    if (fragments === null) {
      result.push(stroke);
      continue;
    }
    changed = true;
    fragments.forEach((points, index) =>
      result.push({
        ...stroke,
        id: index === 0 ? stroke.id : fragmentId(stroke.id, index, reserved),
        points,
      }),
    );
  }
  return changed ? result : strokes;
}
