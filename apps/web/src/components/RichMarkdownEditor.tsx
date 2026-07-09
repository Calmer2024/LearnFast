import {
  Code,
  FloppyDisk,
  Function as FunctionIcon,
  ImageSquare,
  LinkSimple,
  ListBullets,
  ListChecks,
  ListNumbers,
  Quotes,
  Sigma,
  Table,
  TextB,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextItalic,
  TextT,
} from "@phosphor-icons/react";
import { Editor, Extension } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Mathematics, migrateMathStrings } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import { Table as TableExtension } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import "katex/dist/katex.min.css";

const lowlight = createLowlight(common);

type RichMarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  autoFocusKey?: string;
};

type FloatingToolbarState = {
  top: number;
  left: number;
};

type SlashMenuState = {
  top: number;
  left: number;
  query: string;
};

type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  icon: typeof TextT;
  run: (editor: Editor) => void;
};

const CodeBlockLanguageClass = Extension.create({
  name: "codeBlockLanguageClass",
  addGlobalAttributes() {
    return [
      {
        types: ["codeBlock"],
        attributes: {
          language: {
            default: null,
            parseHTML: (element) => {
              const className = element.querySelector("code")?.getAttribute("class") ?? "";
              return className.match(/language-([\w-]+)/)?.[1] ?? null;
            },
            renderHTML: (attributes) => {
              if (!attributes.language) return {};
              return {
                "data-language": attributes.language,
              };
            },
          },
        },
      },
    ];
  },
});

const editorExtensions = [
  StarterKit.configure({
    codeBlock: false,
    link: false,
  }),
  CodeBlockLanguageClass,
  CodeBlockLowlight.configure({
    lowlight,
  }),
  Link.configure({
    autolink: true,
    linkOnPaste: true,
    openOnClick: false,
    HTMLAttributes: {
      rel: "noreferrer",
      target: "_blank",
    },
  }),
  Image.configure({
    allowBase64: true,
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  TableExtension.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  Mathematics.configure({
    katexOptions: {
      throwOnError: false,
    },
  }),
  Placeholder.configure({
    placeholder: "开始输入正文。输入 #、-、>、```、/ 等会即时转换为文档块。",
  }),
];

const turndownService = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  headingStyle: "atx",
});

turndownService.use(gfm);
turndownService.addRule("inlineMath", {
  filter: (node) =>
    node.nodeName === "SPAN" && (node as Element).getAttribute("data-type") === "inline-math",
  replacement: (_content, node) => `$${((node as Element).getAttribute("data-latex") ?? "").trim()}$`,
});
turndownService.addRule("blockMath", {
  filter: (node) =>
    node.nodeName === "DIV" && (node as Element).getAttribute("data-type") === "block-math",
  replacement: (_content, node) => {
    const latex = ((node as Element).getAttribute("data-latex") ?? "").trim();
    return `\n\n$$\n${latex}\n$$\n\n`;
  },
});
turndownService.addRule("taskItem", {
  filter: (node) =>
    node.nodeName === "LI" && (node as Element).getAttribute("data-type") === "taskItem",
  replacement: (content, node) => {
    const checked = (node as Element).getAttribute("data-checked") === "true";
    const body = content.trim().replace(/\n/g, "\n  ");
    return `\n- [${checked ? "x" : " "}] ${body}`;
  },
});

