import { expect, test, type CDPSession, type Page } from "@playwright/test";

type InkPoint = { x: number; y: number; pressure?: number };
type InkStroke = {
  tool: "pen" | "highlighter";
  style: "pressure" | "constant";
  opacity: number;
  points: InkPoint[];
};
type InkDocument = {
  version: number;
  width: number;
  height: number;
  paper: string;
  strokes: InkStroke[];
};

async function saved(page: Page) {
  await expect(page.locator(".save-state")).toHaveText("All changes saved");
}

async function newHandwriting(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".new-note-button").click();
  await expect(
    page.getByRole("tab", { name: "Handwrite", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".sketch-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Rename note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill(title);
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .press("Enter");
  await saved(page);
}

async function storedInk(
  page: Page,
  title: string,
): Promise<InkDocument | null> {
  return page.evaluate((noteTitle) => {
    const workspace = JSON.parse(
      localStorage.getItem("noteflow.workspace.v2") || '{"notes":[]}',
    );
    const note = workspace.notes.find(
      (item: { title: string }) => item.title === noteTitle,
    );
    return note?.sketchData ? JSON.parse(note.sketchData) : null;
  }, title);
}

async function drawingArea(page: Page) {
  const canvas = page.locator(".sketch-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  // The writing page is taller than the viewport. Draw in its visible upper portion.
  const y = Math.min(viewport.height - 140, Math.max(box!.y + 70, 100));
  return {
    canvas,
    x: box!.x + box!.width * 0.16,
    y,
    distance: Math.min(box!.width * 0.6, 300),
  };
}

async function penEvent(
  client: CDPSession,
  type: "mousePressed" | "mouseMoved" | "mouseReleased",
  x: number,
  y: number,
  force: number,
) {
  await client.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    force,
    pointerType: "pen",
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: type === "mouseMoved" ? 0 : 1,
  });
}

async function touchStroke(
  client: CDPSession,
  x: number,
  y: number,
  distance: number,
) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 41, force: 0.5 }],
  });
  for (let step = 1; step <= 8; step++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x + (distance * step) / 8, y: y + step * 3, id: 41, force: 0.5 },
      ],
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("a new note opens a writing page without focusing a text field or opening the text editor", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".new-note-button").click();
  await expect(
    page.getByRole("tab", { name: "Handwrite", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".sketch-canvas")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Note content", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).not.toHaveValue("");
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active instanceof HTMLElement &&
        (active.matches("input, textarea") || active.isContentEditable)
      );
    }),
  ).toBe(false);
  await expect(
    page.getByRole("combobox", { name: "Input mode", exact: true }),
  ).toHaveValue("stylus");
});

test("pen pressure persists and unrelated palm pointer endings do not interrupt a pen stroke", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await newHandwriting(page, "Pressure and palm rejection");
  const client = await page.context().newCDPSession(page);
  const { canvas, x, y, distance } = await drawingArea(page);
  await penEvent(client, "mousePressed", x, y, 0.15);
  await penEvent(client, "mouseMoved", x + distance * 0.25, y + 12, 0.35);

  // A palm can report its own end/cancel/capture events while the pen is still down.
  const palm = {
    pointerId: 99,
    pointerType: "touch",
    isPrimary: false,
    clientX: x + 20,
    clientY: y + 40,
    button: 0,
    buttons: 1,
    pressure: 0.5,
    bubbles: true,
  };
  await canvas.dispatchEvent("pointerdown", palm);
  await canvas.dispatchEvent("pointermove", {
    ...palm,
    clientX: x + distance * 0.8,
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    await canvas.dispatchEvent(type, { ...palm, buttons: 0, pressure: 0 });
  }
  await penEvent(client, "mouseMoved", x + distance * 0.5, y + 25, 0.65);
  await penEvent(client, "mouseMoved", x + distance, y + 35, 0.9);
  await penEvent(client, "mouseReleased", x + distance, y + 35, 0);

  await expect(canvas.locator('path[data-ink-stroke="true"]')).toHaveCount(1);
  const outline = canvas.locator('path[data-ink-stroke="true"]').first();
  await expect(outline).toHaveAttribute("d", /[QqCc]/);
  await expect(outline).toHaveAttribute("d", /[Zz]\s*$/);
  await saved(page);
  const ink = (await storedInk(page, "Pressure and palm rejection"))!;
  expect(ink.version).toBe(2);
  expect(ink.strokes).toHaveLength(1);
  const stroke = ink.strokes[0];
  expect(stroke.tool).toBe("pen");
  expect(stroke.style).toBe("pressure");
  expect(stroke.points.length).toBeGreaterThanOrEqual(4);
  const pressures = stroke.points.map((point) => point.pressure ?? -1);
  expect(Math.min(...pressures)).toBeLessThan(0.25);
  expect(Math.max(...pressures)).toBeGreaterThan(0.8);
  expect(stroke.points.at(-1)!.x - stroke.points[0].x).toBeGreaterThan(350);
  await page.reload();
  await expect(
    page.locator('.sketch-canvas path[data-ink-stroke="true"]'),
  ).toHaveCount(1);
  expect(
    (await storedInk(page, "Pressure and palm rejection"))!.strokes,
  ).toEqual(ink.strokes);
  expect(errors).toEqual([]);
});

