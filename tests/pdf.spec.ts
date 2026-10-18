import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

test.setTimeout(60_000);

const date = "2026-10-18T08:00:00.000Z";
const mixedTitle = "Field journal PDF";
const typedMarker = "Typed appendix marker: a plan worth keeping.";
const handwriting = JSON.stringify({
  version: 2,
  width: 1000,
  height: 2121,
  paper: "plain",
  strokes: [
    {
      id: "blue-ink",
      tool: "pen",
      style: "pressure",
      color: "#1e6bd6",
      size: 9,
      opacity: 1,
      simulatePressure: false,
      points: [
        { x: 100, y: 180, pressure: 0.2 },
        { x: 250, y: 250, pressure: 0.8 },
        { x: 450, y: 220, pressure: 0.6 },
        { x: 600, y: 350, pressure: 0.9 },
      ],
    },
    {
      id: "yellow-highlight",
      tool: "highlighter",
      style: "pressure",
      color: "#edc94c",
      size: 25,
      opacity: 0.3,
      simulatePressure: false,
      points: [
        { x: 100, y: 1620, pressure: 0.5 },
        { x: 350, y: 1660, pressure: 0.7 },
        { x: 700, y: 1730, pressure: 0.8 },
      ],
    },
    {
      id: "red-ink",
      tool: "pen",
      style: "pressure",
      color: "#d5344b",
      size: 8,
      opacity: 1,
      simulatePressure: false,
      points: [
        { x: 150, y: 1850, pressure: 0.3 },
        { x: 400, y: 1810, pressure: 0.8 },
        { x: 750, y: 1900, pressure: 0.6 },
      ],
    },
  ],
});

function note(title: string, textContent: string, sketchData = "") {
  return {
    id: "pdf-export-note",
    title,
    textContent,
    sketchData,
    tags: ["export"],
    notebook: "Personal",
    color: "default",
    favorite: false,
    pinned: false,
    archived: false,
    deletedAt: null,
    createdAt: date,
    updatedAt: date,
  };
}

async function openNote(page: Page, source: ReturnType<typeof note>) {
  await page.addInitScript((value) => {
    if (!localStorage.getItem("noteflow.workspace.v2")) {
      localStorage.setItem(
        "noteflow.workspace.v2",
        JSON.stringify({ version: 2, notes: [value], notebooks: ["Personal"] }),
      );
    }
  }, source);
  await page.goto("/");
  await page.locator(".note-card").first().click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue(source.title);
  await expect(page.locator(".save-state")).toHaveText("All changes saved");
}

async function savedNote(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("noteflow.workspace.v2")!).notes[0],
  );
}

async function parseDownloadedPdf(download: Download) {
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1500);
  return getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
}

async function textFromPage(
  pdf: Awaited<ReturnType<typeof parseDownloadedPdf>>,
  number: number,
) {
  const page = await pdf.getPage(number);
  const content = await page.getTextContent();
  return content.items
    .flatMap((item) => ("str" in item ? [item.str] : []))
    .join(" ");
}

