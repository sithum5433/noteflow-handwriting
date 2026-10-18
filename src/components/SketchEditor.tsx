import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Download,
  Eraser,
  Highlighter,
  PenLine,
  Plus,
  Redo2,
  ShieldCheck,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  clampInk,
  MAX_PAGE_HEIGHT,
  PAGE_EXTENSION,
  parseInk,
  serializeInk,
  strokePath,
  touchesStroke,
  type InkDocument,
  type InkPoint,
  type InkStroke,
  type PaperStyle,
} from "../lib/ink";
import "./editors.css";

export interface SketchEditorProps {
  data: string;
  onChange: (data: string) => void;
  readOnly?: boolean;
}
type Tool = "pen" | "highlighter" | "eraser";
type InputMode = "stylus" | "finger";
type ActiveGesture = {
  pointerId: number;
  pointerType: string;
  erasing: boolean;
  before: InkDocument;
  previous: InkPoint;
  stroke: InkStroke | null;
};
const COLORS = [
  "#253d35",
  "#426bc2",
  "#9a5fc1",
  "#ca6662",
  "#38987e",
  "#dfad32",
];
const COLOR_NAMES = ["Charcoal", "Blue", "Violet", "Coral", "Sage", "Amber"];
const NATIVE_TOUCH = "pan-y pinch-zoom";