export function RichMarkdownEditor({
  value,
  onChange,
  onSave,
  autoFocusKey,
}: RichMarkdownEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const syncingRef = useRef(false);
  const latestEditorMarkdownRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const slashStateRef = useRef<SlashMenuState | null>(null);
  const [toolbar, setToolbar] = useState<FloatingToolbarState | null>(null);
  const [slashState, setSlashState] = useState<SlashMenuState | null>(null);

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        id: "text",
        label: "文本",
        hint: "普通段落",
        icon: TextT,
        run: (editor) => runAfterSlash(editor, (chain) => chain.setParagraph().run()),
      },
      {
        id: "h1",
        label: "一级标题",
        hint: "# 标题",
        icon: TextHOne,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleHeading({ level: 1 }).run()),
      },
      {
        id: "h2",
        label: "二级标题",
        hint: "## 标题",
        icon: TextHTwo,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleHeading({ level: 2 }).run()),
      },
      {
        id: "h3",
        label: "三级标题",
        hint: "### 标题",
        icon: TextHThree,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleHeading({ level: 3 }).run()),
      },
      {
        id: "bullet",
        label: "无序列表",
        hint: "- 列表项",
        icon: ListBullets,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleBulletList().run()),
      },
      {
        id: "ordered",
        label: "有序列表",
        hint: "1. 列表项",
        icon: ListNumbers,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleOrderedList().run()),
      },
      {
        id: "task",
        label: "任务",
        hint: "- [ ] 任务",
        icon: ListChecks,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleTaskList().run()),
      },
      {
        id: "quote",
        label: "引用",
        hint: "> 摘录",
        icon: Quotes,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleBlockquote().run()),
      },
      {
        id: "code",
        label: "代码块",
        hint: "```",
        icon: Code,
        run: (editor) => runAfterSlash(editor, (chain) => chain.toggleCodeBlock().run()),
      },
      {
        id: "table",
        label: "表格",
        hint: "3 x 3",
        icon: Table,
        run: (editor) =>
          runAfterSlash(editor, (chain) =>
            chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          ),
      },
      {
        id: "image",
        label: "图片",
        hint: "Markdown 图片",
        icon: ImageSquare,
        run: (editor) => {
          const src = window.prompt("图片地址");
          if (!src?.trim()) return;
          runAfterSlash(editor, (chain) => chain.setImage({ src: src.trim() }).run());
        },
      },
      {
        id: "math-inline",
        label: "行内公式",
        hint: "$E = mc^2$",
        icon: Sigma,
        run: (editor) => {
          const latex = window.prompt("输入 LaTeX 公式", "E = mc^2");
          if (!latex?.trim()) return;
          runAfterSlash(editor, (chain) => chain.insertInlineMath({ latex: latex.trim() }).run());
        },
      },
      {
        id: "math-block",
        label: "公式块",
        hint: "$$",
        icon: FunctionIcon,
        run: (editor) => {
          const latex = window.prompt("输入 LaTeX 公式", "\\sum_{i=1}^{n} x_i");
          if (!latex?.trim()) return;
          runAfterSlash(editor, (chain) => chain.insertBlockMath({ latex: latex.trim() }).run());
        },
      },
    ],
    [],
  );

  const slashCommandsVisible = getVisibleSlashCommands(slashCommands, slashState);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  slashStateRef.current = slashState;

  const editor = useEditor({
    extensions: editorExtensions,
    content: markdownToEditorHtml(value),
    editorProps: {
      attributes: {
        class: "rich-markdown-prosemirror",
        spellcheck: "false",
      },
      handleKeyDown: (_view, event) => {
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSaveRef.current();
          return true;
        }

        if (slashStateRef.current && event.key === "Escape") {
          event.preventDefault();
          setSlashState(null);
          return true;
        }

        if (slashStateRef.current && event.key === "Enter") {
          const visibleCommands = getVisibleSlashCommands(slashCommands, slashStateRef.current);
          if (!visibleCommands[0]) return false;
          event.preventDefault();
          visibleCommands[0].run(currentEditor);
          setSlashState(null);
          return true;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          applyLink(currentEditor);
          return true;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
          event.preventDefault();
          currentEditor.chain().focus().toggleBold().run();
          return true;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
          event.preventDefault();
          currentEditor.chain().focus().toggleItalic().run();
          return true;
        }

        if ((event.ctrlKey || event.metaKey) && event.altKey && ["1", "2", "3", "4", "5", "6"].includes(event.key)) {
          event.preventDefault();
          currentEditor
            .chain()
            .focus()
            .toggleHeading({ level: Number(event.key) as 1 | 2 | 3 | 4 | 5 | 6 })
            .run();
          return true;
        }

        if (event.key === " " && applyTaskListShortcut(currentEditor)) {
          event.preventDefault();
          return true;
        }

        return false;
      },
      handleDOMEvents: {
        contextmenu: (_view, event) => {
          const currentEditor = editorRef.current;
          if (!currentEditor || currentEditor.state.selection.empty) return false;
          event.preventDefault();
          setSlashState(null);
          setToolbar({ top: event.clientY, left: event.clientX });
          return true;
        },
        mouseup: () => {
          setToolbar(null);
          window.setTimeout(() => updateSlashMenu(editorRef.current, shellRef.current, setSlashState), 0);
          return false;
        },
        keyup: () => {
          setToolbar(null);
          updateSlashMenu(editorRef.current, shellRef.current, setSlashState);
          return false;
        },
      },
    },
    onCreate: ({ editor: createdEditor }) => {
      editorRef.current = createdEditor;
      migrateMathStrings(createdEditor);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (currentEditor.state.selection.empty) {
        setToolbar(null);
      }
      updateSlashMenu(currentEditor, shellRef.current, setSlashState);
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (syncingRef.current) return;
      const nextMarkdown = editorHtmlToMarkdown(currentEditor.getHTML());
      latestEditorMarkdownRef.current = nextMarkdown;
      onChangeRef.current(nextMarkdown);
      updateSlashMenu(currentEditor, shellRef.current, setSlashState);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (value === latestEditorMarkdownRef.current) return;
    syncingRef.current = true;
    editor.commands.setContent(markdownToEditorHtml(value), { emitUpdate: false });
    migrateMathStrings(editor);
    latestEditorMarkdownRef.current = value;
    syncingRef.current = false;
    updateSlashMenu(editor, shellRef.current, setSlashState);
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    window.setTimeout(() => editor.commands.focus("start"), 0);
  }, [autoFocusKey, editor]);

  return (
    <div className="rich-markdown-shell" ref={shellRef}>
      <EditorContent editor={editor} />

      {slashState && slashCommandsVisible.length > 0 && (
        <div className="slash-menu rich-slash-menu" style={{ top: slashState.top, left: slashState.left }}>
          <div className="slash-menu-title">基础</div>
          {slashCommandsVisible.map((command) => (
            <button
              type="button"
              key={command.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!editor) return;
                command.run(editor);
                setSlashState(null);
              }}
            >
              <command.icon size={22} />
              <span>{command.label}</span>
              <small>{command.hint}</small>
            </button>
          ))}
        </div>
      )}

      {toolbar && editor && (
        <FloatingSelectionToolbar
          editor={editor}
          state={toolbar}
          onLink={() => applyLink(editor)}
          onSave={onSave}
          onCommand={() => setToolbar((current) => (current ? { ...current } : current))}
        />
      )}
    </div>
  );
}

