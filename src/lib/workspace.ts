import DOMPurify from "dompurify";

export const STORAGE_KEY = "noteflow.workspace.v2";
export const DEFAULT_NOTEBOOKS = ["Personal", "Work", "Ideas"];
export const NOTE_COLORS = [
  "default",
  "sage",
  "rose",
  "sand",
  "blue",
  "lavender",
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const COLOR_LABELS: Record<NoteColor, string> = {
  default: "Paper",
  sage: "Sage",
  rose: "Rose",
  sand: "Sand",
  blue: "Blue",
  lavender: "Lavender",
};

export interface Note {
  id: string;
  title: string;
  textContent: string;
  sketchData: string;
  tags: string[];
  notebook: string;
  color: NoteColor;
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  version: 2;
  notes: Note[];
  notebooks: string[];
}

const unique = (values: string[]) => [...new Set(values)];
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown storage error.";

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["input"],
    ADD_ATTR: ["data-type", "data-checked", "checked", "type", "disabled"],
  });
}

export function createNote(overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  const note: Note = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: "Untitled note",
    textContent: "",
    sketchData: "",
    tags: [],
    notebook: "Personal",
    color: "default",
    favorite: false,
    pinned: false,
    archived: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return { ...note, tags: [...note.tags] };
}

function freshWorkspace(): Workspace {
  return {
    version: 2,
    notebooks: [...DEFAULT_NOTEBOOKS],
    notes: [
      createNote({
        title: "A little space for your thoughts",
        textContent:
          "<p>Welcome to NoteFlow. A place for the things you want to remember, the ideas still taking shape, and a little room to think.</p><h2>Make yourself at home</h2><ul><li>Write a note, add a sketch, or bring the two together.</li><li>Keep a few notebooks for different parts of your day.</li><li>Use tags and favorites to find your way back.</li></ul><p>Your notes stay in this browser. Export a backup whenever you want to keep a copy.</p>",
        notebook: "Personal",
        tags: ["welcome"],
        pinned: true,
      }),
      createNote({
        title: "Things worth exploring",
        textContent:
          "<p>Leave a thought here before it slips away.</p><ul><li>A small project I would love to start</li><li>Something I want to learn</li><li>A place I would like to see</li></ul><p>There is no need to have it all figured out.</p>",
        notebook: "Ideas",
        color: "sage",
        tags: ["inspiration"],
      }),
    ],
  };
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, context: string, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(
      `${context} must be ${allowEmpty ? "a string" : "a nonempty string"}.`,
    );
  }
  return value;
}

function date(value: unknown, context: string): string {
  const result = string(value, context, false);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error(`${context} must be a valid date.`);
  return result;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`${context} must be true or false.`);
  return value;
}

