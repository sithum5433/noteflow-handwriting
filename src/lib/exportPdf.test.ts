import { describe, expect, it } from "vitest";
import {
  pdfFilename,
  pdfTextBlocks,
  planInkPdfPages,
  wrapPdfText,
} from "./exportPdf";

describe("PDF document layout", () => {
  it("fits an ordinary portrait writing sheet on one PDF page", () => {
    const pages = planInkPdfPages(1000, 1414);
    expect(pages).toHaveLength(1);
    expect(pages[0].sourceY).toBe(0);
    expect(pages[0].sourceHeight).toBe(1414);
    expect(pages[0].width / pages[0].height).toBeCloseTo(1000 / 1414);
    expect(pages[0].x).toBeGreaterThanOrEqual(40);
  });

  it("covers long writing sheets exactly once with contiguous source slices", () => {
    const pages = planInkPdfPages(1000, 20000, 128);
    expect(pages.length).toBeGreaterThan(10);
    expect(
      pages.reduce((height, page) => height + page.sourceHeight, 0),
    ).toBeCloseTo(20000);
    for (let index = 1; index < pages.length; index++)
      expect(pages[index].sourceY).toBeCloseTo(
        pages[index - 1].sourceY + pages[index - 1].sourceHeight,
      );
    expect(pages.at(-1)!.sourceY + pages.at(-1)!.sourceHeight).toBeCloseTo(
      20000,
    );
    expect(new Set(pages.map((page) => page.scale)).size).toBe(1);
  });

  it("preserves legacy landscape proportions and rejects unusable dimensions", () => {
    const [page] = planInkPdfPages(800, 350);
    expect(page.width / page.height).toBeCloseTo(800 / 350);
    expect(() => planInkPdfPages(0, 100)).toThrow();
    expect(() => planInkPdfPages(100, Number.NaN)).toThrow();
    expect(() => planInkPdfPages(1, 20000)).toThrow(/too long or narrow/);
  });

  it("wraps long words and keeps Unicode grapheme clusters intact", () => {
    const measure = (text: string) =>
      Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          text,
        ),
      ).length;
    const lines = wrapPdfText("hello world\nabcdefgh\n👩🏽‍💻👩🏽‍💻👩🏽‍💻", 4, measure);
    expect(lines.map((line) => line.text)).toEqual([
      "hell",
      "o",
      "worl",
      "d",
      "abcd",
      "efgh",
      "👩🏽‍💻👩🏽‍💻👩🏽‍💻",
    ]);
    expect(lines.every((line) => !/[\ud800-\udbff]$/.test(line.text))).toBe(
      true,
    );
  });

  it("retains heading, list, checklist, code, paragraph, and safe-link content from rich text", () => {
    const blocks = pdfTextBlocks(
      '<h2>Topic</h2><p>A <a href="https://example.com">link</a> remains.</p><ul><li>First<ul><li>Nested</li></ul></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Finished</p></div></li></ul><pre><code>  const x = 1;\nnext</code></pre>',
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "Topic",
      "A link remains.",
      "First",
      "Nested",
      "Finished",
      "  const x = 1;\nnext",
    ]);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(blocks[1].links).toEqual([
      { start: 2, end: 6, href: "https://example.com/" },
    ]);
    expect(blocks[3]).toMatchObject({ depth: 1 });
    expect(blocks[4]).toMatchObject({ marker: "task", checked: true });
    expect(blocks[5].kind).toBe("code");
    expect(
      pdfTextBlocks(
        "<blockquote><p>A quote</p><ul><li>A quoted list item</li></ul><p>After the list</p></blockquote>",
      ).map((block) => block.text),
    ).toEqual(["A quote", "A quoted list item", "After the list"]);
  });

  it("uses stable safe PDF filenames while preserving Unicode titles", () => {
    expect(pdfFilename("  Meeting / notes: 2026?  ")).toBe(
      "Meeting - notes- 2026-.pdf",
    );
    expect(pdfFilename("සිංහල 📝")).toBe("සිංහල 📝.pdf");
    expect(pdfFilename("CON")).toBe("Note-CON.pdf");
    expect(pdfFilename("   ")).toBe("Untitled note.pdf");
  });
});
