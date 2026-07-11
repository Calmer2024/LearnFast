import {
  ArrowLeft,
  DownloadSimple,
  FileArrowUp,
  FloppyDisk,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Tag,
  Trash,
  X,
} from "@phosphor-icons/react";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useAppDialog } from "../../components/AppDialog";
import { CustomSelect, type CustomSelectOption } from "../../components/CustomSelect";
import { RichMarkdownEditor } from "../../components/RichMarkdownEditor";
import { api } from "../../lib/api";
import type { Note } from "../../lib/types";

type NoteStatus = Note["status"];
type NotesView = "library" | "editor";

const statusLabels: Record<NoteStatus, string> = {
  draft: "草稿",
  saved: "已沉淀",
  fragment: "碎片",
};

const noteStatusOptions: CustomSelectOption<NoteStatus>[] = [
  { value: "draft", label: "草稿" },
  { value: "saved", label: "已沉淀" },
  { value: "fragment", label: "碎片" },
];

const statusFilterOptions: CustomSelectOption<NoteStatus | "all">[] = [
  { value: "all", label: "全部状态" },
  ...noteStatusOptions,
];

export function NotesSection({ spaceId }: { spaceId: string }) {
  const dialog = useAppDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documentStageRef = useRef<HTMLElement | null>(null);
  const shouldResetEditorScrollRef = useRef(false);
  const noteUploadDragDepthRef = useRef(0);
  const [notes, setNotes] = useState<Note[]>([]);
  const [view, setView] = useState<NotesView>("library");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<NoteStatus | "all">("all");
  const [fragment, setFragment] = useState("");
  const [fragmentOpen, setFragmentOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [status, setStatus] = useState<NoteStatus>("draft");
  const [noteUploadDragActive, setNoteUploadDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeNote = notes.find((note) => note.id === activeNoteId) ?? null;
  const allTags = useMemo(
    () => Array.from(new Set(notes.flatMap((note) => note.tags))).sort(),
    [notes],
  );
  const tagFilterOptions = useMemo<CustomSelectOption<string>[]>(
    () => [
      { value: "", label: "全部标签" },
      ...allTags.map((tag) => ({ value: tag, label: tag })),
    ],
    [allTags],
  );
  const visibleNotes = useMemo(
    () =>
      statusFilter === "all"
        ? notes
        : notes.filter((note) => note.status === statusFilter),
    [notes, statusFilter],
  );
  const totalChunks = useMemo(
    () => notes.reduce((sum, note) => sum + note.chunk_count, 0),
    [notes],
  );
  const fragmentCount = useMemo(
    () => notes.filter((note) => note.status === "fragment").length,
    [notes],
  );

  const loadNotes = async () => {
    const rows = await api.listNotes(spaceId, {
      q: search.trim() || undefined,
      tag: tagFilter || undefined,
    });
    setNotes(rows);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadNotes().catch((exc) =>
        setError(exc instanceof Error ? exc.message : "笔记加载失败"),
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [spaceId, search, tagFilter]);

  const syncForm = (note: Note) => {
    setActiveNoteId(note.id);
    setTitle(note.title);
    setMarkdown(note.markdown);
    setTagsText(note.tags.join(", "));
    setStatus(note.status);
  };

  const openNote = (note: Note) => {
    shouldResetEditorScrollRef.current = true;
    syncForm(note);
    setView("editor");
    setError(null);
    setNotice(null);
  };

  const startNewNote = () => {
    shouldResetEditorScrollRef.current = true;
    setActiveNoteId(null);
    setTitle("");
    setMarkdown("");
    setTagsText("");
    setStatus("draft");
    setView("editor");
    setError(null);
    setNotice(null);
  };

  useEffect(() => {
    if (view !== "editor" || !shouldResetEditorScrollRef.current) return;
    shouldResetEditorScrollRef.current = false;
    window.requestAnimationFrame(() => {
      documentStageRef.current?.scrollTo({ top: 0, left: 0 });
    });
  }, [view, activeNoteId]);

  const backToLibrary = async () => {
    setView("library");
    setActiveNoteId(null);
    await loadNotes();
  };

  const saveNote = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!markdown.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        title: title.trim() || undefined,
        markdown: markdown.trim(),
        tags: parseTags(tagsText),
        status,
      };
      const note = activeNoteId
        ? await api.updateNote(spaceId, activeNoteId, payload)
        : await api.createNote(spaceId, payload);
      syncForm(note);
      await loadNotes();
      setNotice(`已保存笔记：${note.title}`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "保存笔记失败");
    } finally {
      setSaving(false);
    }
  };

  const createFragment = async (event: FormEvent) => {
    event.preventDefault();
    const value = fragment.trim();
    if (!value) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.createNote(spaceId, {
        markdown: value,
        tags: ["碎片"],
        status: "fragment",
      });
      setFragment("");
      setFragmentOpen(false);
      await loadNotes();
      setNotice("碎片笔记已保存并进入索引。");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "创建碎片笔记失败");
    } finally {
      setSaving(false);
    }
  };

  const uploadMarkdownNotes = async (incomingFiles?: FileList | File[]) => {
    const files = incomingFiles ?? fileInputRef.current?.files;
    if (!files || files.length === 0) return;
    const markdownFiles = Array.from(files).filter((file) =>
      /\.(md|markdown)$/i.test(file.name),
    );
    if (markdownFiles.length === 0) {
      setError("请上传 .md 或 .markdown 笔记文件。");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.uploadNotes(spaceId, markdownFiles);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadNotes();
      setNotice(`已上传 ${created.length} 篇 Markdown 笔记。`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "上传笔记失败");
    } finally {
      setSaving(false);
    }
  };

  const handleNoteUploadDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    noteUploadDragDepthRef.current += 1;
    setNoteUploadDragActive(true);
  };

  const handleNoteUploadDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleNoteUploadDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    noteUploadDragDepthRef.current = Math.max(0, noteUploadDragDepthRef.current - 1);
    if (noteUploadDragDepthRef.current === 0) setNoteUploadDragActive(false);
  };

  const handleNoteUploadDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    noteUploadDragDepthRef.current = 0;
    setNoteUploadDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    void uploadMarkdownNotes(files);
  };

  const deleteNote = async (note: Note) => {
    const noteTitle = note.title || "未命名笔记";
    const deleteAssociatedMemories = await dialog.confirm({
      title: "同步删除关联记忆？",
      body: `删除笔记“${noteTitle}”前，是否同步删除由这条笔记生成的关联记忆？`,
      cancelLabel: "只删除笔记",
      confirmLabel: "同步删除",
    });
    const confirmed = await dialog.confirm({
      title: `确认删除笔记“${noteTitle}”？`,
      body: deleteAssociatedMemories
        ? "将删除笔记，并请求同步删除由它生成的长期记忆与待处理候选。"
        : "将只删除笔记，关联记忆会保留。",
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      await api.deleteNote(spaceId, note.id, deleteAssociatedMemories);
      if (activeNoteId === note.id) {
        setView("library");
        setActiveNoteId(null);
      }
      await loadNotes();
      setNotice(
        deleteAssociatedMemories
          ? "笔记已删除；关联长期记忆已同步删除，待处理候选已忽略。"
          : "笔记已删除；关联记忆保留。",
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "删除笔记失败");
    }
  };

  const exportNote = async (note: Note) => {
    setError(null);
    setNotice(null);
    try {
      const result = await api.exportNoteMarkdown(spaceId, note.id);
      const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFilename(result.title)}.md`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("笔记已导出为 Markdown。");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "导出笔记失败");
    }
  };


  if (view === "editor") {
    return (
      <>
      <form className="document-shell" onSubmit={saveNote}>
        <div className="document-topbar">
          <button className="button ghost" type="button" onClick={backToLibrary}>
            <ArrowLeft size={15} />
            返回笔记库
          </button>
          <div className="document-topbar-meta">
            <span>{activeNoteId ? "正在编辑" : "新建文档"}</span>
            <span>{activeNote?.chunk_count ?? 0} 个索引片段</span>
            {activeNote && <span>{new Date(activeNote.updated_at).toLocaleString()}</span>}
          </div>
          <div className="document-actions">
            <button className="button" disabled={saving || !markdown.trim()}>
              <FloppyDisk size={15} />
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {error && <div className="notice danger">{error}</div>}
        {notice && <div className="notice success">{notice}</div>}

        <main className="document-stage" ref={documentStageRef}>
          <article className="document-page">
            <input
              className="document-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="未命名笔记"
            />
            <div className="document-property-bar">
              <label>
                状态
                <CustomSelect value={status} options={noteStatusOptions} onChange={setStatus} />
              </label>
              <label>
                标签
                <input
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  placeholder="Pandas, 复习, 易错"
                />
              </label>
            </div>
            <section className="document-editor-canvas">
              <RichMarkdownEditor
                value={markdown}
                onChange={setMarkdown}
                onSave={() => saveNote()}
                autoFocusKey={activeNoteId ?? "new-note"}
              />
            </section>
          </article>
        </main>
      </form>
      {dialog.node}
      </>
    );
  }

  return (
    <div className="notes-hub">
      <section className="notes-hub-header">
        <div>
          <p className="eyebrow">Markdown Notes</p>
          <h2>笔记库</h2>
        </div>
        <div className="notes-primary-actions">
          <input
            ref={fileInputRef}
            className="native-file-input"
            type="file"
            accept=".md,.markdown"
            multiple
            onChange={() => uploadMarkdownNotes()}
          />
          <div
            className={`notes-upload-dropzone ${noteUploadDragActive ? "dragging" : ""}`.trim()}
            onDragEnter={handleNoteUploadDragEnter}
            onDragLeave={handleNoteUploadDragLeave}
            onDragOver={handleNoteUploadDragOver}
            onDrop={handleNoteUploadDrop}
          >
            <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
              <FileArrowUp size={15} />
              上传 .md
            </button>
          </div>
          <button className="button" type="button" onClick={startNewNote}>
            <Plus size={15} />
            编写笔记
          </button>
        </div>
      </section>

      {error && <div className="notice danger">{error}</div>}
      {notice && <div className="notice success">{notice}</div>}

      <section className="notes-overview">
        <div>
          <span>全部笔记</span>
          <strong>{notes.length}</strong>
        </div>
        <div>
          <span>碎片笔记</span>
          <strong>{fragmentCount}</strong>
        </div>
        <div>
          <span>索引片段</span>
          <strong>{totalChunks}</strong>
        </div>
      </section>

      <section className="notes-control-strip">
        <label className="search-field">
          <MagnifyingGlass size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索标题、正文或标签"
          />
        </label>
        <label>
          标签
          <CustomSelect value={tagFilter} options={tagFilterOptions} onChange={setTagFilter} />
        </label>
        <label>
          状态
          <CustomSelect value={statusFilter} options={statusFilterOptions} onChange={setStatusFilter} />
        </label>
      </section>

      <section
        className={`document-list notes-drop-surface ${noteUploadDragActive ? "dragging" : ""}`.trim()}
        onDragEnter={handleNoteUploadDragEnter}
        onDragLeave={handleNoteUploadDragLeave}
        onDragOver={handleNoteUploadDragOver}
        onDrop={handleNoteUploadDrop}
      >
        {noteUploadDragActive && (
          <div className="source-drop-overlay notes-drop-overlay">
            <FileArrowUp size={26} />
            <strong>松开即可导入笔记</strong>
            <span>多个 Markdown 文件会一起进入笔记库。</span>
          </div>
        )}
        {visibleNotes.map((note) => (
          <article className="document-row" key={note.id} onClick={() => openNote(note)}>
            <div>
              <h3>{note.title}</h3>
              <p>{compact(note.markdown)}</p>
            </div>
            <div className="document-row-side">
              <span>{statusLabels[note.status]}</span>
              <span>{note.chunk_count} 个片段</span>
              <time>{new Date(note.updated_at).toLocaleString()}</time>
            </div>
            <div className="document-row-footer">
              <div className="tag-list">
                {note.tags.slice(0, 4).map((tag) => (
                  <span key={tag}>
                    <Tag size={11} />
                    {tag}
                  </span>
                ))}
              </div>
              <div className="document-row-actions" onClick={(event) => event.stopPropagation()}>
                <button className="button ghost" type="button" onClick={() => exportNote(note)}>
                  <DownloadSimple size={15} />
                  导出
                </button>
                <button className="button ghost danger-text" type="button" onClick={() => deleteNote(note)}>
                  <Trash size={15} />
                  删除
                </button>
              </div>
            </div>
          </article>
        ))}
        {visibleNotes.length === 0 && (
          <div className="empty large">
            <h3>这里还空着呢</h3>
            <p>拖进几篇 Markdown，或者写下第一片小小的学习灵感。</p>
          </div>
        )}
      </section>

      <button
        className="fragment-fab"
        type="button"
        aria-label="记录碎片笔记"
        title="记录碎片笔记"
        onClick={() => setFragmentOpen(true)}
      >
        <NotePencil size={20} />
      </button>

      {fragmentOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setFragmentOpen(false)}>
          <section className="fragment-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="fragment-modal-head">
              <h3>碎片笔记</h3>
              <button className="icon-button" type="button" aria-label="关闭" onClick={() => setFragmentOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={createFragment}>
              <textarea
                rows={5}
                value={fragment}
                autoFocus
                onChange={(event) => setFragment(event.target.value)}
                placeholder="快速记录一个想法、困惑或摘录。"
              />
              <button className="button" disabled={saving || !fragment.trim()}>
                <NotePencil size={15} />
                保存
              </button>
            </form>
          </section>
        </div>
      )}
      {dialog.node}
    </div>
  );
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function compact(text: string, limit = 150) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "learnfast-note";
}

function hasDroppedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}
