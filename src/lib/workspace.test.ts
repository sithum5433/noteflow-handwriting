import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNote,
  loadWorkspace,
  mergeWorkspaces,
  parseBackup,
  plainText,
  saveWorkspace,
  serializeBackup,
  STORAGE_KEY,
  type Workspace,
} from "./workspace";

const firstDate = "2026-01-01T12:00:00.000Z";
const laterDate = "2026-02-01T12:00:00.000Z";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    version: 2,
    notes: [
      createNote({
        id: "one",
        title: "A note",
        createdAt: firstDate,
        updatedAt: firstDate,
      }),
    ],
    notebooks: ["Personal"],
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("workspace storage", () => {
  it("starts a fresh browser with helpful notes and the default notebooks", () => {
    const result = loadWorkspace();
    expect(result.error).toBeNull();
    expect(result.workspace.notebooks).toEqual(["Personal", "Work", "Ideas"]);
    expect(result.workspace.notes.length).toBeGreaterThan(0);
    expect(new Set(result.workspace.notes.map((note) => note.id)).size).toBe(
      result.workspace.notes.length,
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("migrates the original text and CanvasDraw notes while preserving the legacy source", () => {
    const drawing = JSON.stringify({
      lines: [{ points: [{ x: 2, y: 3 }], brushColor: "#000", brushRadius: 2 }],
      width: 500,
      height: 400,
    });
    const legacy = JSON.stringify([
      {
        id: "text",
        title: "Old writing",
        createdAt: firstDate,
        textContent: "<p>Hello</p>",
      },
      {
        id: "sketch",
        title: "Old drawing",
        createdAt: laterDate,
        sketchData: drawing,
      },
    ]);
    localStorage.setItem("notes", legacy);
    const result = loadWorkspace();
    expect(result.error).toBeNull();
    expect(result.workspace.notes.map((note) => note.id)).toEqual([
      "text",
      "sketch",
    ]);
    expect(result.workspace.notes[0]).toMatchObject({
      textContent: "<p>Hello</p>",
      sketchData: "",
      updatedAt: firstDate,
      notebook: "Personal",
      deletedAt: null,
    });
    expect(result.workspace.notes[1].sketchData).toBe(drawing);
    expect(parseBackup(localStorage.getItem(STORAGE_KEY)!)).toEqual(
      result.workspace,
    );
    expect(localStorage.getItem("notes")).toBe(legacy);
  });

  it("uses a saved version 2 workspace instead of stale legacy data", () => {
    saveWorkspace(workspace());
    localStorage.setItem("notes", "broken old JSON");
    expect(loadWorkspace()).toEqual({ workspace: workspace(), error: null });
  });

  it("preserves malformed storage and makes a separate recovery copy", () => {
    const damaged = '{"version":2,"notes":[';
    localStorage.setItem(STORAGE_KEY, damaged);
    const result = loadWorkspace();
    expect(result.error).toContain("could not be read");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(damaged);
    const recoveryKey = Object.keys(localStorage).find((key) =>
      key.startsWith(`${STORAGE_KEY}.recovery.`),
    );
    expect(recoveryKey).toBeDefined();
    expect(localStorage.getItem(recoveryKey!)).toBe(damaged);
  });

  it("does not migrate partially damaged legacy notes or replace their source", () => {
    const legacy = JSON.stringify([
      { id: "good", title: "Okay", createdAt: firstDate },
      { id: "bad", title: "Missing date" },
    ]);
    localStorage.setItem("notes", legacy);
    expect(loadWorkspace().error).toContain("could not be read");
    expect(localStorage.getItem("notes")).toBe(legacy);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("surfaces storage quota failures without discarding the previous saved data", () => {
    const old = serializeBackup(workspace());
    localStorage.setItem(STORAGE_KEY, old);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });
    expect(() => saveWorkspace(workspace({ notes: [] }))).toThrow(
      "Storage is full",
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(old);
  });

  it("keeps migrated notes accessible if the new storage write fails", () => {
    const legacy = JSON.stringify([
      { id: "legacy", title: "Keep me", createdAt: firstDate },
    ]);
    localStorage.setItem("notes", legacy);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is full");
    });
    const result = loadWorkspace();
    expect(result.error).toContain("could not be saved");
    expect(result.workspace.notes[0].title).toBe("Keep me");
    expect(localStorage.getItem("notes")).toBe(legacy);
  });
});

describe("backup validation and safe HTML", () => {
  it("rejects malformed JSON, unsupported versions, partial records, and duplicate IDs", () => {
    expect(() => parseBackup("not JSON")).toThrow("valid JSON");
    expect(() =>
      parseBackup('{"version":3,"notes":[],"notebooks":[]}'),
    ).toThrow("unsupported");
    expect(() =>
      parseBackup(
        JSON.stringify({
          version: 2,
          notes: [{ id: "partial", title: "No content" }],
          notebooks: [],
        }),
      ),
    ).toThrow();
    const duplicate = createNote({ id: "same" });
    expect(() =>
      parseBackup(JSON.stringify(workspace({ notes: [duplicate, duplicate] }))),
    ).toThrow("duplicate");
  });

  it.each([
    { updatedAt: "not a date" },
    { favorite: "yes" },
    { color: "neon" },
    { tags: ["okay", 42] },
    { sketchData: null },
    { deletedAt: "broken" },
    { notebook: "" },
  ])(
    "rejects invalid record values instead of importing a partial note: %j",
    (invalid) => {
      const source = workspace();
      Object.assign(source.notes[0], invalid);
      expect(() => parseBackup(JSON.stringify(source))).toThrow();
    },
  );

  it("does not silently downgrade incomplete modern metadata in a legacy-shaped array", () => {
    expect(() =>
      parseBackup(
        JSON.stringify([
          {
            id: "partial",
            title: "Keep metadata",
            createdAt: firstDate,
            favorite: true,
          },
        ]),
      ),
    ).toThrow();
  });

  it("removes executable imported HTML while preserving text formatting and task checkboxes", () => {
    const source = workspace();
    source.notes[0].textContent =
      '<p onclick="alert(1)">Hello <strong>world</strong><script>alert(1)</script><a href="javascript:alert(1)">unsafe link</a></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Finish writing</p></div></li></ul>';
    const html = parseBackup(JSON.stringify(source)).notes[0].textContent;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<label>");
    expect(html).toContain("<div>");
  });

  it("exports a lossless version 2 backup, including drawing and notebook metadata", () => {
    const source = workspace({
      notes: [
        createNote({
          id: "one",
          notebook: "Project notes",
          tags: ["idea", "review"],
          sketchData: '{"lines":[]}',
          favorite: true,
          archived: true,
          deletedAt: laterDate,
          color: "lavender",
        }),
      ],
      notebooks: ["Personal", "Project notes"],
    });
    expect(parseBackup(serializeBackup(source))).toEqual(source);
  });

  it("restores Personal when an imported or saved version 2 workspace omits the default notebook", () => {
    const foreign = workspace({
      notes: [createNote({ id: "imported", notebook: "Project notes" })],
      notebooks: ["Project notes"],
    });
    const imported = parseBackup(JSON.stringify(foreign));
    expect(imported.notebooks).toEqual(["Personal", "Project notes"]);
    expect(imported.notes[0].notebook).toBe("Project notes");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(foreign));
    expect(loadWorkspace().workspace.notebooks).toEqual([
      "Personal",
      "Project notes",
    ]);
    expect(
      parseBackup(JSON.stringify({ version: 2, notes: [], notebooks: [] }))
        .notebooks,
    ).toEqual(["Personal"]);
  });

  it("extracts readable search text across paragraphs, line breaks, and entities", () => {
    expect(
      plainText(
        "<p>First&nbsp;thought<br>next line</p><p>Second <strong>thought</strong></p><script>bad()</script>",
      ),
    ).toBe("First thought next line Second thought");
  });
});

describe("merging backups", () => {
  it("keeps the newest version of shared IDs, preserves local-only notes, and unions notebooks", () => {
    const current = workspace({
      notes: [
        createNote({
          id: "shared",
          title: "Local older",
          updatedAt: firstDate,
        }),
        createNote({ id: "local", title: "Only here" }),
      ],
    });
    const incoming = workspace({
      notes: [
        createNote({
          id: "shared",
          title: "Imported newer",
          updatedAt: laterDate,
          notebook: "Travel",
        }),
        createNote({ id: "imported", title: "Only there", notebook: "Travel" }),
      ],
      notebooks: ["Travel", "Personal"],
    });
    const merged = mergeWorkspaces(current, incoming);
    expect(merged.notes.map((note) => note.id)).toEqual([
      "shared",
      "local",
      "imported",
    ]);
    expect(merged.notes.find((note) => note.id === "shared")?.title).toBe(
      "Imported newer",
    );
    expect(merged.notebooks).toEqual(["Personal", "Travel"]);
    expect(current.notes[0].title).toBe("Local older");
  });

  it("retains the local record when an import is older or has the same timestamp", () => {
    const current = workspace({
      notes: [
        createNote({ id: "shared", title: "Local", updatedAt: laterDate }),
      ],
    });
    for (const updatedAt of [firstDate, laterDate]) {
      const incoming = workspace({
        notes: [createNote({ id: "shared", title: "Imported", updatedAt })],
      });
      expect(mergeWorkspaces(current, incoming).notes[0].title).toBe("Local");
    }
  });
});
