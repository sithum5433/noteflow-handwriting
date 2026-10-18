import type { jsPDF } from "jspdf";
import { parseInk, strokePath, type InkDocument } from "./ink";
import type { Note } from "./workspace";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;
const FOOTER_HEIGHT = 32;
const SVG_NS = "http://www.w3.org/2000/svg";
const INK_ERROR =
  "This note contains unreadable handwriting. Open or repair its handwriting before exporting a PDF.";
const SYSTEM_FONT =
  'Arial, "Noto Sans", "Noto Sans Sinhala", "Noto Sans Arabic", "Noto Sans CJK SC", "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
type LinkRange = { start: number; end: number; href: string };
type PdfBlock = {
  text: string;
  kind: "paragraph" | "heading" | "list" | "quote" | "code" | "rule";
  level?: number;
  depth?: number;
  marker?: string;
  checked?: boolean;
  links: LinkRange[];
};
type TextLine = { text: string; start: number; end: number };
type FontStyle = "normal" | "bold" | "italic";

export type InkPdfSlice = {
  sourceY: number;
  sourceHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

/** Source intervals are contiguous; strokes crossing a break appear on both clipped pages. */
export function planInkPdfPages(
  width: number,
  height: number,
  top = 110,
): InkPdfSlice[] {
  if (
    ![width, height, top].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    top < MARGIN ||
    top >= A4_HEIGHT - FOOTER_HEIGHT - 60
  )
    throw new Error("The page dimensions cannot be exported to PDF.");
  const availableWidth = A4_WIDTH - MARGIN * 2;
  const availableHeight = A4_HEIGHT - FOOTER_HEIGHT - top;
  const normalSheetHeight = Math.min(height, width * 1.414);
  const scale = Math.min(
    availableWidth / width,
    availableHeight / normalSheetHeight,
  );
  const sourcePerPage = availableHeight / scale;
  const count = Math.max(1, Math.ceil((height - 0.000001) / sourcePerPage));
  if (count > 500)
    throw new Error(
      "This handwriting page is too long or narrow to export safely. Split it into shorter notes first.",
    );
  return Array.from({ length: count }, (_, index) => {
    const sourceY = index * sourcePerPage;
    const sourceHeight = Math.min(sourcePerPage, height - sourceY);
    return {
      sourceY,
      sourceHeight,
      x: (A4_WIDTH - width * scale) / 2,
      y: top,
      width: width * scale,
      height: sourceHeight * scale,
      scale,
    };
  });
}

export function pdfFilename(title: string): string {
  let base = Array.from(
    title
      .trim()
      .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/g, ""),
  )
    .slice(0, 100)
    .join("");
  if (!base) base = "Untitled note";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base))
    base = `Note-${base}`;
  return `${base}.pdf`;
}

function assertCompleteInk(data: string) {
  if (!data) return;
  try {
    const root: unknown = JSON.parse(data);
    const object =
      root && typeof root === "object" && !Array.isArray(root)
        ? (root as Record<string, unknown>)
        : null;
    const strokes = Array.isArray(root)
      ? root
      : (object?.strokes ?? object?.lines ?? object?.paths);
    if (!Array.isArray(strokes) || strokes.length > 10000)
      throw new Error(INK_ERROR);
    let pointCount = 0;
    for (const value of strokes) {
      if (!value || typeof value !== "object") throw new Error(INK_ERROR);
      const stroke = value as Record<string, unknown>;
      const points = stroke.points ?? stroke.paths;
      if (!Array.isArray(points) || points.length > 20000)
        throw new Error(INK_ERROR);
      pointCount += points.length;
      if (pointCount > 200000)
        throw new Error(
          "This note has too many handwriting points to export safely without losing content.",
        );
      for (const value of points) {
        if (!value || typeof value !== "object") throw new Error(INK_ERROR);
        const point = value as Record<string, unknown>;
        if (
          typeof point.x !== "number" ||
          typeof point.y !== "number" ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          (point.pressure !== undefined &&
            (typeof point.pressure !== "number" ||
              !Number.isFinite(point.pressure)))
        )
          throw new Error(INK_ERROR);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("too many"))
      throw error;
    throw new Error(INK_ERROR);
  }
}

function element<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, String(value));
  return node;
}

