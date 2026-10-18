# Noteflow

A handwriting-first local notebook built with React, TypeScript, Vite, and Tiptap. Notes are stored in this browser; no account, API key, backend, or cloud service is needed.

Live app: https://noteflow-handwriting.honeypuppy1.chatgpt.site

## Run locally

Requires Node.js **20.19+** (or 22.12+) and npm.

```bash
npm install
npm run dev
```

If dependencies are already installed and npm is unavailable, you can also start with `node node_modules/vite/bin/vite.js`.

Open the local URL printed in the terminal, normally http://127.0.0.1:5173.

```bash
npm run build       # Type check and create dist/
npm run preview     # Preview the production build
npm run typecheck   # TypeScript checks
npm test            # Storage, migration, validation, and import tests
npm run test:e2e    # Browser interaction tests
```

Browser tests use an installed Google Chrome at `/usr/bin/google-chrome`. Set `CHROME_PATH` to your Chrome/Chromium executable on another system. Playwright starts and stops its own local Vite server.

## Write with a stylus

1. Choose **New note**. A ruled writing page opens with an automatic title; no keyboard is required.
2. Write directly with your stylus. Pressure-sensitive ink saves automatically after each stroke.
3. Use **Pen**, **Highlighter**, or **Erase**, and choose your ink color and width. Pen eraser buttons work when the browser reports them.
4. Choose **Ruled**, **Grid**, **Dots**, or **Plain** paper. Use **Add more writing space** when you reach the bottom, or focus mode for more room.
5. Use **Export PDF** to download an A4 PDF containing all handwriting and any typed notes. Long pages paginate automatically. PNG download and printing are also available. JSON backups preserve editable strokes and paper settings.

**Stylus + mouse** mode ignores finger marks and lets touch scroll the page. If your stylus behaves like a finger (for example, a passive capacitive stylus), select **Finger drawing**. Active pen pressure and eraser support depend on what your device and browser report.

You can tap **Rename note** or **Note details** when you want to change the automatic title, notebook, or tags. The optional **Text** tab keeps rich text available alongside your handwriting. Handwriting remains ink; search finds titles, tags, notebooks, and optional typed content.

## Features

- Create, reopen, edit, and duplicate notes with automatic saving and visible save status.
- Rich text with headings, bold, italic, underline, strikethrough, ordered and bullet lists, interactive checklists, quotes, code blocks, links, dividers, and undo/redo.
- Handwriting as the main editor, with smooth pressure-sensitive ink, palm input filtering, a highlighter, colors, pen sizes, stroke eraser, undo/redo, paper styles, extra writing space, and PNG downloads. Earlier sketches stay editable.
- Notebooks, tags, favorites, pinned notes, note colors, search across titles/content/tags/notebooks, and sorting.
- Archive/unarchive, trash/restore, undo for moving notes, and confirmed permanent deletion.
- Journal, meeting, and project templates.
- Light/dark themes, focus mode, mobile navigation, and keyboard shortcuts.
- Download PDF files directly from the editor header or note menu. Handwriting stays vector-based, extended pages paginate, and optional typed content appears on separate pages.
- Export a full JSON backup, a single note JSON, text/HTML, PNG handwriting, or print the current note view.
- Import JSON backups and legacy notes; `.txt` and `.md` files import as plain text.
- Validation and HTML sanitization on import; newer local notes survive a backup merge.
- Migration from the original app's `notes` localStorage key, including legacy drawings.
- Storage error reporting and recovery copies; corrupt stored data is never silently overwritten.

## Your data

The workspace lives under `noteflow.workspace.v2` in browser localStorage. The original `notes` key is kept after migration. Notes persist on reload in the same browser, profile, and origin. Clearing site data, changing the port/origin, or switching browsers does not carry notes over. Export JSON backups regularly and import them to move your workspace.

Browser storage has a quota. If saving fails, the app reports it and keeps the current in-memory edits available for download. It does not claim changes are saved. Sketches are vector strokes rather than large embedded images, but very large workspaces may still reach the quota.

A second tab receives saved changes when it has no pending edits. If the tabs conflict, automatic saving pauses and the recovery banner lets you export or keep your chosen version. Notes in trash remain there until explicitly deleted.

## Project structure

- `src/App.tsx`: workspace UI, note actions, autosave, shortcuts, and import/export.
- `src/lib/workspace.ts`: types, storage, legacy migration, validation, sanitization, and backup merging.
- `src/components/RichTextEditor.tsx`: Tiptap editor and formatting tools.
- `src/components/SketchEditor.tsx`: stylus handwriting, pressure ink, paper, and drawing tools.
- `src/lib/ink.ts`: ink formats, pressure paths, and legacy sketch migration.
- `src/lib/exportPdf.ts`: local PDF generation and page layout.
- `src/components/InkPreview.tsx`: handwriting previews in the notes list.
- `src/components/Dialog.tsx`: focus-managed dialogs.
- `src/index.css` and `src/components/editors.css`: responsive light/dark styling.
- `tests/workspace.spec.ts`, `tests/stylus.spec.ts`, and `tests/pdf.spec.ts`: browser interaction, simulated pen/touch, and downloaded PDF checks.

## Hosting

The app builds to `dist/` and works on static hosting without a backend. Relative Vite asset paths support both a custom domain and a GitHub Pages project path.

A GitHub Pages workflow is included in `.github/workflows/deploy-pages.yml`. After the public repository is created, choose **Settings → Pages → Source → GitHub Actions**. Pushes to `main` install the locked dependencies, run unit tests, build the app, and deploy `dist/`.

Publishing this source does not publish notes. Notes are stored in each visitor's browser. Your local development notes remain on the local origin; export/import a JSON backup if you want to move them to the hosted app.

PDF export runs in the browser and does not upload note content. Ink remains vector content. Typed text supports headings, paragraphs, lists, tasks, quotes, code, and links. Characters outside the standard PDF font range use browser-rendered high-resolution text images to preserve local font shaping and emoji.
