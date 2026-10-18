import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  FileText,
  FileDown,
  FolderOpen,
  Hash,
  LayoutTemplate,
  Leaf,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  NotebookPen,
  Pencil,
  PenTool,
  Pin,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import Dialog from "./components/Dialog";
import InkPreview from "./components/InkPreview";
import {
  STORAGE_KEY,
  createNote,
  loadWorkspace,
  mergeWorkspaces,
  parseBackup,
  plainText,
  saveWorkspace,
  serializeBackup,
  type Note,
  type NoteColor,
} from "./lib/workspace";

const RichTextEditor = lazy(() => import("./components/RichTextEditor"));
const SketchEditor = lazy(() => import("./components/SketchEditor"));
const modifierLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

type View = "all" | "favorites" | "archive" | "trash" | "notebook" | "tag";
type Sort = "updated" | "created" | "title";
type Modal =
  | { kind: "templates" | "shortcuts" | "empty-trash" | "recover" | "delete" }
  | { kind: "notebook" | "delete-notebook"; name?: string }
  | null;
type Toast = {
  id: number;
  message: string;
  error?: boolean;
  action?: () => void;
  actionLabel?: string;
};
const colors: { value: NoteColor; label: string; hex: string }[] = [
  { value: "default", label: "Paper", hex: "#f3f1e9" },
  { value: "sage", label: "Sage", hex: "#dce9d9" },
  { value: "sand", label: "Sand", hex: "#f1e5c9" },
  { value: "rose", label: "Rose", hex: "#f3dce0" },
  { value: "blue", label: "Sky", hex: "#dce8f1" },
  { value: "lavender", label: "Lavender", hex: "#e6def1" },
];
const templates = [
  {
    name: "Handwritten note",
    description: "A fresh sheet for your pen. No typing needed.",
    icon: PenTool,
    content: "",
    title: "",
  },
  {
    name: "Daily journal",
    description: "Check in, reflect, and find your focus.",
    icon: Sun,
    title: "Daily journal",
    content:
      "<h2>Today, I’m feeling…</h2><p></p><h2>Three things I’m grateful for</h2><ol><li><p></p></li><li><p></p></li><li><p></p></li></ol><h2>One thing to focus on</h2><p></p><h2>A moment worth keeping</h2><p></p>",
  },
  {
    name: "Meeting notes",
    description: "Good conversations, clear next steps.",
    icon: BookOpen,
    title: "Meeting notes",
    content:
      '<h2>Meeting details</h2><p>Date: </p><p>Attendees: </p><h2>Agenda</h2><ul><li><p></p></li></ul><h2>Discussion & decisions</h2><p></p><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Next step</p></div></li></ul>',
  },
  {
    name: "Project plan",
    description: "Turn the next big idea into a plan.",
    icon: Sparkles,
    title: "Project plan",
    content:
      "<h2>The idea</h2><p>What are we making, and why?</p><h2>What success looks like</h2><p></p><h2>Milestones</h2><ol><li><p>Explore</p></li><li><p>Build</p></li><li><p>Launch</p></li></ol><h2>Notes & resources</h2><p></p>",
  },
];