test("touch is ignored in stylus mode and draws only after choosing Finger drawing", async ({
  page,
}) => {
  await newHandwriting(page, "Finger drawing is opt in");
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  const { canvas, x, y, distance } = await drawingArea(page);
  await touchStroke(client, x, y, distance);
  await expect(page).toHaveURL(/127\.0\.0\.1:5173\/$/);
  await expect(canvas.locator('path[data-ink-stroke="true"]')).toHaveCount(0);
  expect(
    (await storedInk(page, "Finger drawing is opt in"))?.strokes ?? [],
  ).toHaveLength(0);

  await page
    .getByRole("combobox", { name: "Input mode", exact: true })
    .selectOption({ label: "Finger drawing" });
  await touchStroke(client, x, y, distance);
  await expect(canvas.locator('path[data-ink-stroke="true"]')).toHaveCount(1);
  await saved(page);
  expect(
    (await storedInk(page, "Finger drawing is opt in"))!.strokes,
  ).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Input mode", exact: true }),
  ).toHaveValue("finger");
  await expect(
    page.locator('.sketch-canvas path[data-ink-stroke="true"]'),
  ).toHaveCount(1);
});

test("highlighter ink, paper selection, and extra writing space survive a reload", async ({
  page,
}) => {
  await newHandwriting(page, "Room to keep writing");
  await page
    .getByRole("combobox", { name: "Paper style", exact: true })
    .selectOption({ label: "Grid" });
  await page.getByRole("button", { name: "Highlighter", exact: true }).click();
  const client = await page.context().newCDPSession(page);
  const { canvas, x, y, distance } = await drawingArea(page);
  await penEvent(client, "mousePressed", x, y, 0.2);
  await penEvent(client, "mouseMoved", x + distance / 2, y + 18, 0.7);
  await penEvent(client, "mouseMoved", x + distance, y + 24, 0.9);
  await penEvent(client, "mouseReleased", x + distance, y + 24, 0);
  await expect(canvas.locator('path[data-tool="highlighter"]')).toHaveCount(1);
  await page
    .getByRole("button", { name: "Add more writing space", exact: true })
    .click();
  await saved(page);
  const ink = (await storedInk(page, "Room to keep writing"))!;
  expect(ink.paper).toBe("grid");
  expect(ink.width).toBe(1000);
  expect(ink.height).toBe(2121);
  expect(ink.strokes[0].tool).toBe("highlighter");
  expect(ink.strokes[0].opacity).toBeLessThan(0.6);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Paper style", exact: true }),
  ).toHaveValue("grid");
  await expect(page.locator(".sketch-canvas")).toHaveAttribute(
    "viewBox",
    "0 0 1000 2121",
  );
  await expect(
    page.locator('.sketch-canvas path[data-tool="highlighter"]'),
  ).toHaveCount(1);
  expect(await storedInk(page, "Room to keep writing")).toEqual(ink);
});
