import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const saved = (page: Page) =>
  expect(page.locator(".save-state")).toHaveText("All changes saved");
async function create(
  page: Page,
  title: string,
  content = "A thought worth keeping.",
) {
  await page.locator(".new-note-button").click();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill(title);
  await page
    .getByRole("textbox", { name: "Note content", exact: true })
    .fill(content);
  await saved(page);
}
function nav(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Notes views" })
    .getByRole("button", { name: new RegExp(`^${name}`) });
}

test("create, autosave, format, tag, search, and reopen after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await create(page, "Garden ideas", "Plant basil and mint this weekend.");
  await page.getByRole("textbox", { name: "Add tags" }).fill("garden");
  await page.getByRole("textbox", { name: "Add tags" }).press("Enter");
  await page
    .getByRole("button", { name: "Add to favorites", exact: true })
    .click();
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note content" })
    .press("ControlOrMeta+End");
  await page
    .getByRole("button", { name: "Bold (Ctrl/⌘ B)", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Note content" })
    .pressSequentially(" Remember water.");
  await expect(page.locator(".tiptap strong")).toContainText("Remember water.");
  await saved(page);
  await page.reload();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Garden ideas");
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toContainText("Plant basil");
  await expect(
    page.getByRole("button", { name: "Remove tag garden", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search notes", exact: true })
    .fill("basil");
  await expect(page.locator(".note-card")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Search notes", exact: true })
    .fill("no-such-note-xyz");
  await expect(
    page.getByText("No matching notes", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear search", exact: true })
    .first()
    .click();
  await expect(
    page.locator(".note-card").filter({ hasText: "Garden ideas" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("notebooks, favorite filters, archive, trash, restore, and permanent deletion", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create notebook", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Notebook name", exact: true })
    .fill("Research");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create notebook", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Notebooks" })
    .getByRole("button", { name: /^Research/ })
    .click();
  await create(page, "Read this paper");
  await expect(
    page.getByRole("combobox", { name: "Note notebook", exact: true }),
  ).toHaveValue("Research");
  await page
    .getByRole("button", { name: "Add to favorites", exact: true })
    .click();
  await nav(page, "Favorites").click();
  await expect(page.locator(".note-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "More note actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Archive note", exact: true }).click();
  await nav(page, "Archive").click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Read this paper");
  await page
    .getByRole("button", { name: "Move to all notes", exact: true })
    .click();
  await nav(page, "All notes").click();
  await page
    .locator(".note-card")
    .filter({ hasText: "Read this paper" })
    .click();
  await page
    .getByRole("button", { name: "More note actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await nav(page, "Trash").click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await nav(page, "All notes").click();
  await page
    .locator(".note-card")
    .filter({ hasText: "Read this paper" })
    .click();
  await page
    .getByRole("button", { name: "More note actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await nav(page, "Trash").click();
  await page
    .getByRole("button", { name: "Delete note permanently", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page.locator(".note-card")).toHaveCount(0);
});

test("sketch survives text editing, undo, redo, reload, and PNG export", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Sketch and words", "Both belong to the same note.");
  await page.getByRole("tab", { name: "Handwrite", exact: true }).click();
  const canvas = page.locator(".sketch-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.7,
    box!.y + box!.height * 0.65,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect(canvas.locator("path")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await expect(canvas.locator("path")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo drawing", exact: true }).click();
  await expect(canvas.locator("path")).toHaveCount(1);
  const pngDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download sketch as PNG", exact: true })
    .click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await readFile((await png.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  await saved(page);
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toContainText("Both belong");
  await page.reload();
  await page.getByRole("tab", { name: "Handwrite", exact: true }).click();
  await expect(page.locator(".sketch-canvas path")).toHaveCount(1);
});

test("backup, import without duplicates, templates, and theme persistence", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore templates", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Meeting notes.*Good conversations/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Meeting notes");
  await expect(page.locator('.tiptap ul[data-type="taskList"]')).toBeVisible();
  await page.locator(".tiptap input[type=checkbox]").check();
  await saved(page);
  const initialCount = await page.locator(".note-card").count();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace backup", exact: true })
    .click();
  const backup = await downloadPromise;
  const bytes = await readFile((await backup.path())!);
  const data = JSON.parse(bytes.toString());
  expect(data.notes.length).toBe(initialCount);
  await page.getByLabel("Import notes file", { exact: true }).setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(page.getByText(/Imported .* notes\./)).toBeVisible();
  await expect(page.locator(".note-card")).toHaveCount(initialCount);
  const themeBefore = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("button", { name: /Switch to .* theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    themeBefore === "dark" ? "light" : "dark",
  );
  await saved(page);
  await page.reload();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    themeBefore === "dark" ? "light" : "dark",
  );
  await page.locator(".note-card").filter({ hasText: "Meeting notes" }).click();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(page.locator(".tiptap input[type=checkbox]")).toBeChecked();
});

test("migrates the original app notes without removing their source", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("legacy-seeded")) {
      localStorage.setItem(
        "notes",
        JSON.stringify([
          {
            id: "old-note",
            title: "My original note",
            createdAt: "2025-01-02T12:00:00.000Z",
            textContent: "<p>Do not lose this.</p>",
          },
        ]),
      );
      sessionStorage.setItem("legacy-seeded", "yes");
    }
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("My original note");
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toContainText("Do not lose this.");
  await saved(page);
  expect(await page.evaluate(() => localStorage.getItem("notes"))).toContain(
    "My original note",
  );
  await page.reload();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("My original note");
});

test("invalid storage is reported and original data is preserved", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("noteflow.workspace.v2", "{broken-json"),
  );
  await page.goto("/");
  await expect(page.locator(".storage-banner")).toContainText("Saving paused");
  await page.waitForTimeout(700);
  expect(
    await page.evaluate(() => localStorage.getItem("noteflow.workspace.v2")),
  ).toBe("{broken-json");
  await page
    .getByRole("button", { name: "Recover storage", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create recovery copy & retry", exact: true })
    .click();
  await expect(page.locator(".storage-banner")).toHaveCount(0);
  await saved(page);
  expect(
    await page.evaluate(() => {
      const recoveryKeys = Object.keys(localStorage).filter((key) =>
        key.includes("recovery"),
      );
      return recoveryKeys.some(
        (key) => localStorage.getItem(key) === "{broken-json",
      );
    }),
  ).toBe(true);
});

test("mobile navigation, note editing, and focus mode fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.locator(".new-note-button").click();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Pocket thought");
  await page
    .getByRole("textbox", { name: "Note content" })
    .fill("Works on a small screen.");
  await page
    .getByRole("button", { name: "Enter focus mode", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toHaveClass(/is-focused/);
  await page
    .getByRole("button", { name: "Exit focus mode", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await expect(
    page.locator(".note-card").filter({ hasText: "Pocket thought" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("clean tabs receive updates and malformed remote storage pauses autosave", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await saved(page);
  const second = await context.newPage();
  await second.goto("/");
  await saved(second);
  await create(second, "Shared between tabs", "The same browser workspace.");
  await expect(
    page.locator(".note-card").filter({ hasText: "Shared between tabs" }),
  ).toBeVisible();
  await saved(page);
  await second.evaluate(() =>
    localStorage.setItem("noteflow.workspace.v2", "{bad-remote-data"),
  );
  await expect(page.locator(".storage-banner")).toContainText("Saving paused");
  await page.locator(".new-note-button").click();
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Keep these unsaved edits");
  await page.waitForTimeout(700);
  expect(
    await page.evaluate(() => localStorage.getItem("noteflow.workspace.v2")),
  ).toBe("{bad-remote-data");
  await second.close();
});

test("a changed storage baseline cannot be overwritten before its event arrives", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Original local note");
  // A same-tab storage write produces no StorageEvent. This models a remote
  // save whose event has not reached the dirty editor yet.
  const remoteSnapshot = await page.evaluate(() => {
    const raw = localStorage.getItem("noteflow.workspace.v2")!;
    const data = JSON.parse(raw);
    data.notes[0].title = "Another tab saved this";
    data.notes[0].updatedAt = new Date(Date.now() + 1000).toISOString();
    const next = JSON.stringify(data);
    localStorage.setItem("noteflow.workspace.v2", next);
    return next;
  });
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("My unsaved version");
  await expect(page.locator(".storage-banner")).toContainText(
    "Another tab saved changes",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("noteflow.workspace.v2")),
  ).toBe(remoteSnapshot);
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("My unsaved version");
});
