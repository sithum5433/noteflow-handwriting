import { memo, useMemo } from "react";
import { parseInk, strokePath } from "../lib/ink";

/** A small ink preview; all original strokes stay in the note and its backup. */
function InkPreview({ data }: { data: string }) {
  const preview = useMemo(() => {
    const { document } = parseInk(data);
    const strokes = document.strokes.slice(0, 80);
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const stroke of strokes)
      for (const point of stroke.points) {
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
      }
    const width = Math.max(250, right - left + 50);
    const height = Math.max(width / 4, bottom - top + 30);
    return {
      strokes,
      viewBox: `${Math.max(0, left - 25)} ${Math.max(0, top - 15)} ${width} ${height}`,
    };
  }, [data]);
  if (!preview.strokes.length) return null;
  return (
    <div className="note-ink-preview" aria-hidden="true">
      <svg viewBox={preview.viewBox} preserveAspectRatio="xMinYMid meet">
        {preview.strokes.map((stroke) => (
          <path
            key={stroke.id}
            d={strokePath(stroke)}
            fill={stroke.style === "pressure" ? stroke.color : "none"}
            stroke={stroke.style === "constant" ? stroke.color : "none"}
            strokeWidth={stroke.size}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={stroke.opacity}
          />
        ))}
      </svg>
    </div>
  );
}
export default memo(InkPreview);