function FloatingSelectionToolbar({
  editor,
  state,
  onLink,
  onSave,
  onCommand,
}: {
  editor: Editor;
  state: FloatingToolbarState;
  onLink: () => void;
  onSave: () => void;
  onCommand: () => void;
}) {
  const buttons = [
    {
      label: "H1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor.isActive("heading", { level: 1 }),
    },
    {
      label: "H2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
    },
    {
      label: "H3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
    },
    {
      label: "B",
      action: () => editor.chain().focus().toggleBold().run(),
      icon: TextB,
      active: editor.isActive("bold"),
    },
    {
      label: "I",
      action: () => editor.chain().focus().toggleItalic().run(),
      icon: TextItalic,
      active: editor.isActive("italic"),
    },
    {
      label: "链接",
      action: onLink,
      icon: LinkSimple,
      active: editor.isActive("link"),
    },
    {
      label: "代码",
      action: () => editor.chain().focus().toggleCode().run(),
      icon: Code,
      active: editor.isActive("code") || editor.isActive("codeBlock"),
    },
    {
      label: "列表",
      action: () => editor.chain().focus().toggleBulletList().run(),
      icon: ListBullets,
      active: editor.isActive("bulletList"),
    },
    {
      label: "有序",
      action: () => editor.chain().focus().toggleOrderedList().run(),
      icon: ListNumbers,
      active: editor.isActive("orderedList"),
    },
    {
      label: "引用",
      action: () => editor.chain().focus().toggleBlockquote().run(),
      icon: Quotes,
      active: editor.isActive("blockquote"),
    },
    { label: "保存", action: onSave, icon: FloppyDisk, active: false },
  ];

  return (
    <div className="selection-toolbar" style={{ left: state.left, top: state.top }}>
      {buttons.map((button, index) => (
        <button
          className={`selection-tool-button ${button.active ? "active" : ""}`.trim()}
          key={`${button.label}-${index}`}
          type="button"
          title={button.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            button.action();
            onCommand();
          }}
        >
          {button.icon ? <button.icon size={18} /> : button.label}
        </button>
      ))}
    </div>
  );
}