function inkSliceSvg(
  ink: InkDocument,
  slice: InkPdfSlice,
  pageIndex: number,
): SVGSVGElement {
  const svg = element("svg", {
    xmlns: SVG_NS,
    width: ink.width,
    height: slice.sourceHeight,
    viewBox: `0 ${slice.sourceY} ${ink.width} ${slice.sourceHeight}`,
    overflow: "hidden",
  });
  const clipId = `pdf-ink-clip-${pageIndex}`;
  const definitions = element("defs");
  const clip = element("clipPath", {
    id: clipId,
    clipPathUnits: "userSpaceOnUse",
  });
  clip.append(
    element("rect", {
      x: 0,
      y: slice.sourceY,
      width: ink.width,
      height: slice.sourceHeight,
    }),
  );
  definitions.append(clip);
  svg.append(definitions);
  const group = element("g", { "clip-path": `url(#${clipId})` });
  group.append(
    element("rect", {
      x: 0,
      y: slice.sourceY,
      width: ink.width,
      height: slice.sourceHeight,
      fill: "#fffdf7",
    }),
  );
  const bottom = slice.sourceY + slice.sourceHeight;
  if (ink.paper === "ruled" || ink.paper === "grid") {
    const step = ink.paper === "ruled" ? 42 : 32;
    for (
      let y = Math.floor(slice.sourceY / step) * step + step - 0.5;
      y <= bottom;
      y += step
    ) {
      group.append(
        element("line", {
          x1: 0,
          y1: y,
          x2: ink.width,
          y2: y,
          stroke: "#e7e8de",
          "stroke-width": 1,
        }),
      );
    }
    if (ink.paper === "grid")
      for (let x = 31.5; x < ink.width; x += 32)
        group.append(
          element("line", {
            x1: x,
            y1: slice.sourceY,
            x2: x,
            y2: bottom,
            stroke: "#e7e8de",
            "stroke-width": 1,
          }),
        );
    if (ink.paper === "ruled")
      group.append(
        element("line", {
          x1: 86,
          y1: slice.sourceY,
          x2: 86,
          y2: bottom,
          stroke: "#e9d5ce",
          "stroke-width": 1.2,
        }),
      );
  } else if (ink.paper === "dots") {
    for (let y = Math.floor(slice.sourceY / 32) * 32 + 16; y <= bottom; y += 32)
      for (let x = 16; x < ink.width; x += 32)
        group.append(
          element("circle", { cx: x, cy: y, r: 1.2, fill: "#d2dbd0" }),
        );
  }
  for (const stroke of ink.strokes) {
    const minY =
      Math.min(...stroke.points.map((point) => point.y)) - stroke.size;
    const maxY =
      Math.max(...stroke.points.map((point) => point.y)) + stroke.size;
    if (maxY < slice.sourceY || minY > bottom) continue;
    const constant = stroke.style === "constant";
    group.append(
      element("path", {
        d: strokePath(stroke),
        fill: constant ? "none" : stroke.color,
        stroke: constant ? stroke.color : "none",
        "stroke-width": constant ? stroke.size : 0,
        opacity: stroke.opacity,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
  }
  svg.append(group);
  return svg;
}

function safeHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function inlineText(root: Element): { text: string; links: LinkRange[] } {
  let text = "";
  const links: LinkRange[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent || "").replace(/\s+/g, " ");
      return;
    }
    if (
      !(node instanceof Element) ||
      ["SCRIPT", "STYLE", "TEMPLATE", "UL", "OL", "INPUT"].includes(
        node.tagName,
      )
    )
      return;
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    if (
      node.tagName === "LABEL" &&
      node.querySelector('input[type="checkbox"]')
    )
      return;
    if (["P", "DIV"].includes(node.tagName) && text && !text.endsWith("\n"))
      text += "\n";
    const start = text.length;
    node.childNodes.forEach(visit);
    const href =
      node.tagName === "A" ? safeHref(node.getAttribute("href")) : null;
    if (href && text.length > start)
      links.push({ start, end: text.length, href });
    if (node.tagName === "IMG" && node.getAttribute("alt"))
      text += `[${node.getAttribute("alt")}]`;
  };
  root.childNodes.forEach(visit);
  const leading = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return {
    text: trimmed,
    links: links
      .map((link) => ({
        ...link,
        start: Math.max(0, link.start - leading),
        end: Math.min(trimmed.length, link.end - leading),
      }))
      .filter((link) => link.end > link.start),
  };
}

/** Only text and safe links are read from inert HTML; no images, fonts, or scripts load. */
export function pdfTextBlocks(html: string): PdfBlock[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const blocks: PdfBlock[] = [];
  const list = (container: Element, depth: number) => {
    let number = 1;
    for (const child of Array.from(container.children)) {
      if (child.tagName !== "LI") continue;
      const task =
        child.getAttribute("data-type") === "taskItem" ||
        container.getAttribute("data-type") === "taskList";
      blocks.push({
        ...inlineText(child),
        kind: "list",
        depth,
        marker: task
          ? "task"
          : container.tagName === "OL"
            ? `${number++}.`
            : "bullet",
        checked:
          child.getAttribute("data-checked") === "true" ||
          Boolean(child.querySelector("input[checked]")),
      });
      const nested = (parent: Element) => {
        for (const node of Array.from(parent.children)) {
          if (["UL", "OL"].includes(node.tagName)) list(node, depth + 1);
          else if (node.tagName !== "LI") nested(node);
        }
      };
      nested(child);
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) blocks.push({ text, kind: "paragraph", links: [] });
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (["SCRIPT", "STYLE", "TEMPLATE"].includes(tag)) return;
    if (["UL", "OL"].includes(tag)) {
      list(node, 0);
      return;
    }
    if (tag === "HR") {
      blocks.push({ text: "", kind: "rule", links: [] });
      return;
    }
    if (tag === "PRE") {
      blocks.push({
        text: (node.textContent || "").replace(/\r\n?/g, "\n"),
        kind: "code",
        links: [],
      });
      return;
    }
    if (tag === "BLOCKQUOTE") {
      for (const child of Array.from(node.childNodes)) {
        if (child instanceof Element && ["UL", "OL"].includes(child.tagName))
          list(child, 1);
        else if (child instanceof Element)
          blocks.push({ ...inlineText(child), kind: "quote" });
        else if (child.textContent?.trim())
          blocks.push({
            text: child.textContent.trim(),
            kind: "quote",
            links: [],
          });
      }
      return;
    }
    if (["P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(tag)) {
      const kind = tag.startsWith("H") ? "heading" : "paragraph";
      blocks.push({
        ...inlineText(node),
        kind,
        level: kind === "heading" ? Number(tag[1]) : undefined,
      });
      return;
    }
    if (["DIV", "SECTION", "ARTICLE", "MAIN"].includes(tag)) {
      node.childNodes.forEach(walk);
      return;
    }
    const content = inlineText(node);
    if (content.text) blocks.push({ ...content, kind: "paragraph" });
  };
  template.content.childNodes.forEach(walk);
  return blocks;
}

/** Wrap by grapheme when a word is longer than the line; never split a surrogate pair or emoji cluster. */
export function wrapPdfText(
  text: string,
  maximumWidth: number,
  measure: (text: string) => number,
): TextLine[] {
  if (!(maximumWidth > 0))
    throw new Error("The PDF text column is too narrow.");
  const lines: TextLine[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let start = 0;
  for (const paragraph of text.split("\n")) {
    const segments = Array.from(segmenter.segment(paragraph));
    if (!segments.length) {
      lines.push({ text: "", start, end: start });
      start++;
      continue;
    }
    let cursor = 0;
    while (cursor < segments.length) {
      const begin = cursor;
      let lastSpace = -1;
      while (cursor < segments.length) {
        const candidate = paragraph.slice(
          segments[begin].index,
          segments[cursor].index + segments[cursor].segment.length,
        );
        if (measure(candidate) > maximumWidth && cursor > begin) break;
        if (/\s/.test(segments[cursor].segment)) lastSpace = cursor;
        cursor++;
      }
      if (cursor < segments.length && lastSpace > begin) cursor = lastSpace + 1;
      if (cursor === begin) cursor++;
      const from = segments[begin].index;
      const to =
        cursor < segments.length ? segments[cursor].index : paragraph.length;
      lines.push({
        text: paragraph.slice(from, to).trimEnd(),
        start: start + from,
        end: start + to,
      });
      while (cursor < segments.length && /^\s+$/.test(segments[cursor].segment))
        cursor++;
    }
    start += paragraph.length + 1;
  }
  return lines;
}

function textRenderer(pdf: jsPDF) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot render PDF text.");
  const ascii = (text: string) => /^[\x20-\x7e]*$/.test(text);
  const configure = (size: number, style: FontStyle, mono = false) => {
    pdf.setFont(mono ? "courier" : "helvetica", style);
    pdf.setFontSize(size);
    context.font = `${style === "italic" ? "italic" : "normal"} ${style === "bold" ? 700 : 400} ${size}px ${mono ? "monospace" : SYSTEM_FONT}`;
  };
  return {
    measure(
      text: string,
      size: number,
      style: FontStyle = "normal",
      mono = false,
    ) {
      configure(size, style, mono);
      return ascii(text)
        ? pdf.getTextWidth(text)
        : context.measureText(text).width;
    },
    draw(
      text: string,
      x: number,
      top: number,
      size: number,
      style: FontStyle = "normal",
      color = "#27392f",
      mono = false,
    ) {
      configure(size, style, mono);
      if (!text) return;
      if (ascii(text)) {
        pdf.setTextColor(color);
        pdf.text(text, x, top + size);
        return;
      }
      // Canvas keeps local browser shaping and emoji. Standard PDF fonts cannot
      // encode these characters; only this text line becomes a high-DPI image.
      const metrics = context.measureText(text);
      const ascent = Math.max(size, metrics.actualBoundingBoxAscent || 0);
      const descent = Math.max(
        size * 0.3,
        metrics.actualBoundingBoxDescent || 0,
      );
      const scale = 3,
        padding = 2;
      canvas.width = Math.max(
        1,
        Math.ceil((metrics.width + padding * 2) * scale),
      );
      canvas.height = Math.max(
        1,
        Math.ceil((ascent + descent + padding * 2) * scale),
      );
      context.scale(scale, scale);
      configure(size, style, mono);
      context.fillStyle = color;
      context.direction = /[\u0590-\u08ff]/.test(text) ? "rtl" : "ltr";
      context.textAlign = "left";
      context.fillText(text, padding, ascent + padding);
      pdf.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        x - padding,
        top + size - ascent - padding,
        canvas.width / scale,
        canvas.height / scale,
      );
    },
  };
}

export async function exportNotePdf(note: Note): Promise<void> {
  assertCompleteInk(note.sketchData);
  const parsed = parseInk(note.sketchData);
  if (parsed.invalid) throw new Error(INK_ERROR);
  const blocks = pdfTextBlocks(note.textContent);
  const hasText = blocks.some(
    (block) => block.text.trim() || block.kind === "rule",
  );
  const hasInk = Boolean(note.sketchData);
  const { jsPDF: PdfDocument } = await import("jspdf");
  await import("svg2pdf.js");
  const pdf = new PdfDocument({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  pdf.setProperties({
    title: note.title || "Untitled note",
    subject: note.notebook,
    author: "NoteFlow",
    creator: "NoteFlow",
  });
  const renderer = textRenderer(pdf);
  const title = note.title.trim() || "Untitled note";
  const titleLines = wrapPdfText(title, A4_WIDTH - MARGIN * 2, (value) =>
    renderer.measure(value, 18, "bold"),
  );
  const date = new Date(note.updatedAt);
  const dateText = Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
  const metadata = [note.notebook, dateText ? `Updated ${dateText}` : ""]
    .filter(Boolean)
    .join("  |  ");
  const metadataLines = wrapPdfText(metadata, A4_WIDTH - MARGIN * 2, (value) =>
    renderer.measure(value, 9),
  );
  const contentTop =
    MARGIN + titleLines.length * 23 + metadataLines.length * 14 + 23;
  if (contentTop > A4_HEIGHT - 160)
    throw new Error(
      "This note title or notebook name is too long for the PDF heading. Shorten it before exporting.",
    );
  const header = (section: string) => {
    let y = MARGIN;
    for (const line of titleLines) {
      renderer.draw(line.text, MARGIN, y, 18, "bold");
      y += 23;
    }
    for (const line of metadataLines) {
      renderer.draw(line.text, MARGIN, y, 9, "normal", "#778173");
      y += 14;
    }
    renderer.draw(section, MARGIN, y + 8, 8, "bold", "#53715a");
  };
  let renderedPages = 0;
  const startPage = (section: string) => {
    if (renderedPages++) pdf.addPage();
    header(section);
  };

  if (hasInk || !hasText) {
    const pages = planInkPdfPages(
      parsed.document.width,
      parsed.document.height,
      contentTop,
    );
    for (const [index, slice] of pages.entries()) {
      startPage("HANDWRITING");
      const svg = inkSliceSvg(parsed.document, slice, index);
      await pdf.svg(svg, {
        x: slice.x,
        y: slice.y,
        width: slice.width,
        height: slice.height,
      });
    }
  }

  if (hasText) {
    startPage("TYPED NOTES");
    const bottom = A4_HEIGHT - FOOTER_HEIGHT;
    let y = contentTop;
    const ensureSpace = (height: number) => {
      if (y + height > bottom) {
        startPage("TYPED NOTES");
        y = contentTop;
      }
    };
    for (const block of blocks) {
      if (block.kind === "rule") {
        ensureSpace(16);
        pdf.setDrawColor("#dfe5db");
        pdf.setLineWidth(0.6);
        pdf.line(MARGIN, y + 5, A4_WIDTH - MARGIN, y + 5);
        y += 16;
        continue;
      }
      const size =
        block.kind === "heading"
          ? block.level === 1
            ? 17
            : block.level === 2
              ? 15
              : 13
          : block.kind === "code"
            ? 10
            : 11;
      const style: FontStyle =
        block.kind === "heading"
          ? "bold"
          : block.kind === "quote"
            ? "italic"
            : "normal";
      const lineHeight = size * 1.55;
      const indent =
        block.kind === "list"
          ? 18 + (block.depth || 0) * 16
          : block.kind === "quote"
            ? 14
            : block.kind === "code"
              ? 8
              : 0;
      const x = MARGIN + indent;
      const width =
        A4_WIDTH - MARGIN * 2 - indent - (block.kind === "code" ? 8 : 0);
      const lines = wrapPdfText(block.text, width, (value) =>
        renderer.measure(value, size, style, block.kind === "code"),
      );
      if (block.kind === "heading") {
        ensureSpace(lineHeight * 2 + 8);
        y += 8;
      }
      for (const [index, line] of lines.entries()) {
        ensureSpace(lineHeight);
        if (block.kind === "code") {
          pdf.setFillColor("#f1f3ee");
          pdf.rect(MARGIN, y - 1, A4_WIDTH - MARGIN * 2, lineHeight + 1, "F");
        }
        if (block.kind === "quote") {
          pdf.setDrawColor("#a7b79c");
          pdf.setLineWidth(2);
          pdf.line(MARGIN + 2, y, MARGIN + 2, y + lineHeight);
        }
        if (block.kind === "list" && index === 0) {
          pdf.setDrawColor("#6b8064");
          pdf.setFillColor("#6b8064");
          pdf.setLineWidth(0.7);
          if (block.marker === "bullet")
            pdf.circle(x - 10, y + size * 0.7, 1.7, "F");
          else if (block.marker === "task") {
            pdf.rect(x - 15, y + 3, 9, 9);
            if (block.checked) {
              pdf.line(x - 13, y + 7, x - 11, y + 10);
              pdf.line(x - 11, y + 10, x - 7, y + 5);
            }
          } else
            renderer.draw(
              block.marker || "",
              x - 18,
              y,
              size,
              "normal",
              "#6b8064",
            );
        }
        renderer.draw(
          line.text,
          x,
          y,
          size,
          style,
          "#27392f",
          block.kind === "code",
        );
        for (const link of block.links) {
          const from = Math.max(link.start, line.start),
            to = Math.min(link.end, line.end);
          if (to <= from) continue;
          const prefix = block.text.slice(line.start, from),
            content = block.text.slice(from, to);
          const linkX = x + renderer.measure(prefix, size, style);
          const linkWidth = renderer.measure(content, size, style);
          if (linkWidth > 0) {
            pdf.link(linkX, y, linkWidth, lineHeight, { url: link.href });
            pdf.setDrawColor("#537c5e");
            pdf.setLineWidth(0.3);
            pdf.line(linkX, y + size + 1.5, linkX + linkWidth, y + size + 1.5);
          }
        }
        y += lineHeight;
      }
      y += block.kind === "list" ? 4 : 8;
    }
  }

  const total = pdf.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor("#7f8979");
    pdf.text("NoteFlow", MARGIN, A4_HEIGHT - 17);
    pdf.text(`Page ${page} of ${total}`, A4_WIDTH - MARGIN, A4_HEIGHT - 17, {
      align: "right",
    });
  }
  await pdf.save(pdfFilename(title), { returnPromise: true });
}
