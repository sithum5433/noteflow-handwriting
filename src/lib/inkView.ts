export type InkTool = "pen" | "highlighter" | "eraser" | "hand";
export type InkInputMode = "stylus" | "finger";
export type InkPreferences = {
  tool: InkTool;
  inputMode: InkInputMode;
  penColor: string;
  highlighterColor: string;
  penSize: number;
  highlighterSize: number;
  eraserSize: number;
  eraserMode: "point" | "stroke";
  pressure: boolean;
};

export const INK_PREFERENCES_KEY = "noteflow.ink.preferences.v1";
export const DEFAULT_INK_PREFERENCES: InkPreferences = {
  tool: "pen",
  inputMode: "stylus",
  penColor: "#253d35",
  highlighterColor: "#edc94c",
  penSize: 3,
  highlighterSize: 22,
  eraserSize: 24,
  eraserMode: "stroke",
  pressure: true,
};
export const clampZoom = (zoom: number) =>
  Math.round(
    Math.max(0.5, Math.min(3, Number.isFinite(zoom) ? zoom : 1)) * 1000,
  ) / 1000;
const size = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
const color = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export function readInkPreferences(
  storage?: Pick<Storage, "getItem">,
): InkPreferences {
  const defaults = { ...DEFAULT_INK_PREFERENCES };
  try {
    const target = storage ?? localStorage;
    if (target.getItem("noteflow.ink.inputMode") === "finger")
      defaults.inputMode = "finger";
    const raw = target.getItem(INK_PREFERENCES_KEY);
    if (!raw) return defaults;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return defaults;
    const prefs = value as Record<string, unknown>;
    return {
      tool: ["pen", "highlighter", "eraser", "hand"].includes(
        String(prefs.tool),
      )
        ? (prefs.tool as InkTool)
        : defaults.tool,
      inputMode: ["stylus", "finger"].includes(String(prefs.inputMode))
        ? (prefs.inputMode as InkInputMode)
        : defaults.inputMode,
      penColor: color(prefs.penColor, defaults.penColor),
      highlighterColor: color(
        prefs.highlighterColor,
        defaults.highlighterColor,
      ),
      penSize: size(prefs.penSize, defaults.penSize, 0.5, 24),
      highlighterSize: size(
        prefs.highlighterSize,
        defaults.highlighterSize,
        4,
        80,
      ),
      eraserSize: size(prefs.eraserSize, defaults.eraserSize, 4, 160),
      eraserMode: prefs.eraserMode === "point" ? "point" : "stroke",
      pressure:
        typeof prefs.pressure === "boolean"
          ? prefs.pressure
          : defaults.pressure,
    };
  } catch {
    return defaults;
  }
}

export function zoomAnchorScroll(
  currentScroll: number,
  stageClientStart: number,
  stageSize: number,
  sourceRatio: number,
  clientAnchor: number,
): number {
  return Math.max(
    0,
    currentScroll + stageClientStart + stageSize * sourceRatio - clientAnchor,
  );
}
