import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const sourceInk = {
  version: 2,
  width: 1000,
  height: 1414,
  paper: "plain",
  strokes: [
    {
      id: "original-line",
      tool: "pen",
      style: "constant",
      color: "#253d35",
      size: 8,
      opacity: 1,
      simulatePressure: false,
      points: [
        { x: 100, y: 400 },
        { x: 900, y: 400 },
      ],
    },
  ],
};

async function openWritingPage(page: Page, fixture = sourceInk) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript((ink) => {
    if (localStorage.getItem("noteflow.workspace.v2")) return;
    localStorage.setItem(
      "noteflow.workspace.v2",
      JSON.stringify({
        version: 2,
        notebooks: ["Personal"],
        notes: [
          {
            id: "writing-tools-note",
            title: "Handwriting tools",
            textContent: "",
            sketchData: JSON.stringify(ink),
            notebook: "Personal",
            tags: [],
            color: "default",
            favorite: false,
            pinned: false,
            archived: false,
            deletedAt: null,
            createdAt: "2026-10-18T08:00:00.000Z",
            updatedAt: "2026-10-18T08:00:00.000Z",
          },
        ],
      }),
    );
  }, fixture);
  await page.goto("/");
  await expect(page.locator(".sketch-canvas")).toBeVisible();
  await saved(page);
}

async function saved(page: Page) {
  await expect(page.locator(".save-state")).toHaveText("All changes saved");
}

async function ink(page: Page) {
  return page.evaluate(() => {
    const workspace = JSON.parse(
      localStorage.getItem("noteflow.workspace.v2")!,
    );
    return JSON.parse(
      workspace.notes.find(
        (note: { id: string }) => note.id === "writing-tools-note",
      ).sketchData,
    );
  });
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator(".sketch-canvas").evaluate(
    (svg, position) => {
      const point = new DOMPoint(position.x, position.y).matrixTransform(
        (svg as SVGSVGElement).getScreenCTM()!,
      );
      return { x: point.x, y: point.y };
    },
    { x, y },
  );
}

async function centerWritingY(page: Page, y: number) {
  await page.locator(".handwriting-viewport").evaluate((viewport, sourceY) => {
    const svg = viewport.querySelector(".sketch-canvas") as SVGSVGElement;
    const point = new DOMPoint(500, sourceY).matrixTransform(
      svg.getScreenCTM()!,
    );
    viewport.scrollTop +=
      point.y -
      viewport.getBoundingClientRect().top -
      viewport.clientHeight / 2;
  }, y);
}

async function mouseLine(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

test("zoom preserves saved ink and maps new pen strokes correctly, including PDF export while zoomed", async ({
  page,
}) => {
  await openWritingPage(page);
  const before = await ink(page);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reset zoom", exact: true }),
  ).toContainText("150%");
  expect(await ink(page)).toEqual(before);

  const positions = await page
    .locator(".handwriting-viewport")
    .evaluate((viewport) => {
      const rect = viewport.getBoundingClientRect();
      const svg = viewport.querySelector("svg.sketch-canvas") as SVGSVGElement;
      const inverse = svg.getScreenCTM()!.inverse();
      const from = { x: rect.x + rect.width / 2 - 60, y: rect.y + 120 };
      const to = { x: from.x + 150, y: from.y + 45 };
      const first = new DOMPoint(from.x, from.y).matrixTransform(inverse);
      const last = new DOMPoint(to.x, to.y).matrixTransform(inverse);
      return {
        from,
        to,
        expectedFirst: { x: first.x, y: first.y },
        expectedLast: { x: last.x, y: last.y },
      };
    });
  await mouseLine(page, positions.from, positions.to);
  await saved(page);
  const after = await ink(page);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(after.strokes).toHaveLength(2);
  expect(after.strokes[0]).toEqual(before.strokes[0]);
  const drawn = after.strokes[1].points;
  expect(drawn[0].x).toBeCloseTo(positions.expectedFirst.x, 1);
  expect(drawn[0].y).toBeCloseTo(positions.expectedFirst.y, 1);
  expect(drawn.at(-1).x).toBeCloseTo(positions.expectedLast.x, 1);
  expect(drawn.at(-1).y).toBeCloseTo(positions.expectedLast.y, 1);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const download = await downloadPromise;
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  try {
    expect(pdf.numPages).toBe(1);
    const operators = await (await pdf.getPage(1)).getOperatorList();
    expect(
      operators.fnArray.filter((operation) => operation === OPS.constructPath)
        .length,
    ).toBeGreaterThan(1);
    expect(await ink(page)).toEqual(after);
  } finally {
    await pdf.destroy();
  }
});

test("the Hand tool pans the writing viewport without changing handwriting", async ({
  page,
}) => {
  await openWritingPage(page);
  const before = await ink(page);
  for (let click = 0; click < 4; click++)
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Hand tool", exact: true }).click();
  const viewport = page.locator(".handwriting-viewport");
  const initialScroll = await viewport.evaluate((element) => ({
    x: element.scrollLeft,
    y: element.scrollTop,
  }));
  const box = (await viewport.boundingBox())!;
  const start = {
    x: box.x + box.width * 0.6,
    y: box.y + Math.min(220, box.height / 2),
  };
  await mouseLine(page, start, { x: start.x - 140, y: start.y - 90 });
  await expect
    .poll(() =>
      viewport.evaluate((element) => element.scrollLeft + element.scrollTop),
    )
    .toBeGreaterThan(initialScroll.x + initialScroll.y + 50);
  expect(await ink(page)).toEqual(before);
});