test("PDF export keeps a long handwritten note on multiple pages and includes its typed appendix", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openNote(
    page,
    note(
      mixedTitle,
      `<h2>Project reflections</h2><p>${typedMarker}</p>`,
      handwriting,
    ),
  );
  const before = await savedNote(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const pdf = await parseDownloadedPdf(await downloadPromise);
  try {
    expect(pdf.numPages).toBe(3);
    const metadata = await pdf.getMetadata();
    expect(metadata.info).toMatchObject({ Title: mixedTitle });
    const first = await textFromPage(pdf, 1);
    const second = await textFromPage(pdf, 2);
    const third = await textFromPage(pdf, 3);
    expect(first).toContain(mixedTitle);
    expect(second).toContain(mixedTitle);
    expect(third).toContain(typedMarker);
    expect(first).not.toContain(typedMarker);
    expect(second).not.toContain(typedMarker);
    // Handwriting must remain actual drawn page content, including ink below the first page.
    for (const [pageNumber, inkColor] of [
      [1, [30, 107, 214]],
      [2, [213, 52, 75]],
    ] as const) {
      const exportedPage = await pdf.getPage(pageNumber);
      const operators = await exportedPage.getOperatorList();
      const coloredInk = operators.fnArray.some((operation, index) => {
        if (operation !== OPS.setFillRGBColor) return false;
        const color = Array.from(operators.argsArray[index] as number[]);
        return inkColor.every(
          (channel, channelIndex) =>
            Math.abs(channel - color[channelIndex]) <= 2,
        );
      });
      expect(
        coloredInk,
        `ink color is present on handwriting page ${pageNumber}`,
      ).toBe(true);
      expect(
        operators.fnArray.some(
          (operation, index) =>
            operation === OPS.constructPath &&
            (operators.argsArray[index][0] as number[]).includes(OPS.curveTo),
        ),
      ).toBe(true);
      expect(operators.fnArray).not.toContain(OPS.paintImageXObject);
    }
    expect(await savedNote(page)).toEqual(before);
    await page.reload();
    expect(await savedNote(page)).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    await pdf.destroy();
  }
});

test("the note menu downloads a paginated PDF containing the beginning and end of long typed notes", async ({
  page,
}) => {
  const title = "Long typed notebook";
  const paragraphs = Array.from(
    { length: 90 },
    (_, index) =>
      `<p>Entry ${index + 1}. Keep the decisions, questions, and next steps together for the next visit.</p>`,
  ).join("");
  await openNote(
    page,
    note(
      title,
      `<p>Opening marker alpha.</p>${paragraphs}<p>Closing marker omega.</p>`,
    ),
  );
  const before = await savedNote(page);
  await page
    .getByRole("button", { name: "More note actions", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const pdf = await parseDownloadedPdf(await downloadPromise);
  try {
    expect(pdf.numPages).toBeGreaterThan(1);
    const metadata = await pdf.getMetadata();
    expect(metadata.info).toMatchObject({ Title: title });
    expect(await textFromPage(pdf, 1)).toContain("Opening marker alpha.");
    expect(await textFromPage(pdf, pdf.numPages)).toContain(
      "Closing marker omega.",
    );
    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, (_, index) =>
        textFromPage(pdf, index + 1),
      ),
    );
    expect(pages.join(" ")).toContain("Entry 90.");
    expect(await savedNote(page)).toEqual(before);
  } finally {
    await pdf.destroy();
  }
});

test("Sinhala and emoji export on mobile while handwriting remains vector content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const title = "මගේ සටහන් 🌿";
  const ink = JSON.parse(handwriting);
  ink.height = 1414;
  ink.strokes = ink.strokes.slice(0, 1);
  await openNote(
    page,
    note(title, "<p>අද මගේ අදහස් සහ සැලසුම්. 🌱 ✨</p>", JSON.stringify(ink)),
  );
  const exportButton = page.getByRole("button", {
    name: "Export PDF",
    exact: true,
  });
  await expect(exportButton).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const pdf = await parseDownloadedPdf(await downloadPromise);
  try {
    expect(pdf.numPages).toBe(2);
    expect((await pdf.getMetadata()).info).toMatchObject({ Title: title });
    const firstPage = await pdf.getPage(1);
    const firstOps = await firstPage.getOperatorList();
    expect(firstOps.fnArray).toContain(OPS.constructPath);
    const allOperations = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      allOperations.push(
        ...(await (await pdf.getPage(number)).getOperatorList()).fnArray,
      );
    }
    expect(
      allOperations.some((operation) =>
        [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(
          operation,
        ),
      ),
    ).toBe(true);
    expect((await savedNote(page)).title).toBe(title);
  } finally {
    await pdf.destroy();
  }
});
