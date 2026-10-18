import { expect, test } from "@playwright/test";

test("handwriting undo history survives a round trip through the text tab", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".new-note-button").click();
  const canvas = page.locator(".sketch-canvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  for (let line = 0; line < 2; line++) {
    await page.mouse.move(box!.x + 80, box!.y + 70 + line * 45);
    await page.mouse.down();
    await page.mouse.move(box!.x + 220, box!.y + 85 + line * 45, { steps: 10 });
    await page.mouse.up();
  }
  await expect(canvas.locator("path[data-ink-stroke]")).toHaveCount(2);
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note content", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Handwrite", exact: true }).click();
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await expect(canvas.locator("path[data-ink-stroke]")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo drawing", exact: true }).click();
  await expect(canvas.locator("path[data-ink-stroke]")).toHaveCount(2);
});