test("drawing suppresses browser context menus, selection, and drag gestures only inside the viewport", async ({
  page,
}) => {
  await openWritingPage(page);
  const cancelled = await page
    .locator(".handwriting-viewport")
    .evaluate((viewport) => {
      return ["contextmenu", "selectstart", "dragstart"].map((type) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        viewport.querySelector(".sketch-canvas")!.dispatchEvent(event);
        return event.defaultPrevented;
      });
    });
  expect(cancelled).toEqual([true, true, true]);
  const searchCanSelect = await page
    .getByRole("textbox", { name: "Search notes", exact: true })
    .evaluate((search) => {
      const event = new Event("selectstart", {
        bubbles: true,
        cancelable: true,
      });
      search.dispatchEvent(event);
      return !event.defaultPrevented;
    });
  expect(searchCanSelect).toBe(true);
});

test("pen, highlighter, and eraser sizes are independent and persist with point eraser mode", async ({
  page,
}) => {
  await openWritingPage(page);
  const before = await ink(page);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Pen size", exact: true })
    .fill("7");
  await page.getByRole("button", { name: "Highlighter", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Highlighter size", exact: true })
    .fill("28");
  await page
    .getByRole("button", { name: "Stroke eraser", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Eraser size", exact: true })
    .fill("36");
  await page
    .getByRole("combobox", { name: "Eraser mode", exact: true })
    .selectOption("point");
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Pen size", exact: true }),
  ).toHaveValue("7");
  expect(await ink(page)).toEqual(before);
  await page.reload();
  await page.getByRole("button", { name: "Highlighter", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Highlighter size", exact: true }),
  ).toHaveValue("28");
  await page
    .getByRole("button", { name: "Stroke eraser", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Eraser size", exact: true }),
  ).toHaveValue("36");
  await expect(
    page.getByRole("combobox", { name: "Eraser mode", exact: true }),
  ).toHaveValue("point");
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Pen size", exact: true }),
  ).toHaveValue("7");
});

test("point erasing removes just the crossed part of a sparse line and supports undo and redo", async ({
  page,
}) => {
  await openWritingPage(page);
  const before = await ink(page);
  await page
    .getByRole("button", { name: "Stroke eraser", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Eraser mode", exact: true })
    .selectOption("point");
  await page
    .getByRole("spinbutton", { name: "Eraser size", exact: true })
    .fill("40");
  await centerWritingY(page, 400);
  const from = await screenPoint(page, 500, 350);
  const to = await screenPoint(page, 500, 450);
  await mouseLine(page, from, to);
  await expect(
    page.locator('.sketch-canvas path[data-ink-stroke="true"]'),
  ).toHaveCount(2);
  await saved(page);
  const erased = await ink(page);
  expect(erased.strokes).toHaveLength(2);
  expect(erased.strokes[0].points.at(-1).x).toBeLessThan(490);
  expect(erased.strokes[1].points[0].x).toBeGreaterThan(510);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await saved(page);
  expect(await ink(page)).toEqual(before);
  await page.getByRole("button", { name: "Redo drawing", exact: true }).click();
  await saved(page);
  expect(await ink(page)).toEqual(erased);
  await page.reload();
  await expect(
    page.locator('.sketch-canvas path[data-ink-stroke="true"]'),
  ).toHaveCount(2);
  expect(await ink(page)).toEqual(erased);
});

test("a pen barrel eraser starts at the current nib instead of sweeping from the original pen-down position", async ({
  page,
}) => {
  const fixture = {
    ...sourceInk,
    strokes: [
      {
        ...sourceInk.strokes[0],
        id: "unrelated-ink",
        points: [
          { x: 350, y: 357.5 },
          { x: 450, y: 357.5 },
        ],
      },
      {
        ...sourceInk.strokes[0],
        id: "erase-at-nib",
        points: [
          { x: 800, y: 420 },
          { x: 950, y: 420 },
        ],
      },
    ],
  };
  await openWritingPage(page, fixture);
  await page
    .getByRole("button", { name: "Stroke eraser", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Eraser mode", exact: true })
    .selectOption("stroke");
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await centerWritingY(page, 400);
  const start = await screenPoint(page, 100, 320);
  const previous = await screenPoint(page, 900, 320);
  const nib = await screenPoint(page, 900, 420);
  const canvas = page.locator(".sketch-canvas");
  const pen = {
    pointerId: 81,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    pressure: 0.5,
    bubbles: true,
  };
  await canvas.dispatchEvent("pointerdown", {
    ...pen,
    clientX: start.x,
    clientY: start.y,
  });
  await canvas.dispatchEvent("pointermove", {
    ...pen,
    clientX: previous.x,
    clientY: previous.y,
  });
  await canvas.dispatchEvent("pointermove", {
    ...pen,
    button: 2,
    buttons: 3,
    clientX: nib.x,
    clientY: nib.y,
  });
  await canvas.dispatchEvent("pointerup", {
    ...pen,
    buttons: 0,
    pressure: 0,
    clientX: nib.x,
    clientY: nib.y,
  });
  await saved(page);
  const remaining = await ink(page);
  expect(remaining.strokes.map((stroke: { id: string }) => stroke.id)).toEqual([
    "unrelated-ink",
  ]);
  expect(remaining.strokes[0]).toEqual(fixture.strokes[0]);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await saved(page);
  expect((await ink(page)).strokes).toEqual(fixture.strokes);
});