function preference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fileName(title: string) {
  return (
    (title.trim() || "Untitled")
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .slice(0, 90) || "note"
  );
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function dateLabel(value: string) {
  const date = new Date(value),
    today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}
function handwrittenTitle() {
  const now = new Date();
  return `Note · ${now.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
function inkStrokeCount(data: string) {
  if (!data) return 0;
  try {
    const document = JSON.parse(data);
    const strokes = Array.isArray(document)
      ? document
      : (document.strokes ?? document.lines ?? document.paths);
    return Array.isArray(strokes) ? strokes.length : 0;
  } catch {
    return 0;
  }
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [initial] = useState(() => {
    const loaded = loadWorkspace();
    let storageSnapshot: string | null | undefined;
    try {
      storageSnapshot = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* loadWorkspace supplies the storage error. */
    }
    return { ...loaded, storageSnapshot };
  });
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      initial.workspace.notes.find((note) => !note.deletedAt && !note.archived)
        ?.id || null,
  );
  const [view, setView] = useState<View>("all");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [tab, setTab] = useState<"text" | "sketch">("sketch");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const pendingEditor = useRef<{ id: string; tab: "text" | "sketch" } | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [notebookName, setNotebookName] = useState("");
  const [formError, setFormError] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [theme, setTheme] = useState(() =>
    preference(
      "noteflow.theme",
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    ),
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [storageError, setStorageError] = useState(initial.error);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const workspaceRef = useRef(workspace);
  const writable = useRef(!initial.error);
  const dirty = useRef(false);
  const remoteUpdate = useRef(false);
  const storageBaseline = useRef(initial.storageSnapshot);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const activeNote = workspace.notes.find((note) => note.id === selectedId);
  const readOnly = !!activeNote?.deletedAt;
  workspaceRef.current = workspace;

  const notify = useCallback(
    (message: string, options: Omit<Toast, "id" | "message"> = {}) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [
        ...current.slice(-2),
        { id, message, ...options },
      ]);
      setTimeout(
        () =>
          setToasts((current) => current.filter((toast) => toast.id !== id)),
        options.action ? 7000 : 4500,
      );
    },
    [],
  );

  const persist = useCallback(() => {
    if (!writable.current) return false;
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      if (
        storageBaseline.current !== undefined &&
        currentRaw !== storageBaseline.current
      ) {
        writable.current = false;
        setSaveState("error");
        setStorageError(
          "Another tab saved changes before this note could be saved. Export your current notes, then recover storage to keep this version.",
        );
        return false;
      }
      saveWorkspace(workspaceRef.current);
      storageBaseline.current = localStorage.getItem(STORAGE_KEY);
      dirty.current = false;
      setSaveState("saved");
      setStorageError(null);
      return true;
    } catch (error) {
      setSaveState("error");
      setStorageError(
        error instanceof Error
          ? error.message
          : "Browser storage is unavailable. Download a backup to keep your changes.",
      );
      return false;
    }
  }, []);

  useEffect(() => {
    if (remoteUpdate.current) {
      remoteUpdate.current = false;
      dirty.current = false;
      setSaveState("saved");
      return;
    }
    dirty.current = true;
    if (!writable.current) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(persist, 450);
    return () => clearTimeout(timer);
  }, [workspace, persist]);
  useEffect(() => {
    const flush = () => {
      if (dirty.current && writable.current) persist();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", beforeUnload);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      try {
        // A queued event may already have been superseded by a later write.
        if (event.newValue !== localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        writable.current = false;
        setSaveState("error");
        setStorageError(
          "Browser storage became unavailable. Export your notes before closing this tab.",
        );
        return;
      }
      if (dirty.current || !event.newValue) {
        writable.current = false;
        setStorageError(
          "The workspace changed in another tab. Export your current notes before reloading, or use Recover storage to keep this version.",
        );
        setSaveState("error");
        return;
      }
      try {
        const incoming = parseBackup(event.newValue);
        storageBaseline.current = event.newValue;
        remoteUpdate.current = true;
        workspaceRef.current = incoming;
        setWorkspace(incoming);
        notify("Workspace updated from another tab.");
      } catch {
        writable.current = false;
        setSaveState("error");
        setStorageError(
          "Changes from another tab could not be read. The stored data was left untouched. Export a backup before recovering storage.",
        );
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("storage", onStorage);
    };
  }, [persist, notify]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("noteflow.theme", theme);
    } catch {
      /* Notes storage errors have their own visible recovery flow. */
    }
  }, [theme]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => {
      if (sidebarRef.current)
        sidebarRef.current.inert = media.matches && !sidebarOpen;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [sidebarOpen]);
  useEffect(() => {
    setTab(
      pendingEditor.current?.id === selectedId
        ? pendingEditor.current.tab
        : "sketch",
    );
    pendingEditor.current = null;
    setDetailsOpen(false);
    setRenaming(false);
    setTagDraft("");
    setMenu(false);
  }, [selectedId]);
  useEffect(() => {
    document.title = `${activeNote?.title.trim() || "Noteflow"} — Noteflow`;
  }, [activeNote?.title]);
  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".dropdown-wrap"))
        setMenu(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        setMenu(false);
        setSidebarOpen(false);
        if (!document.querySelector('[role="dialog"]')) setFocused(false);
      }
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const activeNotes = workspace.notes.filter(
    (note) => !note.deletedAt && !note.archived,
  );
  const trashNotes = workspace.notes.filter((note) => note.deletedAt);
  const allTags = Array.from(
    new Set(activeNotes.flatMap((note) => note.tags)),
  ).sort((a, b) => a.localeCompare(b));
  const visibleNotes = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return workspace.notes
      .filter((note) => {
        if (view === "trash") {
          if (!note.deletedAt) return false;
        } else if (view === "archive") {
          if (note.deletedAt || !note.archived) return false;
        } else if (note.deletedAt || note.archived) return false;
        if (view === "favorites" && !note.favorite) return false;
        if (view === "notebook" && note.notebook !== filter) return false;
        if (view === "tag" && !note.tags.includes(filter)) return false;
        return (
          !term ||
          `${note.title} ${plainText(note.textContent)} ${note.tags.join(" ")} ${note.notebook}`
            .toLocaleLowerCase()
            .includes(term)
        );
      })
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          (sort === "title"
            ? (a.title || "Untitled").localeCompare(b.title || "Untitled")
            : new Date(
                b[sort === "created" ? "createdAt" : "updatedAt"],
              ).getTime() -
              new Date(
                a[sort === "created" ? "createdAt" : "updatedAt"],
              ).getTime()),
      );
  }, [workspace.notes, view, filter, query, sort]);
  const viewTitle =
    view === "all"
      ? "All notes"
      : view === "favorites"
        ? "Favorites"
        : view === "archive"
          ? "Archive"
          : view === "trash"
            ? "Trash"
            : view === "tag"
              ? `#${filter}`
              : filter;
  useEffect(() => {
    if (!visibleNotes.some((note) => note.id === selectedId))
      setSelectedId(visibleNotes[0]?.id || null);
  }, [visibleNotes, selectedId]);

  const navigate = (next: View, value = "") => {
    setView(next);
    setFilter(value);
    setQuery("");
    setSidebarOpen(false);
    setMobileDetail(false);
    setFocused(false);
  };
  const updateNote = (id: string, patch: Partial<Note>) =>
    setWorkspace((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === id
          ? { ...note, ...patch, updatedAt: new Date().toISOString() }
          : note,
      ),
    }));
  const newNote = useCallback(
    (template = templates[0]) => {
      const note = createNote({
        title: template.title || handwrittenTitle(),
        textContent: template.content,
        notebook: view === "notebook" ? filter : "Personal",
        tags: view === "tag" ? [filter] : [],
      });
      setWorkspace((current) => ({
        ...current,
        notes: [note, ...current.notes],
        notebooks: Array.from(new Set([...current.notebooks, note.notebook])),
      }));
      setView(view === "notebook" || view === "tag" ? view : "all");
      setQuery("");
      pendingEditor.current = {
        id: note.id,
        tab: template.content ? "text" : "sketch",
      };
      setSelectedId(note.id);
      setTab(template.content ? "text" : "sketch");
      setMobileDetail(true);
      setSidebarOpen(false);
      setModal(null);
    },
    [view, filter],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (persist()) notify("All changes saved.");
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newNote();
      } else if (
        event.key.toLowerCase() === "k" ||
        (event.shiftKey && event.key.toLowerCase() === "f")
      ) {
        event.preventDefault();
        setFocused(false);
        setMobileDetail(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newNote, persist, notify]);

  const toggleFavorite = () => {
    if (activeNote)
      updateNote(activeNote.id, { favorite: !activeNote.favorite });
  };
  const archiveNote = () => {
    if (!activeNote) return;
    const { id, archived } = activeNote;
    updateNote(id, { archived: !archived });
    setMenu(false);
    notify(archived ? "Note moved back to all notes." : "Note archived.", {
      actionLabel: "Undo",
      action: () => updateNote(id, { archived }),
    });
  };
  const trashNote = () => {
    if (!activeNote) return;
    const { id } = activeNote;
    updateNote(id, { deletedAt: new Date().toISOString() });
    setMenu(false);
    notify("Note moved to trash.", {
      actionLabel: "Undo",
      action: () => updateNote(id, { deletedAt: null }),
    });
  };
  const duplicateNote = () => {
    if (!activeNote) return;
    const copy = createNote({
      ...activeNote,
      id: crypto.randomUUID(),
      title: `${activeNote.title || "Untitled"} (copy)`,
      deletedAt: null,
      archived: false,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setWorkspace((current) => ({
      ...current,
      notes: [copy, ...current.notes],
    }));
    setView("all");
    setQuery("");
    setSelectedId(copy.id);
    setMobileDetail(true);
    setMenu(false);
    notify("Note duplicated.");
  };
  const addTags = () => {
    if (!activeNote || readOnly) return;
    const incoming = tagDraft
      .split(",")
      .map((tag) => tag.trim().replace(/^#+/, "").slice(0, 32))
      .filter(Boolean);
    if (incoming.length)
      updateNote(activeNote.id, {
        tags: Array.from(new Set([...activeNote.tags, ...incoming])).slice(
          0,
          20,
        ),
      });
    setTagDraft("");
  };
  const exportAll = () => {
    download(
      `noteflow-backup-${new Date().toLocaleDateString("en-CA")}.json`,
      serializeBackup(workspaceRef.current),
    );
    notify("Workspace backup downloaded.");
  };
  const downloadPdf = async () => {
    if (!activeNote || pdfExporting) return;
    const note = activeNote;
    setPdfExporting(true);
    setMenu(false);
    try {
      const { exportNotePdf } = await import("./lib/exportPdf");
      await exportNotePdf(note);
      notify("PDF downloaded.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not export this note. Please try again.",
        { error: true },
      );
    } finally {
      setPdfExporting(false);
    }
  };
  const exportNote = (format: "json" | "txt" | "html") => {
    if (!activeNote) return;
    const title = activeNote.title.trim() || "Untitled";
    const body =
      format === "json"
        ? serializeBackup({
            version: 2,
            notes: [activeNote],
            notebooks: [activeNote.notebook],
          })
        : format === "txt"
          ? `${title}\n${"=".repeat(Math.min(title.length, 80))}\n\n${plainText(activeNote.textContent)}`
          : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:17px/1.8 system-ui;max-width:760px;margin:60px auto;padding:24px;color:#253b31}h1{line-height:1.2}pre{white-space:pre-wrap;background:#f2f4f1;padding:18px}blockquote{border-left:3px solid #648772;padding-left:18px}input{margin-right:8px}ul[data-type=taskList]{list-style:none}</style></head><body><h1>${escapeHtml(title)}</h1>${activeNote.textContent}</body></html>`;
    download(
      `${fileName(title)}.${format}`,
      body,
      format === "json"
        ? "application/json"
        : format === "txt"
          ? "text/plain;charset=utf-8"
          : "text/html;charset=utf-8",
    );
    setMenu(false);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Choose a file smaller than 20 MB.");
      const raw = await file.text();
      if (/\.(txt|md)$/i.test(file.name)) {
        const note = createNote({
          title: file.name.replace(/\.[^.]+$/, ""),
          textContent: raw
            .split(/\r?\n/)
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join(""),
        });
        setWorkspace((current) => ({
          ...current,
          notes: [note, ...current.notes],
        }));
        setView("all");
        setQuery("");
        pendingEditor.current = { id: note.id, tab: "text" };
        setSelectedId(note.id);
        setMobileDetail(true);
        notify("Text file imported.");
      } else {
        const incoming = parseBackup(raw);
        setWorkspace((current) => mergeWorkspaces(current, incoming));
        setView("all");
        setQuery("");
        setSelectedId(
          incoming.notes.find((note) => !note.deletedAt && !note.archived)
            ?.id || null,
        );
        notify(
          `Imported ${incoming.notes.length} ${incoming.notes.length === 1 ? "note" : "notes"}. Existing newer notes were kept.`,
        );
      }
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This file could not be imported.",
        { error: true },
      );
    }
    if (importRef.current) importRef.current.value = "";
  };
  const openNotebookModal = (name?: string) => {
    setNotebookName(name || "");
    setFormError("");
    setModal({ kind: "notebook", name });
  };
  const saveNotebook = () => {
    const name = notebookName.trim().slice(0, 50);
    if (!name) {
      setFormError("Give your notebook a name.");
      return;
    }
    const oldName = modal?.kind === "notebook" ? modal.name : undefined;
    if (
      workspace.notebooks.some(
        (item) => item.toLowerCase() === name.toLowerCase() && item !== oldName,
      )
    ) {
      setFormError("A notebook with that name already exists.");
      return;
    }
    setWorkspace((current) => ({
      ...current,
      notebooks: oldName
        ? current.notebooks.map((item) => (item === oldName ? name : item))
        : [...current.notebooks, name],
      notes: oldName
        ? current.notes.map((note) =>
            note.notebook === oldName
              ? { ...note, notebook: name, updatedAt: new Date().toISOString() }
              : note,
          )
        : current.notes,
    }));
    if (oldName && filter === oldName && view === "notebook") setFilter(name);
    setModal(null);
    notify(oldName ? "Notebook renamed." : "Notebook created.");
  };
  const recoverStorage = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(`noteflow.recovery.${Date.now()}`, raw);
      storageBaseline.current = raw;
      writable.current = true;
      if (!persist()) {
        writable.current = false;
        return;
      }
      setModal(null);
      notify(
        "Storage recovered. Your previous data was kept in a recovery copy.",
      );
    } catch {
      notify(
        "Could not create a recovery copy. Download your backup, then free some browser storage and try again.",
        { error: true },
      );
    }
  };
  const wordCount = activeNote
    ? plainText(activeNote.textContent).trim().split(/\s+/).filter(Boolean)
        .length
    : 0;
  const navItems: {
    key: View;
    label: string;
    icon: typeof FileText;
    count: number;
  }[] = [
    {
      key: "all",
      label: "All notes",
      icon: FileText,
      count: activeNotes.length,
    },
    {
      key: "favorites",
      label: "Favorites",
      icon: Star,
      count: activeNotes.filter((note) => note.favorite).length,
    },
    {
      key: "archive",
      label: "Archive",
      icon: Archive,
      count: workspace.notes.filter((note) => note.archived && !note.deletedAt)
        .length,
    },
    { key: "trash", label: "Trash", icon: Trash2, count: trashNotes.length },
  ];

  return (
    <div className={`app-shell ${focused ? "is-focused" : ""}`}>
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        aria-label="Workspace navigation"
      >
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("all");
          }}
        >
          <span className="brand-icon">
            <NotebookPen size={24} strokeWidth={1.7} />
          </span>
          <span>
            <span className="brand-name">
              noteflow<span className="brand-period">.</span>
            </span>
            <span className="brand-tagline">Room for your thoughts</span>
          </span>
        </a>
        <button className="new-note-button" onClick={() => newNote()}>
          <Plus size={18} />
          <span>New note</span>
          <span className="keyboard-hint">{modifierLabel} N</span>
        </button>
        <div className="sidebar-section">
          <div className="section-heading">WORKSPACE</div>
          <nav aria-label="Notes views">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={`nav-item ${view === item.key ? "active" : ""}`}
                onClick={() => navigate(item.key)}
              >
                <item.icon className="nav-icon" size={18} />
                <span>{item.label}</span>
                <span className="nav-count">{item.count}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-section">
          <div className="section-heading">
            <span>NOTEBOOKS</span>
            <button
              className="section-action"
              aria-label="Create notebook"
              title="Create notebook"
              onClick={() => openNotebookModal()}
            >
              <Plus size={16} />
            </button>
          </div>
          <nav aria-label="Notebooks">
            {workspace.notebooks.map((name, index) => (
              <div className="notebook-row" key={name}>
                <button
                  className={`nav-item ${view === "notebook" && filter === name ? "active" : ""}`}
                  onClick={() => navigate("notebook", name)}
                >
                  <span
                    className="notebook-dot"
                    style={{
                      background: ["#88a283", "#c7a679", "#a695bb", "#83a7b6"][
                        index % 4
                      ],
                    }}
                  />
                  <span>{name}</span>
                  <span className="nav-count">
                    {
                      activeNotes.filter((note) => note.notebook === name)
                        .length
                    }
                  </span>
                </button>
                {name !== "Personal" && (
                  <button
                    className="notebook-edit section-action"
                    aria-label={`Edit ${name} notebook`}
                    title={`Edit ${name} notebook`}
                    onClick={() => openNotebookModal(name)}
                  >
                    <Ellipsis size={15} />
                  </button>
                )}
              </div>
            ))}
          </nav>
        </div>
        <div className="sidebar-section">
          <div className="section-heading">
            TAGS<span className="tag-total">{allTags.length}</span>
          </div>
          <div className="tag-cloud">
            {allTags.length ? (
              allTags.map((tag) => (
                <button
                  key={tag}
                  className={`tag-filter ${view === "tag" && filter === tag ? "active" : ""}`}
                  onClick={() => navigate("tag", tag)}
                >
                  # {tag}
                </button>
              ))
            ) : (
              <p className="sidebar-hint">
                Add a tag to any note to find it here.
              </p>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className="template-link"
            onClick={() => setModal({ kind: "templates" })}
          >
            <LayoutTemplate size={17} />
            Explore templates
            <ChevronRight size={15} />
          </button>
          <div className="local-status">
            <ShieldCheck size={17} />
            <div>
              <strong>Yours. Just yours.</strong>
              <span>Saved locally in this browser</span>
            </div>
          </div>
          <div className="sidebar-tools">
            <IconButton
              label={
                theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>
            <IconButton
              label="Import notes"
              onClick={() => importRef.current?.click()}
            >
              <ArrowUpFromLine size={17} />
            </IconButton>
            <IconButton label="Export workspace backup" onClick={exportAll}>
              <ArrowDownToLine size={17} />
            </IconButton>
            <IconButton
              label="Help and keyboard shortcuts"
              onClick={() => setModal({ kind: "shortcuts" })}
            >
              <Settings2 size={17} />
            </IconButton>
            <span className="app-version">v1.1</span>
          </div>
        </div>
      </aside>
      <main
        className={`workspace ${mobileDetail && activeNote ? "has-selection" : ""}`}
      >
        <section className="notes-panel" aria-label="Notes list">
          <div className="list-header">
            <div className="header-row">
              <span className="eyebrow">A LITTLE SPACE FOR YOUR MIND</span>
              <button
                className="mobile-menu-button icon-button"
                aria-label="Open navigation"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu size={20} />
              </button>
            </div>
            <div className="header-row">
              <h1>
                {viewTitle}
                <span className="heading-count">{visibleNotes.length}</span>
              </h1>
              <IconButton label="Create a note" onClick={() => newNote()}>
                <Pencil size={18} />
              </IconButton>
            </div>
            <label className="search-field">
              <Search size={17} className="search-icon" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your notes…"
                aria-label="Search notes"
              />
              <span className="search-shortcut">{modifierLabel} K</span>
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={14} />
                </button>
              )}
            </label>
            <div className="filter-row">
              <span>
                {query
                  ? "SEARCH RESULTS"
                  : view === "trash"
                    ? "DELETED NOTES"
                    : "YOUR NOTES"}
              </span>
              <label className="sort-control">
                <select
                  className="sort-select"
                  aria-label="Sort notes"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="updated">Last edited</option>
                  <option value="created">Date created</option>
                  <option value="title">Title A–Z</option>
                </select>
                <ChevronDown size={12} />
              </label>
            </div>
          </div>
          {view === "trash" && trashNotes.length > 0 && (
            <div className="trash-notice">
              <span>Notes stay here until you delete them.</span>
              <button onClick={() => setModal({ kind: "empty-trash" })}>
                Empty trash
              </button>
            </div>
          )}
          <div className="note-list">
            {visibleNotes.map((note) => (
              <button
                key={note.id}
                className={`note-card ${selectedId === note.id ? "selected" : ""} ${note.pinned ? "pinned" : ""}`}
                data-color={note.color}
                aria-pressed={selectedId === note.id}
                onClick={() => {
                  setSelectedId(note.id);
                  setMobileDetail(true);
                }}
              >
                <div className="note-card-top">
                  <span className="note-notebook">
                    <span className="small-dot" />
                    {note.notebook}
                  </span>
                  <span className="note-card-icons">
                    {note.favorite && (
                      <Star
                        size={12}
                        fill="currentColor"
                        aria-label="Favorite"
                      />
                    )}
                    {note.pinned && <Pin size={12} aria-label="Pinned" />}
                    {inkStrokeCount(note.sketchData) > 0 && (
                      <PenTool size={12} aria-label="Has handwriting" />
                    )}
                  </span>
                </div>
                <h2 className="note-card-title">
                  {note.title.trim() || "Untitled note"}
                </h2>
                {inkStrokeCount(note.sketchData) > 0 ? (
                  <InkPreview data={note.sketchData} />
                ) : (
                  <p className="note-card-preview">
                    {plainText(note.textContent) ||
                      (inkStrokeCount(note.sketchData) > 0
                        ? "Handwritten notes. Open to see your writing."
                        : "A fresh page, ready for your handwriting…")}
                  </p>
                )}
                <div className="note-card-bottom">
                  <span className="note-date">{dateLabel(note.updatedAt)}</span>
                  <span className="note-tags">
                    {note.tags.slice(0, 2).map((tag) => (
                      <span className="note-tag" key={tag}>
                        #{tag}
                      </span>
                    ))}
                    {note.tags.length > 2 && (
                      <span className="note-tag">+{note.tags.length - 2}</span>
                    )}
                  </span>
                </div>
              </button>
            ))}
            {!visibleNotes.length && (
              <div className="list-empty">
                <Search size={28} strokeWidth={1.4} />
                <h3>
                  {query
                    ? "No matching notes"
                    : view === "trash"
                      ? "A clean slate"
                      : view === "archive"
                        ? "Nothing archived"
                        : "Room for something new"}
                </h3>
                <p>
                  {query
                    ? "Try a different title, tag, or phrase."
                    : view === "trash"
                      ? "Deleted notes will appear here."
                      : "Your next thought can start right here."}
                </p>
                {query ? (
                  <button
                    className="secondary-button"
                    onClick={() => setQuery("")}
                  >
                    Clear search
                  </button>
                ) : (
                  view !== "trash" &&
                  view !== "archive" && (
                    <button
                      className="secondary-button"
                      onClick={() => newNote()}
                    >
                      <Plus size={15} />
                      New note
                    </button>
                  )
                )}
              </div>
            )}
          </div>
          <div className="list-footer">
            <Leaf size={13} />
            <span>A place for every little thought.</span>
          </div>
        </section>
        <section
          className={`editor-pane ${tab === "sketch" ? "is-handwriting" : ""}`}
          aria-label={activeNote ? "Note editor" : "Select a note"}
          data-color={activeNote?.color || "default"}
        >
          {storageError && (
            <div className="storage-banner" role="alert">
              <span>
                <strong>Saving paused.</strong> {storageError}
              </span>
              <div>
                <button onClick={exportAll}>Download backup</button>
                <button onClick={() => setModal({ kind: "recover" })}>
                  Recover storage
                </button>
              </div>
            </div>
          )}
          {activeNote ? (
            <>
              <header className="editor-header">
                <div className="editor-breadcrumb">
                  <button
                    className="editor-back icon-button"
                    aria-label="Back to notes"
                    onClick={() => {
                      setMobileDetail(false);
                      setFocused(false);
                    }}
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <FolderOpen size={16} />
                  <span>{activeNote.notebook}</span>
                  <ChevronRight size={12} />
                  <span className="breadcrumb-current">
                    {readOnly ? "Trash" : "Note"}
                  </span>
                </div>
                <div className="editor-actions">
                  <button
                    className="secondary-button small-button pdf-export-button"
                    aria-label={pdfExporting ? "Exporting PDF" : "Export PDF"}
                    disabled={pdfExporting}
                    onClick={() => void downloadPdf()}
                  >
                    <FileDown size={16} />
                    <span>{pdfExporting ? "Exporting…" : "Export PDF"}</span>
                  </button>
                  {!readOnly && (
                    <>
                      <IconButton
                        label={
                          activeNote.favorite
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                        active={activeNote.favorite}
                        onClick={toggleFavorite}
                      >
                        <Star
                          size={18}
                          fill={activeNote.favorite ? "currentColor" : "none"}
                        />
                      </IconButton>
                      <IconButton
                        label={activeNote.pinned ? "Unpin note" : "Pin note"}
                        active={activeNote.pinned}
                        onClick={() =>
                          updateNote(activeNote.id, {
                            pinned: !activeNote.pinned,
                          })
                        }
                      >
                        <Pin size={18} />
                      </IconButton>
                    </>
                  )}
                  <IconButton
                    label={focused ? "Exit focus mode" : "Enter focus mode"}
                    active={focused}
                    onClick={() => setFocused(!focused)}
                  >
                    {focused ? (
                      <Minimize2 size={18} />
                    ) : (
                      <Maximize2 size={18} />
                    )}
                  </IconButton>
                  {readOnly ? (
                    <>
                      <button
                        className="secondary-button small-button"
                        onClick={() => {
                          updateNote(activeNote.id, { deletedAt: null });
                          notify("Note restored.");
                        }}
                      >
                        <RotateCcw size={15} />
                        Restore
                      </button>
                      <IconButton
                        label="Delete note permanently"
                        onClick={() => setModal({ kind: "delete" })}
                      >
                        <Trash2 size={17} />
                      </IconButton>
                    </>
                  ) : (
                    <div className="dropdown-wrap">
                      <button
                        className={`icon-button ${menu ? "active" : ""}`}
                        aria-label="More note actions"
                        aria-expanded={menu}
                        onClick={() => setMenu(!menu)}
                      >
                        <Ellipsis size={20} />
                      </button>
                      {menu && (
                        <div className="dropdown-menu">
                          <div className="menu-label">NOTE COLOR</div>
                          <div className="color-options">
                            {colors.map((color) => (
                              <button
                                key={color.value}
                                className={`color-option ${activeNote.color === color.value ? "selected" : ""}`}
                                style={{ background: color.hex }}
                                aria-label={`Set color to ${color.label}`}
                                aria-pressed={activeNote.color === color.value}
                                onClick={() =>
                                  updateNote(activeNote.id, {
                                    color: color.value,
                                  })
                                }
                              >
                                {activeNote.color === color.value && (
                                  <Check size={13} color="#263d31" />
                                )}
                              </button>
                            ))}
                          </div>
                          <div className="menu-separator" />
                          <button
                            className="dropdown-item"
                            onClick={duplicateNote}
                          >
                            <Copy size={15} />
                            Duplicate note
                          </button>
                          <button
                            className="dropdown-item"
                            onClick={archiveNote}
                          >
                            <Archive size={15} />
                            {activeNote.archived
                              ? "Unarchive note"
                              : "Archive note"}
                          </button>
                          <div className="menu-separator" />
                          <button
                            className="dropdown-item"
                            disabled={pdfExporting}
                            onClick={() => void downloadPdf()}
                          >
                            <FileDown size={15} />
                            Download PDF
                          </button>
                          <button
                            className="dropdown-item"
                            onClick={() => exportNote("json")}
                          >
                            <Download size={15} />
                            Download note (.json)
                          </button>
                          <button
                            className="dropdown-item"
                            onClick={() => exportNote("txt")}
                          >
                            <FileText size={15} />
                            Download text (.txt)
                          </button>
                          <button
                            className="dropdown-item"
                            onClick={() => exportNote("html")}
                          >
                            <BookOpen size={15} />
                            Download text (.html)
                          </button>
                          <button
                            className="dropdown-item"
                            onClick={() => {
                              setMenu(false);
                              window.print();
                            }}
                          >
                            <Printer size={15} />
                            Print current view
                          </button>
                          <div className="menu-separator" />
                          <button
                            className="dropdown-item danger"
                            onClick={trashNote}
                          >
                            <Trash2 size={15} />
                            Move to trash
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </header>
              {readOnly && (
                <div className="note-notice">
                  <Trash2 size={15} />
                  This note is in the trash. Restore it to keep editing.
                </div>
              )}
              {activeNote.archived && !readOnly && (
                <div className="note-notice">
                  <Archive size={15} />
                  This note is archived.
                  <button onClick={archiveNote}>Move to all notes</button>
                </div>
              )}
              <div className="editor-body">
                <div className="note-kicker">
                  {new Date(activeNote.createdAt).toLocaleDateString(
                    undefined,
                    {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}
                </div>
                <div className="handwriting-note-heading">
                  <input
                    ref={titleRef}
                    className="note-title-input"
                    aria-label="Note title"
                    placeholder="Untitled note"
                    value={activeNote.title}
                    onChange={(event) =>
                      updateNote(activeNote.id, { title: event.target.value })
                    }
                    maxLength={200}
                    readOnly={readOnly || (tab === "sketch" && !renaming)}
                    inputMode={tab === "sketch" && !renaming ? "none" : "text"}
                    onBlur={() => setRenaming(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  {tab === "sketch" && (
                    <div className="handwriting-heading-actions">
                      <span className="handwriting-badge">
                        <PenTool size={13} />
                        Stylus notebook
                      </span>
                      {!readOnly && (
                        <IconButton
                          label="Rename note"
                          onClick={() => {
                            setRenaming(true);
                            requestAnimationFrame(() =>
                              titleRef.current?.focus(),
                            );
                          }}
                        >
                          <Pencil size={15} />
                        </IconButton>
                      )}
                      <IconButton
                        label="Note details"
                        active={detailsOpen}
                        onClick={() => setDetailsOpen(!detailsOpen)}
                      >
                        <Settings2 size={16} />
                      </IconButton>
                    </div>
                  )}
                </div>
                <div
                  className="note-details"
                  id="note-details"
                  hidden={tab === "sketch" && !detailsOpen}
                >
                  <div className="note-metadata">
                    <label className="metadata-field">
                      <BookOpen size={14} />
                      <select
                        aria-label="Note notebook"
                        className="notebook-select"
                        disabled={readOnly}
                        value={activeNote.notebook}
                        onChange={(event) =>
                          updateNote(activeNote.id, {
                            notebook: event.target.value,
                          })
                        }
                      >
                        {workspace.notebooks.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <span className="metadata-dot">·</span>
                    <span className="metadata-updated">
                      Edited {dateLabel(activeNote.updatedAt).toLowerCase()}
                    </span>
                  </div>
                  <div className="tag-input-row">
                    <Hash size={14} />
                    {activeNote.tags.map((tag) => (
                      <span className="tag-pill" key={tag}>
                        {tag}
                        {!readOnly && (
                          <button
                            className="tag-remove"
                            aria-label={`Remove tag ${tag}`}
                            onClick={() =>
                              updateNote(activeNote.id, {
                                tags: activeNote.tags.filter(
                                  (item) => item !== tag,
                                ),
                              })
                            }
                          >
                            <X size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                    {!readOnly && activeNote.tags.length < 20 && (
                      <input
                        className="tag-input"
                        aria-label="Add tags"
                        placeholder={
                          activeNote.tags.length ? "+ Add tag" : "Add tags…"
                        }
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        onBlur={addTags}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === ",") {
                            event.preventDefault();
                            addTags();
                          }
                          if (event.key === "Escape") setTagDraft("");
                        }}
                      />
                    )}
                  </div>
                </div>
                <div
                  className="editor-tabs"
                  role="tablist"
                  aria-label="Note content"
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? "sketch"
                        : event.key === "End"
                          ? "text"
                          : tab === "text"
                            ? "sketch"
                            : "text";
                    setTab(next);
                    document.getElementById(`${next}-tab`)?.focus();
                  }}
                >
                  <button
                    className={`editor-tab ${tab === "sketch" ? "active" : ""}`}
                    role="tab"
                    id="sketch-tab"
                    aria-controls="sketch-panel"
                    aria-selected={tab === "sketch"}
                    tabIndex={tab === "sketch" ? 0 : -1}
                    onClick={() => setTab("sketch")}
                  >
                    <PenTool size={15} />
                    Handwrite
                    {inkStrokeCount(activeNote.sketchData) > 0 && (
                      <span className="tab-dot" />
                    )}
                  </button>
                  <button
                    className={`editor-tab ${tab === "text" ? "active" : ""}`}
                    role="tab"
                    id="text-tab"
                    aria-controls="text-panel"
                    aria-selected={tab === "text"}
                    tabIndex={tab === "text" ? 0 : -1}
                    onClick={() => setTab("text")}
                  >
                    <FileText size={15} />
                    Text
                  </button>
                  <span className="editor-tab-hint">
                    {tab === "sketch"
                      ? "Your pen. Your handwriting."
                      : "Optional typed notes"}
                  </span>
                </div>
                <div
                  className="content-area"
                  role="tabpanel"
                  id={tab === "text" ? "text-panel" : "sketch-panel"}
                  aria-labelledby={tab === "text" ? "text-tab" : "sketch-tab"}
                >
                  <div hidden={tab !== "sketch"}>
                    <Suspense
                      fallback={
                        <div className="editor-loading">
                          Opening your writing page…
                        </div>
                      }
                    >
                      <SketchEditor
                        key={activeNote.id}
                        data={activeNote.sketchData}
                        onChange={(data) =>
                          updateNote(activeNote.id, { sketchData: data })
                        }
                        readOnly={readOnly}
                      />
                    </Suspense>
                  </div>
                  {tab === "text" && (
                    <Suspense
                      fallback={
                        <div className="editor-loading">Opening your note…</div>
                      }
                    >
                      <RichTextEditor
                        key={activeNote.id}
                        content={activeNote.textContent}
                        onChange={(html) =>
                          updateNote(activeNote.id, { textContent: html })
                        }
                        readOnly={readOnly}
                      />
                    </Suspense>
                  )}
                </div>
              </div>
              <footer className="editor-footer">
                <span className={`save-state ${saveState}`} role="status">
                  {saveState === "saved" ? (
                    <CheckCheck size={14} />
                  ) : saveState === "error" ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <span className="status-indicator" />
                  )}
                  {saveState === "saved"
                    ? "All changes saved"
                    : saveState === "error"
                      ? "Changes need a backup"
                      : "Saving…"}
                </span>
                <div className="word-count">
                  <span>
                    {tab === "sketch"
                      ? `${inkStrokeCount(activeNote.sketchData)} ink strokes`
                      : `${wordCount} ${wordCount === 1 ? "word" : "words"}`}
                  </span>
                  <span className="footer-separator">·</span>
                  <span>
                    {tab === "sketch"
                      ? "Handwritten"
                      : `${Math.max(1, Math.ceil(wordCount / 200))} min read`}
                  </span>
                  <span className="footer-local">
                    <ShieldCheck size={12} />
                    On this device
                  </span>
                </div>
              </footer>
            </>
          ) : (
            <div className="empty-editor">
              <div className="empty-illustration">
                <NotebookPen size={54} strokeWidth={1.15} />
                <span className="empty-leaf">
                  <Leaf size={24} strokeWidth={1.4} />
                </span>
              </div>
              <span className="empty-eyebrow">A FRESH PAGE AWAITS</span>
              <h2 className="empty-title">
                Good ideas need
                <br />a place to land.
              </h2>
              <p className="empty-description">
                Pick up your stylus and write in your own hand.
                <br />
                Your notes save automatically as you write.
              </p>
              <div className="empty-actions">
                <button className="primary-button" onClick={() => newNote()}>
                  <Plus size={17} />
                  Create a note
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setModal({ kind: "templates" })}
                >
                  <LayoutTemplate size={17} />
                  Use a template
                </button>
              </div>
              <span className="empty-footnote">
                <ShieldCheck size={14} />
                Private by default. Saved in your browser.
              </span>
            </div>
          )}
        </section>
      </main>
      <input
        className="sr-only"
        type="file"
        ref={importRef}
        accept=".json,.txt,.md,application/json,text/plain,text/markdown"
        aria-label="Import notes file"
        onChange={(event) => void importFile(event.target.files?.[0])}
        tabIndex={-1}
      />
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast ${toast.error ? "error" : ""}`} key={toast.id}>
            {toast.error ? <ShieldCheck size={17} /> : <Check size={17} />}
            <span>{toast.message}</span>
            {toast.action && (
              <button
                className="toast-action"
                onClick={() => {
                  toast.action?.();
                  setToasts((current) =>
                    current.filter((item) => item.id !== toast.id),
                  );
                }}
              >
                {toast.actionLabel || "Undo"}
              </button>
            )}
            <button
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() =>
                setToasts((current) =>
                  current.filter((item) => item.id !== toast.id),
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {modal?.kind === "templates" && (
        <Dialog
          title="A starting point for your next idea"
          wide
          onClose={() => setModal(null)}
        >
          <div className="dialog-body">
            <p className="dialog-description">
              Skip the blank page. Make one of these your own.
            </p>
            <div className="template-grid">
              {templates.map((template) => (
                <button
                  key={template.name}
                  className="template-card"
                  onClick={() => newNote(template)}
                >
                  <span className="template-icon">
                    <template.icon size={23} strokeWidth={1.5} />
                  </span>
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                  <span className="template-use">
                    Use template
                    <ChevronRight size={14} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {modal?.kind === "notebook" && (
        <Dialog
          title={modal.name ? "Edit notebook" : "A new home for your notes"}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveNotebook();
            }}
          >
            <div className="dialog-body">
              <label className="form-label" htmlFor="notebook-name">
                Notebook name
              </label>
              <input
                id="notebook-name"
                data-autofocus
                className="dialog-input"
                placeholder="e.g. Weekend projects"
                value={notebookName}
                maxLength={50}
                onChange={(event) => {
                  setNotebookName(event.target.value);
                  setFormError("");
                }}
              />
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <p className="dialog-description">
                Keep related thoughts together. You can move notes between
                notebooks anytime.
              </p>
            </div>
            <div className="dialog-footer">
              {modal.name && modal.name !== "Personal" && (
                <button
                  type="button"
                  className="text-danger"
                  onClick={() =>
                    setModal({ kind: "delete-notebook", name: modal.name })
                  }
                >
                  Delete notebook
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit">
                {modal.name ? "Save changes" : "Create notebook"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal?.kind === "delete-notebook" && (
        <Dialog title="Delete this notebook?" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p>
              Notes in <strong>{modal.name}</strong> will move to Personal. Your
              notes will be kept.
            </p>
          </div>
          <div className="dialog-footer">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="primary-button danger-button"
              onClick={() => {
                const name = modal.name;
                setWorkspace((current) => ({
                  ...current,
                  notebooks: current.notebooks.filter((item) => item !== name),
                  notes: current.notes.map((note) =>
                    note.notebook === name
                      ? {
                          ...note,
                          notebook: "Personal",
                          updatedAt: new Date().toISOString(),
                        }
                      : note,
                  ),
                }));
                if (view === "notebook" && filter === name)
                  navigate("notebook", "Personal");
                setModal(null);
                notify("Notebook deleted. Its notes are in Personal.");
              }}
            >
              Delete notebook
            </button>
          </div>
        </Dialog>
      )}
      {(modal?.kind === "delete" || modal?.kind === "empty-trash") && (
        <Dialog
          title={
            modal.kind === "empty-trash"
              ? "Empty the trash?"
              : "Delete this note permanently?"
          }
          onClose={() => setModal(null)}
        >
          <div className="dialog-body">
            <p>
              {modal.kind === "empty-trash"
                ? `${trashNotes.length} deleted ${trashNotes.length === 1 ? "note will" : "notes will"} be removed from this browser.`
                : `“${activeNote?.title || "Untitled note"}” will be removed from this browser.`}{" "}
              This cannot be undone. Download a backup first if you’d like to
              keep a copy.
            </p>
          </div>
          <div className="dialog-footer">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="primary-button danger-button"
              onClick={() => {
                const all = modal.kind === "empty-trash";
                setWorkspace((current) => ({
                  ...current,
                  notes: current.notes.filter((note) =>
                    all ? !note.deletedAt : note.id !== selectedId,
                  ),
                }));
                setModal(null);
                notify(all ? "Trash emptied." : "Note permanently deleted.");
              }}
            >
              Delete permanently
            </button>
          </div>
        </Dialog>
      )}
      {modal?.kind === "recover" && (
        <Dialog title="Recover browser storage" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p>
              Keep the notes currently shown in this workspace and try saving
              again. The previous stored workspace will be copied to a separate
              recovery key first.
            </p>
            <p>
              Download a backup before continuing. If your browser is out of
              space, you may need to free storage before recovery works.
            </p>
            <button className="secondary-button" onClick={exportAll}>
              <Download size={16} />
              Download current notes
            </button>
          </div>
          <div className="dialog-footer">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="primary-button" onClick={recoverStorage}>
              Create recovery copy & retry
            </button>
          </div>
        </Dialog>
      )}
      {modal?.kind === "shortcuts" && (
        <Dialog title="Make yourself at home" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p className="dialog-description">
              A few shortcuts for a little more flow. Use ⌘ on Mac or Ctrl on
              Windows and Linux.
            </p>
            <p className="dialog-description">
              Use the page zoom controls to get closer, or choose Hand to move
              around. Pen, highlighter, and eraser each remember their own size.
              Choose Point eraser to remove part of a line, or Stroke eraser to
              remove the whole line.
            </p>
            <dl className="shortcut-list">
              <div>
                <dt>Create a note</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <kbd>N</kbd>
                </dd>
              </div>
              <div>
                <dt>Search notes</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <kbd>K</kbd>
                </dd>
              </div>
              <div>
                <dt>Save immediately</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <kbd>S</kbd>
                </dd>
              </div>
              <div>
                <dt>Bold / italic / underline</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <kbd>B / I / U</kbd>
                </dd>
              </div>
              <div>
                <dt>Pen / highlighter / eraser (on the page)</dt>
                <dd>
                  <kbd>P / H / E</kbd>
                </dd>
              </div>
              <div>
                <dt>Move the page (hold while dragging)</dt>
                <dd>
                  <kbd>Space</kbd>
                </dd>
              </div>
              <div>
                <dt>Zoom around the pointer (over the page)</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <kbd>Wheel</kbd>
                </dd>
              </div>
              <div>
                <dt>Undo / redo handwriting (on the page)</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <kbd>Z / Shift Z</kbd>
                </dd>
              </div>
              <div>
                <dt>Close menu or focus mode</dt>
                <dd>
                  <kbd>Esc</kbd>
                </dd>
              </div>
            </dl>
            <div className="help-storage">
              <ShieldCheck size={21} />
              <div>
                <strong>Your notes live in this browser.</strong>
                <p>
                  There is no account or cloud sync. Export a backup regularly,
                  especially before clearing browser data. Import JSON backups,
                  or bring in .txt and .md files as plain text.
                </p>
              </div>
            </div>
          </div>
          <div className="dialog-footer">
            <button className="secondary-button" onClick={exportAll}>
              <Download size={16} />
              Download backup
            </button>
            <button className="primary-button" onClick={() => setModal(null)}>
              Got it
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
