import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Download,
  Eraser,
  Hand,
  Highlighter,
  Maximize2,
  Minus,
  PenLine,
  Plus,
  Redo2,
  ShieldCheck,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  clampInk,
  MAX_PAGE_HEIGHT,
  PAGE_EXTENSION,
  parseInk,
  serializeInk,
  strokePath,
  type InkDocument,
  type InkPoint,
  type InkStroke,
  type PaperStyle,
} from "../lib/ink";
import { eraseInkStrokes } from "../lib/inkErase";
import {
  clampZoom,
  DEFAULT_INK_PREFERENCES,
  INK_PREFERENCES_KEY,
  readInkPreferences,
  zoomAnchorScroll,
  type InkInputMode,
  type InkTool,
} from "../lib/inkView";
import "./editors.css";

export interface SketchEditorProps {
  data: string;
  onChange: (data: string) => void;
  readOnly?: boolean;
}
type ActiveGesture = {
  pointerId: number;
  pointerType: string;
  erasing: boolean;
  before: InkDocument;
  previous: InkPoint;
  stroke: InkStroke | null;
};
type PanGesture = {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
};
type ZoomAnchor = {
  sourceX: number;
  sourceY: number;
  clientX: number;
  clientY: number;
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
  const [preferences] = useState(() => {
    try {
      return readInkPreferences();
    } catch {
      return { ...DEFAULT_INK_PREFERENCES };
    }
  });
  const [document, setDocument] = useState(initial.document);
  const [invalid, setInvalid] = useState(initial.invalid);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [tool, setTool] = useState<InkTool>(preferences.tool);
  const [inputMode, setInputMode] = useState<InkInputMode>(
    preferences.inputMode,
  );
  const [penColor, setPenColor] = useState(preferences.penColor);
  const [highlightColor, setHighlightColor] = useState(
    preferences.highlighterColor,
  );
  const [penSize, setPenSize] = useState(preferences.penSize);
  const [highlightSize, setHighlightSize] = useState(
    preferences.highlighterSize,
  );
  const [eraserSize, setEraserSize] = useState(preferences.eraserSize);
  const [eraserMode, setEraserMode] = useState(preferences.eraserMode);
  const [pressure, setPressure] = useState(preferences.pressure);
  const [historyStep, setHistoryStep] = useState(0);
  const [historyLength, setHistoryLength] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportError, setExportError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const [cursor, setCursor] = useState<InkPoint | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef(document);
  const historyRef = useRef<InkDocument[]>([initial.document]);
  const stepRef = useRef(0);
  const activeRef = useRef<ActiveGesture | null>(null);
  const panRef = useRef<PanGesture | null>(null);
  const penHoverRef = useRef(false);
  const spacePanRef = useRef(false);
  const zoomRef = useRef(1);
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const measuredRef = useRef(false);
  const lastDataRef = useRef(data);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const id = useId().replace(/:/g, "");
  const isHand = tool === "hand" || spacePan;
  const cursorIsEraser =
    tool === "eraser" || Boolean(activeRef.current?.erasing);
  const size =
    tool === "eraser"
      ? eraserSize
      : tool === "highlighter"
        ? highlightSize
        : penSize;
  const minimumSize = tool === "eraser" || tool === "highlighter" ? 4 : 0.5;
  const maximumSize =
    tool === "eraser" ? 160 : tool === "highlighter" ? 80 : 24;
  const sizeStep = tool === "eraser" || tool === "highlighter" ? 2 : 0.5;
  const sizeLabel =
    tool === "eraser"
      ? "Eraser size"
      : tool === "highlighter"
        ? "Highlighter size"
        : "Pen size";
  const color = tool === "highlighter" ? highlightColor : penColor;
  const setColor = (next: string) =>
    tool === "highlighter" ? setHighlightColor(next) : setPenColor(next);
  const changeSize = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next =
      Math.round(clampInk(value, minimumSize, maximumSize) * 10) / 10;
    if (tool === "eraser") setEraserSize(next);
    else if (tool === "highlighter") setHighlightSize(next);
    else setPenSize(next);
  };
  const showDocument = (next: InkDocument) => {
    documentRef.current = next;
    setDocument(next);
  };
  const restoreTouchAction = () => {
    if (svgRef.current)
      svgRef.current.style.touchAction =
        tool === "hand" || spacePanRef.current
          ? "pan-x pan-y pinch-zoom"
          : !readOnly && (inputMode === "finger" || penHoverRef.current)
            ? "none"
            : NATIVE_TOUCH;
  };
  const releasePointer = (pointerId: number) => {
    try {
      if (svgRef.current?.hasPointerCapture(pointerId))
        svgRef.current.releasePointerCapture(pointerId);
    } catch {
      /* A cancelled pointer can already have lost capture. */
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
    const pan = panRef.current;
    if (pan && (pointerId === undefined || pan.pointerId === pointerId)) {
      panRef.current = null;
      setPanning(false);
      releasePointer(pan.pointerId);
    }
    const active = activeRef.current;
    if (!active || (pointerId !== undefined && pointerId !== active.pointerId))
      return;
    activeRef.current = null;
    setCurrentStroke(null);
    if (active.stroke)
      commit({
        ...documentRef.current,
        strokes: [...documentRef.current.strokes, active.stroke],
      });
    else if (active.before.strokes !== documentRef.current.strokes)
      commit(documentRef.current);
    releasePointer(active.pointerId);
    restoreTouchAction();
  };
  const cancel = () => {
    const active = activeRef.current;
    if (active) {
      activeRef.current = null;
      setCurrentStroke(null);
      showDocument(active.before);
      releasePointer(active.pointerId);
    }
    if (panRef.current) {
      const pan = panRef.current;
      panRef.current = null;
      setPanning(false);
      releasePointer(pan.pointerId);
    }
    restoreTouchAction();
  };

  useEffect(() => {
    if (data === lastDataRef.current) return;
    lastDataRef.current = data;
    const next = parseInk(data);
    cancel();
    setCursor(null);
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
  }, [readOnly, inputMode, tool, spacePan]);
  useEffect(() => {
    try {
      localStorage.setItem("noteflow.ink.inputMode", inputMode);
      localStorage.setItem(
        INK_PREFERENCES_KEY,
        JSON.stringify({
          tool,
          inputMode,
          penColor,
          highlighterColor: highlightColor,
          penSize,
          highlighterSize: highlightSize,
          eraserSize,
          eraserMode,
          pressure,
        }),
      );
    } catch {
      /* Tool controls still work when browser storage is unavailable. */
    }
  }, [
    tool,
    inputMode,
    penColor,
    highlightColor,
    penSize,
    highlightSize,
    eraserSize,
    eraserMode,
    pressure,
  ]);

  const captureAnchor = (
    clientX?: number,
    clientY?: number,
  ): ZoomAnchor | null => {
    const viewport = viewportRef.current,
      stage = stageRef.current;
    if (!viewport || !stage) return null;
    const area = viewport.getBoundingClientRect(),
      page = stage.getBoundingClientRect();
    if (!page.width || !page.height) return null;
    const x = clientX ?? area.left + viewport.clientWidth / 2,
      y = clientY ?? area.top + viewport.clientHeight / 2;
    return {
      clientX: x,
      clientY: y,
      sourceX: (x - page.left) / page.width,
      sourceY: (y - page.top) / page.height,
    };
  };
  const zoomTo = (value: number, clientX?: number, clientY?: number) => {
    const next = clampZoom(value);
    if (next === zoomRef.current) return;
    finish();
    anchorRef.current = captureAnchor(clientX, clientY);
    zoomRef.current = next;
    setZoom(next);
    setCursor(null);
  };
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useLayoutEffect(() => {
    const viewport = viewportRef.current,
      stage = stageRef.current,
      anchor = anchorRef.current;
    if (!viewport || !stage || !anchor) return;
    const page = stage.getBoundingClientRect();
    if (!page.width || !page.height) return;
    viewport.scrollLeft = zoomAnchorScroll(
      viewport.scrollLeft,
      page.left,
      page.width,
      anchor.sourceX,
      anchor.clientX,
    );
    viewport.scrollTop = zoomAnchorScroll(
      viewport.scrollTop,
      page.top,
      page.height,
      anchor.sourceY,
      anchor.clientY,
    );
    anchorRef.current = null;
  }, [zoom, fitWidth]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      const width = viewport.clientWidth - 32;
      if (width <= 0) return; // Hidden Text tab must not replace the last useful fit width.
      if (measuredRef.current) anchorRef.current = captureAnchor();
      measuredRef.current = true;
      setFitWidth(width);
    });
    observer.observe(viewport);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1);
      zoomToRef.current(
        zoomRef.current * Math.exp(-delta * 0.002),
        event.clientX,
        event.clientY,
      );
    };
    const preventSelection = (event: Event) => event.preventDefault();
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("selectstart", preventSelection);
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("selectstart", preventSelection);
    };
  }, []);
  useEffect(() => {
    const releaseSpace = (event?: globalThis.KeyboardEvent) => {
      if (event && event.code !== "Space") return;
      if (spacePanRef.current) {
        spacePanRef.current = false;
        setSpacePan(false);
      }
    };
    const blur = () => {
      releaseSpace();
      const pan = panRef.current;
      if (pan) {
        panRef.current = null;
        setPanning(false);
        releasePointer(pan.pointerId);
      }
      setCursor(null);
    };
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", blur);
    };
  }, []);

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
    showDocument(historyRef.current[nextStep]);
    notify(historyRef.current[nextStep]);
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
    const next = eraseInkStrokes(
      documentRef.current.strokes,
      active.previous,
      point,
      eraserSize / 2,
      eraserMode,
    );
    if (next !== documentRef.current.strokes)
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
    const pointerType = event.pointerType || "mouse";
    const hardwareEraser = isHardwareEraser(event);
    const hand =
      (tool === "hand" || spacePanRef.current || event.button === 1) &&
      !hardwareEraser;
    if (hand) {
      if (
        pointerType === "touch" ||
        event.button > 1 ||
        panRef.current ||
        activeRef.current
      )
        return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic events do not own browser pointer capture. */
      }
      panRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      setPanning(true);
      setCursor(null);
      return;
    }
    if (readOnly || invalid || panRef.current) return;
    if (
      pointerType === "touch" &&
      (inputMode !== "finger" || activeRef.current?.pointerType === "pen")
    )
      return;
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
      /* Synthetic events do not own browser pointer capture. */
    }
    const erasing = tool === "eraser" || hardwareEraser;
    const stroke: InkStroke | null = erasing
      ? null
      : {
          id:
            globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          tool: tool === "highlighter" ? "highlighter" : "pen",
          style: tool === "pen" && !pressure ? "constant" : "pressure",
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
    if (pointerType !== "touch") setCursor(point);
    if (erasing) eraseAt(point, active);
    else setCurrentStroke(stroke);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current,
      viewport = viewportRef.current;
    if (pan && event.pointerId === pan.pointerId && viewport) {
      event.preventDefault();
      viewport.scrollLeft = pan.left - (event.clientX - pan.x);
      viewport.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }
    if (
      event.pointerType !== "touch" &&
      tool !== "hand" &&
      !spacePanRef.current &&
      !readOnly
    )
      setCursor(coordinates(event, event.pointerType));
    const active = activeRef.current;
    if (readOnly || !active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const startedHardwareErase = !active.erasing && isHardwareEraser(event);
    if (startedHardwareErase) {
      active.stroke = null;
      active.erasing = true;
      setCurrentStroke(null);
      // The barrel button starts erasing here, rather than sweeping back over
      // the pen gesture. Earlier coalesced samples still belong to writing.
      const point = coordinates(event, active.pointerType);
      if (point) active.previous = point;
    }
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    const samples =
      !startedHardwareErase && coalesced?.length
        ? coalesced
        : [event.nativeEvent];
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
  const chooseTool = (next: InkTool) => {
    finish();
    setTool(next);
    setCursor(null);
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      ["z", "y"].includes(event.key.toLowerCase()) &&
      !readOnly
    ) {
      event.preventDefault();
      travelHistory(event.key.toLowerCase() === "y" || event.shiftKey ? 1 : -1);
      return;
    }
    if (
      event.key === "Escape" &&
      (activeRef.current || panRef.current || spacePanRef.current)
    ) {
      event.preventDefault();
      cancel();
      spacePanRef.current = false;
      setSpacePan(false);
      return;
    }
    if (
      event.code === "Space" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (!spacePanRef.current) {
        finish();
        spacePanRef.current = true;
        setSpacePan(true);
        setCursor(null);
      }
      return;
    }
    if (!readOnly && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const next = (
        { p: "pen", h: "highlighter", e: "eraser" } as Record<string, InkTool>
      )[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        chooseTool(next);
      }
    }
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

  const exportPNG = async () => {
    finish();
    setExportError("");
    let objectUrl = "";
    try {
      const svg = svgRef.current;
      if (!svg) return;
      const clone = svg.cloneNode(true) as SVGSVGElement,
        { width, height } = documentRef.current;
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
      clone.removeAttribute("style");
      clone.removeAttribute("class");
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
  const toolButton = (
    label: string,
    visible: string,
    value: InkTool,
    icon: React.ReactNode,
  ) => (
    <button
      type="button"
      className={`toolbar-button handwriting-tool${tool === value ? " is-active" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={tool === value}
      disabled={value !== "hand" && (readOnly || invalid)}
      onClick={() => chooseTool(value)}
    >
      {icon}
      <span>{visible}</span>
    </button>
  );
  return (
    <div
      className={`sketch-editor handwriting-editor${readOnly ? " is-readonly" : ""}`}
    >
      <div className="handwriting-controls">
        <div
          className="editor-toolbar sketch-toolbar handwriting-toolbar-row"
          role="toolbar"
          aria-label="Handwriting tools"
        >
          <div className="handwriting-tools">
            {toolButton("Pen", "Pen", "pen", <PenLine size={18} />)}
            {toolButton(
              "Highlighter",
              "Highlight",
              "highlighter",
              <Highlighter size={18} />,
            )}
            {toolButton(
              "Stroke eraser",
              "Erase",
              "eraser",
              <Eraser size={18} />,
            )}
            {toolButton("Hand tool", "Hand", "hand", <Hand size={18} />)}
            <button
              type="button"
              className="toolbar-button handwriting-tool handwriting-undo"
              aria-label="Undo drawing"
              title="Undo"
              disabled={readOnly || historyStep === 0}
              onClick={() => travelHistory(-1)}
            >
              <Undo2 size={18} />
              <span>Undo</span>
            </button>
            <button
              type="button"
              className="toolbar-button handwriting-tool handwriting-redo"
              aria-label="Redo drawing"
              title="Redo"
              disabled={readOnly || historyStep >= historyLength - 1}
              onClick={() => travelHistory(1)}
            >
              <Redo2 size={18} />
              <span>Redo</span>
            </button>
          </div>
          <div className="handwriting-page-actions">
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
        </div>
        <div className="handwriting-tool-settings">
          {tool === "hand" ? (
            <span className="handwriting-pan-hint">
              Drag to move the page. Hold Space for a temporary hand tool.
            </span>
          ) : (
            <>
              <div className="handwriting-width-controls">
                <label
                  className="handwriting-size-label"
                  htmlFor={`${id}-size-number`}
                >
                  {sizeLabel}
                  <input
                    id={`${id}-size-number`}
                    className="handwriting-size-number"
                    type="number"
                    aria-label={sizeLabel}
                    min={minimumSize}
                    max={maximumSize}
                    step={sizeStep}
                    value={size}
                    disabled={readOnly || invalid}
                    onChange={(event) => changeSize(event.target.valueAsNumber)}
                  />
                </label>
                <button
                  type="button"
                  className="toolbar-button"
                  aria-label={`Decrease ${sizeLabel.toLowerCase()}`}
                  disabled={readOnly || invalid || size <= minimumSize}
                  onClick={() => changeSize(size - sizeStep)}
                >
                  <Minus size={15} />
                </button>
                <input
                  className="sketch-size"
                  aria-label="Brush size"
                  type="range"
                  min={minimumSize}
                  max={maximumSize}
                  step={sizeStep}
                  value={size}
                  disabled={readOnly || invalid}
                  onChange={(event) => changeSize(Number(event.target.value))}
                />
                <button
                  type="button"
                  className="toolbar-button"
                  aria-label={`Increase ${sizeLabel.toLowerCase()}`}
                  disabled={readOnly || invalid || size >= maximumSize}
                  onClick={() => changeSize(size + sizeStep)}
                >
                  <Plus size={15} />
                </button>
              </div>
              {tool === "eraser" ? (
                <label className="handwriting-eraser-setting">
                  Erase
                  <select
                    className="handwriting-eraser-mode"
                    aria-label="Eraser mode"
                    value={eraserMode}
                    disabled={readOnly || invalid}
                    onChange={(event) => {
                      finish();
                      setEraserMode(event.target.value as "point" | "stroke");
                    }}
                  >
                    <option value="stroke">Stroke eraser</option>
                    <option value="point">Point eraser</option>
                  </select>
                </label>
              ) : (
                <details className="handwriting-color-picker">
                  <summary>
                    <span
                      className="handwriting-current-color"
                      style={{ "--swatch": color } as CSSProperties}
                    />
                    Ink
                  </summary>
                  <div className="handwriting-color-options">
                    <div
                      className="sketch-colors"
                      role="group"
                      aria-label="Ink colors"
                    >
                      {COLORS.map((inkColor, index) => (
                        <button
                          type="button"
                          key={inkColor}
                          className={`sketch-color${color === inkColor ? " is-selected" : ""}`}
                          style={{ "--swatch": inkColor } as CSSProperties}
                          aria-label={COLOR_NAMES[index]}
                          aria-pressed={color === inkColor}
                          title={COLOR_NAMES[index]}
                          disabled={readOnly || invalid}
                          onClick={() => {
                            finish();
                            setColor(inkColor);
                          }}
                        />
                      ))}
                      <label
                        className="sketch-custom-color"
                        title="Custom ink color"
                      >
                        <input
                          type="color"
                          aria-label="Custom pen color"
                          value={color}
                          disabled={readOnly || invalid}
                          onChange={(event) => {
                            finish();
                            setColor(event.target.value);
                          }}
                        />
                        <span aria-hidden="true">+</span>
                      </label>
                    </div>
                  </div>
                </details>
              )}
              {tool === "pen" && (
                <label className="handwriting-pressure-toggle">
                  <input
                    type="checkbox"
                    aria-label="Pressure sensitivity"
                    checked={pressure}
                    disabled={readOnly || invalid}
                    onChange={(event) => {
                      finish();
                      setPressure(event.target.checked);
                    }}
                  />
                  Pressure
                </label>
              )}
            </>
          )}
        </div>
        <div className="handwriting-settings handwriting-view-settings">
          <div
            className="handwriting-zoom-controls"
            role="group"
            aria-label="Page zoom"
          >
            <button
              type="button"
              className="toolbar-button"
              aria-label="Zoom out"
              disabled={zoom <= 0.5}
              onClick={() => zoomTo(zoom - 0.25)}
            >
              <ZoomOut size={17} />
            </button>
            <button
              type="button"
              className="handwriting-zoom-level"
              aria-label="Reset zoom"
              title="Reset zoom to 100%"
              onClick={() => zoomTo(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="toolbar-button"
              aria-label="Zoom in"
              disabled={zoom >= 3}
              onClick={() => zoomTo(zoom + 0.25)}
            >
              <ZoomIn size={17} />
            </button>
            <button
              type="button"
              className="toolbar-button handwriting-fit-width"
              aria-label="Fit page width"
              title="Fit page width"
              onClick={() => zoomTo(1)}
            >
              <Maximize2 size={16} />
              <span>Fit</span>
            </button>
          </div>
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
                setInputMode(event.target.value as InkInputMode);
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
        ref={viewportRef}
        className={`handwriting-viewport${isHand ? " is-pan-tool" : ""}${panning ? " is-panning" : ""}`}
        role="region"
        aria-label="Writing workspace"
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
      >
        <div
          ref={stageRef}
          className="handwriting-page-stage"
          style={{ width: (fitWidth || Math.min(document.width, 800)) * zoom }}
        >
          <div
            className={`sketch-surface handwriting-paper${tool === "eraser" ? " is-erasing" : ""}${tool === "highlighter" ? " is-highlighting" : ""}${inputMode === "finger" ? " is-finger-drawing" : ""}${isHand ? " is-pan-tool" : ""}`}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${document.width} ${document.height}`}
              width={document.width}
              height={document.height}
              className={`sketch-canvas${inputMode === "finger" ? " is-finger-drawing" : ""}${isHand ? " is-pan-tool" : ""}${cursor && !isHand && !readOnly ? " has-ink-cursor" : ""}`}
              style={{
                touchAction: isHand
                  ? "pan-x pan-y pinch-zoom"
                  : !readOnly && inputMode === "finger"
                    ? "none"
                    : NATIVE_TOUCH,
              }}
              role="img"
              aria-label={`Handwriting canvas. ${document.strokes.length} strokes. ${readOnly ? "Read only." : inputMode === "stylus" ? "Write with your stylus or mouse. Touch scrolls the page." : "Write with your stylus, mouse, or finger."}`}
              tabIndex={0}
              onPointerEnter={(event) => {
                if (event.pointerType === "pen") {
                  penHoverRef.current = true;
                  if (!readOnly && !isHand)
                    event.currentTarget.style.touchAction = "none";
                }
              }}
              onPointerLeave={(event) => {
                setCursor(null);
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
              onKeyDown={keyboard}
              onBlur={() => {
                if (spacePanRef.current) {
                  spacePanRef.current = false;
                  setSpacePan(false);
                }
              }}
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
              {currentStroke && (
                <InkPath stroke={currentStroke} complete={false} />
              )}
              {cursor && (!isHand || cursorIsEraser) && !readOnly && (
                <circle
                  data-export-ignore="true"
                  data-ink-cursor="true"
                  cx={cursor.x}
                  cy={cursor.y}
                  r={(cursorIsEraser ? eraserSize : size) / 2}
                  fill={cursorIsEraser ? "#ffffff90" : "none"}
                  stroke={cursorIsEraser ? "#8b6771" : color}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
            </svg>
            {!document.strokes.length && !currentStroke && !invalid && (
              <div
                className="sketch-empty handwriting-empty"
                aria-hidden="true"
              >
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
            {isHand
              ? "Drag to move · Ctrl/⌘ + wheel to zoom"
              : readOnly
                ? "Handwriting preview"
                : tool === "eraser"
                  ? eraserMode === "point"
                    ? "Erase only the part you touch"
                    : "Tap or drag to erase a whole stroke"
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
    </div>
  );
}