function applyLink(editor: Editor) {
  const currentHref = editor.getAttributes("link").href as string | undefined;
  const href = window.prompt("链接地址", currentHref ?? "https://");
  if (href === null) return;
  if (!href.trim()) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
}

function applyTaskListShortcut(editor: Editor) {
  const { $from } = editor.state.selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const match = textBefore.match(/^\s*(?:[-*+]\s+)?\[([ xX])\]$/);
  if (!match) return false;

  const checked = match[1].toLowerCase() === "x";
  editor
    .chain()
    .focus()
    .deleteRange({ from: $from.pos - textBefore.length, to: $from.pos })
    .toggleTaskList()
    .updateAttributes("taskItem", { checked })
    .run();
  return true;
}

function getVisibleSlashCommands(commands: SlashCommand[], state: SlashMenuState | null) {
  if (!state) return [];
  return commands.filter(
    (command) =>
      command.label.includes(state.query) ||
      command.id.includes(state.query.toLowerCase()),
  );
}

function runAfterSlash(
  editor: Editor,
  action: (chain: ReturnType<Editor["chain"]>) => boolean,
) {
  const range = getSlashRange(editor);
  const chain = editor.chain().focus();
  if (range) {
    chain.deleteRange(range);
  }
  action(chain);
}

function getSlashRange(editor: Editor) {
  const { $from } = editor.state.selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const match = textBefore.match(/^\s*\/[^\n]*$/);
  if (!match) return null;
  return {
    from: $from.pos - match[0].length,
    to: $from.pos,
  };
}

function updateSlashMenu(
  editor: Editor | null,
  shell: HTMLDivElement | null,
  setSlashState: (state: SlashMenuState | null) => void,
) {
  if (!editor || !shell || !editor.isFocused) {
    setSlashState(null);
    return;
  }
  const { $from } = editor.state.selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const match = textBefore.match(/^\s*\/([^\n]*)$/);
  if (!match) {
    setSlashState(null);
    return;
  }
  const cursorRect = editor.view.coordsAtPos($from.pos);
  const shellRect = shell.getBoundingClientRect();
  setSlashState({
    top: cursorRect.bottom - shellRect.top + 8,
    left: Math.max(0, Math.min(cursorRect.left - shellRect.left, shellRect.width - 380)),
    query: match[1].trim(),
  });
}

function markdownToEditorHtml(markdown: string) {
  if (!markdown.trim()) return "<p></p>";
  const withMathBlocks = markdown.replace(
    /(^|\n)\$\$\s*\n?([\s\S]*?)\n?\$\$(?=\n|$)/g,
    (_match, prefix: string, latex: string) =>
      `${prefix}<div data-type="block-math" data-latex="${escapeHtmlAttribute(latex.trim())}"></div>\n`,
  );
  const html = marked.parse(withMathBlocks, {
    async: false,
    breaks: false,
    gfm: true,
  }) as string;
  return normalizeTaskListHtml(html);
}

function normalizeTaskListHtml(html: string) {
  if (typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("ul").forEach((list) => {
    const items = Array.from(list.children).filter((child): child is HTMLLIElement => child.tagName === "LI");
    if (!items.length) return;
    const taskItems: Array<{ item: HTMLLIElement; checkbox: HTMLInputElement }> = [];
    items.forEach((item) => {
      const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (checkbox) {
        taskItems.push({ item, checkbox });
      }
    });
    if (taskItems.length !== items.length) return;
    list.setAttribute("data-type", "taskList");
    taskItems.forEach(({ item, checkbox }) => {
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", checkbox.checked ? "true" : "false");
      checkbox.remove();
    });
  });
  return template.innerHTML;
}

function editorHtmlToMarkdown(html: string) {
  return turndownService
    .turndown(html)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