function strings(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array.`);
  return unique(
    value.map((item, index) => string(item, `${context}[${index}]`, false)),
  );
}

function validateNote(value: unknown, index: number): Note {
  const context = `Note ${index + 1}`;
  const source = record(value, context);
  const color = string(source.color, `${context} color`);
  if (!NOTE_COLORS.includes(color as NoteColor))
    throw new Error(`${context} has an unknown color.`);
  return {
    id: string(source.id, `${context} ID`, false),
    title: string(source.title, `${context} title`),
    textContent: sanitizeHtml(string(source.textContent, `${context} text`)),
    // Keep CanvasDraw JSON verbatim so existing drawings can be opened again.
    sketchData: string(source.sketchData, `${context} sketch`),
    tags: strings(source.tags, `${context} tags`),
    notebook: string(source.notebook, `${context} notebook`, false),
    color: color as NoteColor,
    favorite: boolean(source.favorite, `${context} favorite`),
    pinned: boolean(source.pinned, `${context} pinned`),
    archived: boolean(source.archived, `${context} archived`),
    deletedAt:
      source.deletedAt === null
        ? null
        : date(source.deletedAt, `${context} deletion date`),
    createdAt: date(source.createdAt, `${context} creation date`),
    updatedAt: date(source.updatedAt, `${context} update date`),
  };
}

function validateLegacyNote(value: unknown, index: number): Note {
  const context = `Legacy note ${index + 1}`;
  const source = record(value, context);
  // Do not accidentally treat an incomplete modern note as an older note and drop its metadata.
  const modernFields = [
    "updatedAt",
    "tags",
    "notebook",
    "color",
    "favorite",
    "pinned",
    "archived",
    "deletedAt",
  ];
  if (modernFields.some((field) => Object.hasOwn(source, field)))
    return validateNote(source, index);
  const createdAt = date(source.createdAt, `${context} creation date`);
  return createNote({
    id: string(source.id, `${context} ID`, false),
    title: string(source.title, `${context} title`),
    createdAt,
    updatedAt: createdAt,
    textContent:
      source.textContent === undefined
        ? ""
        : sanitizeHtml(string(source.textContent, `${context} text`)),
    sketchData:
      source.sketchData === undefined
        ? ""
        : string(source.sketchData, `${context} sketch`),
  });
}

function validateWorkspace(value: unknown): Workspace {
  if (Array.isArray(value)) {
    const notes = value.map(validateLegacyNote);
    assertUniqueIds(notes);
    return {
      version: 2,
      notes,
      notebooks: unique([
        ...DEFAULT_NOTEBOOKS,
        ...notes.map((note) => note.notebook),
      ]),
    };
  }
  const source = record(value, "Backup");
  if (source.version !== 2)
    throw new Error("This backup has an unsupported or missing version.");
  if (!Array.isArray(source.notes))
    throw new Error("Backup notes must be an array.");
  const notes = source.notes.map(validateNote);
  assertUniqueIds(notes);
  const notebooks = strings(source.notebooks, "Backup notebooks");
  return {
    version: 2,
    notes,
    notebooks: unique([
      "Personal",
      ...notebooks,
      ...notes.map((note) => note.notebook),
    ]),
  };
}

function assertUniqueIds(notes: Note[]): void {
  if (new Set(notes.map((note) => note.id)).size !== notes.length) {
    throw new Error(
      "The backup contains duplicate note IDs. No notes were imported.",
    );
  }
}

export function parseBackup(raw: string): Workspace {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The backup is not valid JSON.");
  }
  return validateWorkspace(value);
}

export function serializeBackup(workspace: Workspace): string {
  return JSON.stringify(validateWorkspace(workspace), null, 2);
}

export function saveWorkspace(workspace: Workspace): void {
  // Let quota and access failures reach the caller so the UI cannot claim an unsaved note is safe.
  localStorage.setItem(STORAGE_KEY, serializeBackup(workspace));
}

function preserveRecoveryCopy(storage: Storage, raw: string): boolean {
  try {
    const suffix =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.setItem(`${STORAGE_KEY}.recovery.${suffix}`, raw);
    return true;
  } catch {
    return false;
  }
}

export function loadWorkspace(): {
  workspace: Workspace;
  error: string | null;
} {
  let storage: Storage;
  let raw: string | null;
  let legacy: string | null;
  try {
    storage = localStorage;
    raw = storage.getItem(STORAGE_KEY);
    legacy = raw === null ? storage.getItem("notes") : null;
  } catch (error) {
    return {
      workspace: freshWorkspace(),
      error: `Browser storage is unavailable. ${errorMessage(error)}`,
    };
  }

  const stored = raw ?? legacy;
  if (stored === null) return { workspace: freshWorkspace(), error: null };

  let workspace: Workspace;
  try {
    workspace = parseBackup(stored);
  } catch (error) {
    const copied = preserveRecoveryCopy(storage, stored);
    return {
      workspace: freshWorkspace(),
      error: `Your saved notes could not be read. ${errorMessage(error)} The original data was left untouched.${copied ? " A recovery copy was also saved in this browser." : ""}`,
    };
  }

  if (raw === null) {
    try {
      saveWorkspace(workspace);
    } catch (error) {
      return {
        workspace,
        error: `Your previous notes were loaded, but the upgraded workspace could not be saved. The original notes were left untouched. ${errorMessage(error)}`,
      };
    }
  }
  return { workspace, error: null };
}

export function mergeWorkspaces(
  current: Workspace,
  incoming: Workspace,
): Workspace {
  const first = validateWorkspace(current);
  const second = validateWorkspace(incoming);
  const notes = new Map(first.notes.map((note) => [note.id, note]));
  for (const note of second.notes) {
    const existing = notes.get(note.id);
    if (
      !existing ||
      Date.parse(note.updatedAt) > Date.parse(existing.updatedAt)
    )
      notes.set(note.id, note);
  }
  return {
    version: 2,
    notes: [...notes.values()],
    notebooks: unique([...first.notebooks, ...second.notebooks]),
  };
}

export function plainText(html: string): string {
  const element = document.createElement("div");
  element.innerHTML = sanitizeHtml(html);
  element.querySelectorAll("br").forEach((node) => node.replaceWith(" "));
  element
    .querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre")
    .forEach((node) => node.append(" "));
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}