const InkPath = memo(function InkPath({
  stroke,
  complete = true,
}: {
  stroke: InkStroke;
  complete?: boolean;
}) {
  return (
    <path
      data-ink-stroke="true"
      data-tool={stroke.tool}
      d={strokePath(stroke, complete)}
      fill={stroke.style === "pressure" ? stroke.color : "none"}
      stroke={stroke.style === "constant" ? stroke.color : "none"}
      strokeWidth={stroke.style === "constant" ? stroke.size : undefined}
      opacity={stroke.opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
});

export default function SketchEditor({
  data,
  onChange,
  readOnly = false,
}: SketchEditorProps) {
  const [initial] = useState(() => parseInk(data));
  const [document, setDocument] = useState(initial.document);
  const [invalid, setInvalid] = useState(initial.invalid);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    try {
      return localStorage.getItem("noteflow.ink.inputMode") === "finger"
        ? "finger"
        : "stylus";
    } catch {
      return "stylus";
    }
  });
  const [penColor, setPenColor] = useState(COLORS[0]);
  const [highlightColor, setHighlightColor] = useState("#edc94c");
  const [penSize, setPenSize] = useState(3);
  const [highlightSize, setHighlightSize] = useState(22);
  const [historyStep, setHistoryStep] = useState(0);
  const [historyLength, setHistoryLength] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportError, setExportError] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const documentRef = useRef(document);
  const historyRef = useRef<InkDocument[]>([initial.document]);
  const stepRef = useRef(0);
  const activeRef = useRef<ActiveGesture | null>(null);
  const penHoverRef = useRef(false);
  const lastDataRef = useRef(data);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const id = useId().replace(/:/g, "");
  const size = tool === "highlighter" ? highlightSize : penSize;
  const color = tool === "highlighter" ? highlightColor : penColor;
  const setColor = (next: string) =>
    tool === "highlighter" ? setHighlightColor(next) : setPenColor(next);

  const showDocument = (next: InkDocument) => {
    documentRef.current = next;
    setDocument(next);
  };
  const restoreTouchAction = () => {
    if (svgRef.current)
      svgRef.current.style.touchAction =
        !readOnly && (inputMode === "finger" || penHoverRef.current)
          ? "none"
          : NATIVE_TOUCH;
  };
  const releasePointer = (pointerId: number) => {
    const svg = svgRef.current;
    try {
      if (svg?.hasPointerCapture(pointerId))
        svg.releasePointerCapture(pointerId);
    } catch {
      /* Synthetic and cancelled pointers may already have lost capture. */
    }
  };
  const notify = (next: InkDocument) => {
    const encoded = serializeInk(next);
    lastDataRef.current = encoded;
    setInvalid(false);
    onChangeRef.current(encoded);
  };
  const commit = (next: InkDocument) => {
    const history = historyRef.current.slice(0, stepRef.current + 1);
    history.push(next);
    if (history.length > 100) history.shift();
    historyRef.current = history;
    stepRef.current = history.length - 1;
    setHistoryStep(stepRef.current);
    setHistoryLength(history.length);
    showDocument(next);
    notify(next);
  };

  const finish = (pointerId?: number) => {
    const active = activeRef.current;
    if (!active || (pointerId !== undefined && pointerId !== active.pointerId))
      return;
    // Clear before releasing capture: lostpointercapture must not commit twice.
    activeRef.current = null;
    setCurrentStroke(null);
    if (active.stroke)
      commit({
        ...documentRef.current,
        strokes: [...documentRef.current.strokes, active.stroke],
      });
    else if (
      active.before.strokes.length !== documentRef.current.strokes.length
    )
      commit(documentRef.current);
    releasePointer(active.pointerId);
    restoreTouchAction();
  };

  const cancel = () => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    setCurrentStroke(null);
    showDocument(active.before);
    releasePointer(active.pointerId);
    restoreTouchAction();
  };

  useEffect(() => {
    if (data === lastDataRef.current) return;
    lastDataRef.current = data;
    const next = parseInk(data);
    const active = activeRef.current;
    activeRef.current = null;
    if (active) releasePointer(active.pointerId);
    restoreTouchAction();
    setCurrentStroke(null);
    setInvalid(next.invalid);
    showDocument(next.document);
    historyRef.current = [next.document];
    stepRef.current = 0;
    setHistoryStep(0);
    setHistoryLength(1);
    setConfirmClear(false);
  }, [data]);

  useEffect(() => {
    if (readOnly) {
      if (activeRef.current) cancel();
      setConfirmClear(false);
    }
    restoreTouchAction();
  }, [readOnly, inputMode]);

  useEffect(() => {
    try {
      localStorage.setItem("noteflow.ink.inputMode", inputMode);
    } catch {
      /* Handwriting still works when storage is unavailable. */
    }
  }, [inputMode]);

  const travelHistory = (direction: -1 | 1) => {
    if (readOnly) return;
    finish();
    const nextStep = clampInk(
      stepRef.current + direction,
      0,
      historyRef.current.length - 1,
    );
    if (nextStep === stepRef.current) return;
    stepRef.current = nextStep;
    setHistoryStep(nextStep);
    const next = historyRef.current[nextStep];
    showDocument(next);
    notify(next);
  };

  const coordinates = (
    event: { clientX: number; clientY: number; pressure?: number },
    pointerType: string,
  ): InkPoint | null => {
    const svg = svgRef.current,
      matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const translated = point.matrixTransform(matrix.inverse());
    const position: InkPoint = {
      x:
        Math.round(clampInk(translated.x, 0, documentRef.current.width) * 100) /
        100,
      y:
        Math.round(
          clampInk(translated.y, 0, documentRef.current.height) * 100,
        ) / 100,
    };
    if (pointerType === "pen")
      position.pressure =
        typeof event.pressure === "number" && Number.isFinite(event.pressure)
          ? Math.round(clampInk(event.pressure, 0, 1) * 1000) / 1000
          : 0.5;
    return position;
  };

  const eraseAt = (point: InkPoint, active: ActiveGesture) => {
    const next = documentRef.current.strokes.filter(
      (stroke) =>
        !touchesStroke(
          stroke,
          active.previous,
          point,
          Math.max(10, penSize * 3),
        ),
    );
    if (next.length !== documentRef.current.strokes.length)
      showDocument({ ...documentRef.current, strokes: next });
    active.previous = point;
  };
  const isHardwareEraser = (event: {
    pointerType: string;
    button: number;
    buttons: number;
  }) =>
    event.pointerType === "pen" &&
    (event.button === 5 ||
      (event.buttons & 32) !== 0 ||
      event.button === 2 ||
      (event.buttons & 2) !== 0);

  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || invalid) return;
    const pointerType = event.pointerType || "mouse";
    if (
      pointerType === "touch" &&
      (inputMode !== "finger" || activeRef.current?.pointerType === "pen")
    )
      return;
    const hardwareEraser = isHardwareEraser(event);
    if (event.button !== 0 && !hardwareEraser) return;
    if (activeRef.current) {
      if (pointerType === "pen" && activeRef.current.pointerType === "touch")
        cancel();
      else return;
    }
    const point = coordinates(event, pointerType);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    if (pointerType === "pen") event.currentTarget.style.touchAction = "none";
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Detached synthetic events do not own an active browser pointer. */
    }
    const erasing = tool === "eraser" || hardwareEraser;
    const stroke: InkStroke | null = erasing
      ? null
      : {
          id:
            globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          tool: tool === "highlighter" ? "highlighter" : "pen",
          style: "pressure",
          color,
          size: tool === "highlighter" ? highlightSize : penSize,
          opacity: tool === "highlighter" ? 0.3 : 1,
          simulatePressure: pointerType !== "pen",
          points: [point],
        };
    const active: ActiveGesture = {
      pointerId: event.pointerId,
      pointerType,
      erasing,
      before: documentRef.current,
      previous: point,
      stroke,
    };
    activeRef.current = active;
    if (erasing) eraseAt(point, active);
    else setCurrentStroke(stroke);
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = activeRef.current;
    if (readOnly || !active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    // A pen barrel button can be pressed after the nib has touched the page.
    if (!active.erasing && isHardwareEraser(event)) {
      active.stroke = null;
      active.erasing = true;
      setCurrentStroke(null);
    }
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    const samples = coalesced?.length ? coalesced : [event.nativeEvent];
    if (active.stroke) {
      const points = [...active.stroke.points];
      for (const sample of samples) {
        const point = coordinates(sample, active.pointerType),
          last = points[points.length - 1];
        if (
          point &&
          points.length < 20000 &&
          (Math.hypot(point.x - last.x, point.y - last.y) >= 0.2 ||
            Math.abs((point.pressure ?? 0.5) - (last.pressure ?? 0.5)) > 0.01)
        )
          points.push(point);
      }
      active.stroke = { ...active.stroke, points };
      setCurrentStroke(active.stroke);
    } else
      for (const sample of samples) {
        const point = coordinates(sample, active.pointerType);
        if (point) eraseAt(point, active);
      }
  };

  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (readOnly) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      ["z", "y"].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      travelHistory(event.key.toLowerCase() === "y" || event.shiftKey ? 1 : -1);
    }
    if (event.key === "Escape") cancel();
  };
  const changePaper = (paper: PaperStyle) => {
    finish();
    commit({ ...documentRef.current, paper });
  };
  const extendPaper = () => {
    finish();
    commit({
      ...documentRef.current,
      height: Math.min(
        MAX_PAGE_HEIGHT,
        documentRef.current.height + PAGE_EXTENSION,
      ),
    });
  };
  const chooseTool = (next: Tool) => {
    finish();
    setTool(next);
  };

  const exportPNG = async () => {
    finish();
    setExportError("");
    let objectUrl = "";
    try {
      const svg = svgRef.current;
      if (!svg) return;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const { width, height } = documentRef.current;
      // Long notebooks are exported within a browser-safe pixel budget.
      const scale = Math.min(
        2,
        8192 / width,
        16384 / height,
        Math.sqrt(32000000 / (width * height)),
      );
      const exportWidth = Math.max(1, Math.round(width * scale)),
        exportHeight = Math.max(1, Math.round(height * scale));
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(exportWidth));
      clone.setAttribute("height", String(exportHeight));
      clone
        .querySelectorAll("[data-export-ignore]")
        .forEach((element) => element.remove());
      objectUrl = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml;charset=utf-8",
        }),
      );
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
        image.src = objectUrl;
      });
      const canvas = window.document.createElement("canvas");
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.fillStyle = "#fffdf7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Export failed.")),
          "image/png",
        ),
      );
      const downloadUrl = URL.createObjectURL(blob),
        anchor = window.document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = "noteflow-handwriting.png";
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch {
      setExportError("Could not export this page. Please try again.");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  const patternId = `${id}-paper`;
  return (
    <div
      className={`sketch-editor handwriting-editor${readOnly ? " is-readonly" : ""}`}
    >
      <div className="handwriting-controls">
        <div
          className="editor-toolbar sketch-toolbar"
          role="toolbar"
          aria-label="Handwriting tools"
        >
          <button
            type="button"
            className={`toolbar-button handwriting-tool${tool === "pen" ? " is-active" : ""}`}
            aria-label="Pen"
            title="Pressure-sensitive pen"
            aria-pressed={tool === "pen"}
            disabled={readOnly || invalid}
            onClick={() => chooseTool("pen")}
          >
            <PenLine size={18} />
            <span>Pen</span>
          </button>
          <button
            type="button"
            className={`toolbar-button handwriting-tool${tool === "highlighter" ? " is-active" : ""}`}
            aria-label="Highlighter"
            title="Highlighter"
            aria-pressed={tool === "highlighter"}
            disabled={readOnly || invalid}
            onClick={() => chooseTool("highlighter")}
          >
            <Highlighter size={18} />
            <span>Highlight</span>
          </button>
          <button
            type="button"
            className={`toolbar-button handwriting-tool${tool === "eraser" ? " is-active" : ""}`}
            aria-label="Stroke eraser"
            title="Erase entire strokes"
            aria-pressed={tool === "eraser"}
            disabled={readOnly || invalid}
            onClick={() => chooseTool("eraser")}
          >
            <Eraser size={18} />
            <span>Erase</span>
          </button>
          <span className="toolbar-divider" />
          <div className="sketch-colors" role="group" aria-label="Ink colors">
            {COLORS.map((penColor, index) => (
              <button
                type="button"
                key={penColor}
                className={`sketch-color${color === penColor ? " is-selected" : ""}`}
                style={{ "--swatch": penColor } as CSSProperties}
                aria-label={COLOR_NAMES[index]}
                aria-pressed={color === penColor}
                title={COLOR_NAMES[index]}
                disabled={readOnly || invalid}
                onClick={() => {
                  finish();
                  setColor(penColor);
                  if (tool === "eraser") setTool("pen");
                }}
              />
            ))}
            <label className="sketch-custom-color" title="Custom ink color">
              <input
                type="color"
                aria-label="Custom pen color"
                value={color}
                disabled={readOnly || invalid}
                onChange={(event) => {
                  finish();
                  setColor(event.target.value);
                  if (tool === "eraser") setTool("pen");
                }}
              />
              <span aria-hidden="true">+</span>
            </label>
          </div>
          <span className="toolbar-divider" />
          <label className="sketch-size-label" htmlFor={`${id}-size`}>
            Size
          </label>
          <input
            id={`${id}-size`}
            className="sketch-size"
            aria-label="Brush size"
            type="range"
            min={tool === "highlighter" ? 8 : 1}
            max={tool === "highlighter" ? 48 : 12}
            step={tool === "highlighter" ? 1 : 0.5}
            value={size}
            disabled={readOnly || invalid}
            onChange={(event) =>
              tool === "highlighter"
                ? setHighlightSize(Number(event.target.value))
                : setPenSize(Number(event.target.value))
            }
          />
          <span className="sketch-size-value" aria-hidden="true">
            {size}
          </span>
          <span className="toolbar-spacer" />
          <button
            type="button"
            className="toolbar-button handwriting-undo"
            aria-label="Undo drawing"
            title="Undo"
            disabled={readOnly || historyStep === 0}
            onClick={() => travelHistory(-1)}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className="toolbar-button handwriting-redo"
            aria-label="Redo drawing"
            title="Redo"
            disabled={readOnly || historyStep >= historyLength - 1}
            onClick={() => travelHistory(1)}
          >
            <Redo2 size={18} />
          </button>
          <span className="toolbar-divider" />
          <button
            type="button"
            className="toolbar-button"
            aria-label="Download sketch as PNG"
            title="Download handwriting as PNG"
            disabled={invalid || !document.strokes.length}
            onClick={exportPNG}
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-label="Clear sketch"
            title="Clear handwriting"
            disabled={readOnly || (!document.strokes.length && !invalid)}
            onClick={() => {
              finish();
              setConfirmClear(true);
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
        <div className="handwriting-settings">
          <label>
            Paper
            <select
              className="handwriting-paper-select"
              aria-label="Paper style"
              value={document.paper}
              disabled={readOnly || invalid}
              onChange={(event) =>
                changePaper(event.target.value as PaperStyle)
              }
            >
              <option value="plain">Plain</option>
              <option value="ruled">Ruled</option>
              <option value="grid">Grid</option>
              <option value="dots">Dots</option>
            </select>
          </label>
          <label>
            Input
            <select
              className="handwriting-input-select"
              aria-label="Input mode"
              value={inputMode}
              disabled={readOnly}
              onChange={(event) => {
                finish();
                setInputMode(event.target.value as InputMode);
              }}
            >
              <option value="stylus">Stylus + mouse</option>
              <option value="finger">Finger drawing</option>
            </select>
          </label>
          <span className="handwriting-mode-hint">
            <ShieldCheck size={14} />
            {inputMode === "stylus"
              ? "Touch scrolls · stylus writes"
              : "Finger drawing enabled"}
          </span>
        </div>
      </div>
      {confirmClear && (
        <div
          className="sketch-confirm"
          role="alertdialog"
          aria-label="Clear sketch"
          aria-describedby={`${id}-clear`}
        >
          <span id={`${id}-clear`}>
            Clear the handwriting? You can undo this action.
          </span>
          <button
            type="button"
            className="editor-small-button editor-danger-button"
            onClick={() => {
              commit({ ...documentRef.current, strokes: [] });
              setConfirmClear(false);
            }}
          >
            Clear sketch
          </button>
          <button
            type="button"
            className="editor-small-button"
            autoFocus
            onClick={() => setConfirmClear(false)}
          >
            Keep writing
          </button>
        </div>
      )}
      {invalid && (
        <div className="sketch-data-error" role="alert">
          This handwriting format could not be opened. Your original data is
          preserved. Clear the page to start again.
        </div>
      )}
      {exportError && (
        <div className="sketch-data-error" role="alert">
          {exportError}
          <button
            type="button"
            className="toolbar-button"
            aria-label="Dismiss export error"
            onClick={() => setExportError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div
        className={`sketch-surface handwriting-paper${tool === "eraser" ? " is-erasing" : ""}${tool === "highlighter" ? " is-highlighting" : ""}${inputMode === "finger" ? " is-finger-drawing" : ""}`}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${document.width} ${document.height}`}
          width={document.width}
          height={document.height}
          className={`sketch-canvas${inputMode === "finger" ? " is-finger-drawing" : ""}`}
          style={{
            touchAction:
              !readOnly && inputMode === "finger" ? "none" : NATIVE_TOUCH,
          }}
          role="img"
          aria-label={`Handwriting canvas. ${document.strokes.length} strokes. ${readOnly ? "Read only." : inputMode === "stylus" ? "Write with your stylus or mouse. Touch scrolls the page." : "Write with your stylus, mouse, or finger."}`}
          tabIndex={0}
          onPointerEnter={(event) => {
            if (event.pointerType === "pen") {
              penHoverRef.current = true;
              if (!readOnly) event.currentTarget.style.touchAction = "none";
            }
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "pen") {
              penHoverRef.current = false;
              if (!activeRef.current) restoreTouchAction();
            }
          }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={(event) => finish(event.pointerId)}
          onPointerCancel={(event) => finish(event.pointerId)}
          onLostPointerCapture={(event) => finish(event.pointerId)}
          onContextMenu={(event) => {
            if (activeRef.current?.pointerType === "pen")
              event.preventDefault();
          }}
          onKeyDown={keyboard}
        >
          <defs>
            <pattern
              id={patternId}
              width={document.paper === "ruled" ? document.width : 32}
              height={document.paper === "ruled" ? 42 : 32}
              patternUnits="userSpaceOnUse"
            >
              {document.paper === "ruled" && (
                <line
                  x1="0"
                  y1="41.5"
                  x2={document.width}
                  y2="41.5"
                  stroke="#e7e8de"
                  strokeWidth="1"
                />
              )}
              {document.paper === "grid" && (
                <>
                  <line
                    x1="0"
                    y1="31.5"
                    x2="32"
                    y2="31.5"
                    stroke="#e7e8de"
                    strokeWidth="1"
                  />
                  <line
                    x1="31.5"
                    y1="0"
                    x2="31.5"
                    y2="32"
                    stroke="#e7e8de"
                    strokeWidth="1"
                  />
                </>
              )}
              {document.paper === "dots" && (
                <circle cx="16" cy="16" r="1.2" fill="#d2dbd0" />
              )}
            </pattern>
          </defs>
          <rect
            width={document.width}
            height={document.height}
            fill="#fffdf7"
          />
          {document.paper !== "plain" && (
            <rect
              width={document.width}
              height={document.height}
              fill={`url(#${patternId})`}
            />
          )}
          {document.paper === "ruled" && (
            <line
              x1="86"
              y1="0"
              x2="86"
              y2={document.height}
              stroke="#e9d5ce"
              strokeWidth="1.2"
            />
          )}
          {document.strokes.map((stroke) => (
            <InkPath key={stroke.id} stroke={stroke} />
          ))}
          {currentStroke && <InkPath stroke={currentStroke} complete={false} />}
        </svg>
        {!document.strokes.length && !currentStroke && !invalid && (
          <div className="sketch-empty handwriting-empty" aria-hidden="true">
            <PenLine size={27} />
            <span>Your next thought starts here.</span>
            <small>
              {readOnly
                ? "This page is empty."
                : "Put pen to paper. Your handwriting saves automatically."}
            </small>
          </div>
        )}
      </div>
      {!readOnly && (
        <button
          type="button"
          className="handwriting-add-space"
          aria-label="Add more writing space"
          disabled={invalid || document.height >= MAX_PAGE_HEIGHT}
          onClick={extendPaper}
        >
          <Plus size={16} />
          <span>
            {document.height >= MAX_PAGE_HEIGHT
              ? "Page is at its maximum length"
              : "Add more writing space"}
          </span>
        </button>
      )}
      <div className="sketch-caption">
        <span>
          {readOnly
            ? "Handwriting preview"
            : tool === "eraser"
              ? "Tap or drag to erase a whole stroke"
              : inputMode === "stylus"
                ? "Stylus pressure supported · touch to scroll"
                : "Finger drawing on · switch input to scroll"}
        </span>
        <span>
          {document.strokes.length}{" "}
          {document.strokes.length === 1 ? "stroke" : "strokes"}
        </span>
      </div>
    </div>
  );
}
