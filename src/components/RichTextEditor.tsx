import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Link2,
  Undo2,
  Redo2,
  Minus,
  X,
} from "lucide-react";
import "./editors.css";

export interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
}

function safeLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f]/.test(trimmed)) return null;
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (["http:", "https:"].includes(url.protocol) && url.hostname)
      return url.href;
    if (["mailto:", "tel:"].includes(url.protocol) && url.pathname)
      return url.href;
  } catch {
    /* The form displays a validation message below. */
  }
  return null;
}

export default function RichTextEditor({
  content,
  onChange,
  readOnly = false,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState("");
  const linkId = useId();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        },
      }),
      Placeholder.configure({
        placeholder: "A little space for your next big idea…",
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: content || "",
    editable: !readOnly,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Note content",
        "aria-multiline": "true",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: updatedEditor }) =>
      onChangeRef.current(updatedEditor.getHTML()),
  });

  useEffect(() => {
    if (
      editor &&
      !editor.isDestroyed &&
      editor.schema &&
      content !== editor.getHTML()
    ) {
      editor.commands.setContent(content || "", { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.schema)
      editor.setEditable(!readOnly, false);
    if (readOnly) setLinkOpen(false);
  }, [editor, readOnly]);

  if (!editor || !editor.schema)
    return <div className="rich-editor editor-loading">Opening your note…</div>;

  const button = (
    label: string,
    icon: ReactNode,
    action: () => void,
    active = false,
    disabled = false,
  ) => (
    <button
      key={label}
      type="button"
      className={`toolbar-button${active ? " is-active" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={readOnly || disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );

  const openLink = () => {
    setLinkValue(editor.getAttributes("link").href || "");
    setLinkError("");
    setLinkOpen((value) => !value);
  };

  const saveLink = (event: FormEvent) => {
    event.preventDefault();
    const href = safeLink(linkValue);
    if (!href) {
      setLinkError(
        "Enter a valid website, email (mailto:), or phone (tel:) link.",
      );
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain
        .insertContent({
          type: "text",
          text: linkValue.trim(),
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      chain.setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  const headingValue = editor.isActive("heading", { level: 1 })
    ? "1"
    : editor.isActive("heading", { level: 2 })
      ? "2"
      : editor.isActive("heading", { level: 3 })
        ? "3"
        : "paragraph";

  return (
    <div className={`rich-editor${readOnly ? " is-readonly" : ""}`}>
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <select
          className="editor-format-select"
          aria-label="Text style"
          value={headingValue}
          disabled={readOnly}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "paragraph")
              editor.chain().focus().setParagraph().run();
            else
              editor
                .chain()
                .focus()
                .toggleHeading({ level: Number(value) as 1 | 2 | 3 })
                .run();
          }}
        >
          <option value="paragraph">Normal text</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
        <span className="toolbar-divider" />
        {button(
          "Bold (Ctrl/⌘ B)",
          <Bold size={17} />,
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive("bold"),
        )}
        {button(
          "Italic (Ctrl/⌘ I)",
          <Italic size={17} />,
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive("italic"),
        )}
        {button(
          "Underline (Ctrl/⌘ U)",
          <Underline size={17} />,
          () => editor.chain().focus().toggleUnderline().run(),
          editor.isActive("underline"),
        )}
        {button(
          "Strikethrough",
          <Strikethrough size={17} />,
          () => editor.chain().focus().toggleStrike().run(),
          editor.isActive("strike"),
        )}
        <span className="toolbar-divider" />
        {button(
          "Bullet list",
          <List size={18} />,
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
        )}
        {button(
          "Numbered list",
          <ListOrdered size={18} />,
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
        )}
        {button(
          "Task list",
          <ListTodo size={18} />,
          () => editor.chain().focus().toggleTaskList().run(),
          editor.isActive("taskList"),
        )}
        <span className="toolbar-divider" />
        {button(
          "Block quote",
          <Quote size={17} />,
          () => editor.chain().focus().toggleBlockquote().run(),
          editor.isActive("blockquote"),
        )}
        {button(
          "Code block",
          <Code2 size={18} />,
          () => editor.chain().focus().toggleCodeBlock().run(),
          editor.isActive("codeBlock"),
        )}
        {button(
          "Insert or edit link",
          <Link2 size={17} />,
          openLink,
          editor.isActive("link") || linkOpen,
        )}
        {button("Horizontal divider", <Minus size={18} />, () =>
          editor.chain().focus().setHorizontalRule().run(),
        )}
        <span className="toolbar-spacer" />
        {button(
          "Undo",
          <Undo2 size={17} />,
          () => editor.chain().focus().undo().run(),
          false,
          !editor.can().undo(),
        )}
        {button(
          "Redo",
          <Redo2 size={17} />,
          () => editor.chain().focus().redo().run(),
          false,
          !editor.can().redo(),
        )}
      </div>
      {linkOpen && !readOnly && (
        <form
          className="editor-link-form"
          onSubmit={saveLink}
          aria-label="Edit link"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setLinkOpen(false);
              editor.commands.focus();
            }
          }}
        >
          <label className="editor-link-label" htmlFor={linkId}>
            Link
          </label>
          <input
            id={linkId}
            autoFocus
            value={linkValue}
            placeholder="https://example.com"
            aria-invalid={Boolean(linkError)}
            aria-describedby={linkError ? `${linkId}-error` : undefined}
            onChange={(event) => {
              setLinkValue(event.target.value);
              setLinkError("");
            }}
          />
          <button
            type="submit"
            className="editor-small-button editor-primary-button"
          >
            Apply
          </button>
          {editor.isActive("link") && (
            <button
              type="button"
              className="editor-small-button"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLinkOpen(false);
              }}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            className="toolbar-button"
            aria-label="Close link editor"
            onClick={() => {
              setLinkOpen(false);
              editor.commands.focus();
            }}
          >
            <X size={17} />
          </button>
          {linkError && (
            <span
              id={`${linkId}-error`}
              className="editor-form-error"
              role="alert"
            >
              {linkError}
            </span>
          )}
        </form>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
