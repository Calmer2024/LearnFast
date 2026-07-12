import {
  ArrowLeft,
  ArrowClockwise,
  CaretRight,
  CheckSquare,
  File as FileIcon,
  FileArrowUp,
  FileAudio,
  FileCode,
  FileCsv,
  FileDoc,
  FileHtml,
  FileImage,
  FileMd,
  FilePdf,
  FilePpt,
  FileText,
  FileVideo,
  FileXls,
  FileZip,
  Folder,
  FolderOpen,
  GlobeSimple,
  LinkSimple,
  MagnifyingGlass,
  PencilSimple,
  Power,
  Square,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAppDialog } from "../../components/AppDialog";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { StatusBadge } from "../../components/StatusBadge";
import { TransientNotice } from "../../components/TransientNotice";
import { api } from "../../lib/api";
import type { Source, SourceChunk, SourceFolder } from "../../lib/types";

type SourceDetailView = "markdown" | "chunks";
type SourceKind =
  | "audio"
  | "code"
  | "csv"
  | "docx"
  | "epub"
  | "file"
  | "html"
  | "img"
  | "md"
  | "pdf"
  | "pptx"
  | "txt"
  | "url"
  | "video"
  | "xlsx"
  | "zip";

type SourceIconConfig = {
  Icon: Icon;
  label: string;
};

const processingStatuses = new Set([
  "uploaded",
  "imported",
  "queued",
  "converting",
  "converted",
  "chunking",
  "indexing",
]);

export function SourcesSection({ spaceId }: { spaceId: string }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);
  const boardDragDepthRef = useRef(0);
  const dialog = useAppDialog();
  const [routeParams, setRouteParams] = useSearchParams();
  const [sources, setSources] = useState<Source[]>([]);
  const [folders, setFolders] = useState<SourceFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [markdown, setMarkdown] = useState<string>("");
  const [chunks, setChunks] = useState<SourceChunk[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [fileSummary, setFileSummary] = useState("未选择文件");
  const [fileDragActive, setFileDragActive] = useState(false);
  const [boardDragActive, setBoardDragActive] = useState(false);
  const [draggedSourceId, setDraggedSourceId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedSourceId = routeParams.get("source");
  const detailView: SourceDetailView = routeParams.get("view") === "chunks" ? "chunks" : "markdown";

  const loadSources = async () => {
    const [rows, folderRows] = await Promise.all([api.listSources(spaceId), api.listSourceFolders(spaceId)]);
    setSources(rows); setFolders(folderRows);
  };

  useEffect(() => {
    loadSources().catch((exc) => setError(exc.message));
  }, [spaceId]);

  const sourceSummary = useMemo(
    () => ({
      total: sources.length,
      ready: sources.filter((source) => source.status === "ready").length,
      processing: sources.filter((source) => processingStatuses.has(source.status)).length,
      failed: sources.filter((source) => source.status === "failed").length,
    }),
    [sources],
  );
  const hasProcessing = sourceSummary.processing > 0;

  useEffect(() => {
    if (!hasProcessing) return;
    const timer = window.setInterval(() => {
      loadSources().catch((exc) => setError(exc.message));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasProcessing, spaceId]);

  useEffect(() => {
    if (!selectedSourceId || sources.length === 0) return;
    if (sources.some((source) => source.id === selectedSourceId)) return;
    const next = new URLSearchParams(routeParams);
    next.delete("source");
    next.delete("view");
    setRouteParams(next, { replace: true });
  }, [routeParams, selectedSourceId, setRouteParams, sources]);

  const visibleSources = useMemo(() => {
    const query = search.trim().toLowerCase();
    const scoped = sources.filter((source) => (source.folder_id ?? null) === activeFolderId);
    if (!query) return scoped;
    return scoped.filter((source) =>
      [source.title, source.type, source.origin, source.status, source.version_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search, sources, activeFolderId]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedSourceIds(new Set());
  }, [activeFolderId]);

  useEffect(() => {
    const sourceIds = new Set(sources.map((source) => source.id));
    setSelectedSourceIds((current) => new Set([...current].filter((sourceId) => sourceIds.has(sourceId))));
  }, [sources]);

  const createFolder = async () => {
    const name = await dialog.prompt({ title: "新建目录", inputLabel: "目录名称", placeholder: "例如：第一章 基础概念", confirmLabel: "创建" });
    if (!name?.trim()) return;
    await api.createSourceFolder(spaceId, { name: name.trim(), parent_id: activeFolderId });
    await loadSources();
  };
  const renameFolder = async (folder: SourceFolder) => {
    const name = await dialog.prompt({ title: "重命名目录", inputLabel: "目录名称", defaultValue: folder.name, confirmLabel: "保存" });
    if (!name?.trim()) return;
    await api.updateSourceFolder(spaceId, folder.id, { name: name.trim() });
    await loadSources();
  };
  const deleteFolder = async (folder: SourceFolder) => {
    const confirmed = await dialog.confirm({ title: "删除此目录？", body: "目录中的资料和子目录会移到根目录，不会删除资料。", confirmLabel: "删除目录", variant: "danger" });
    if (!confirmed) return;
    await api.deleteSourceFolder(spaceId, folder.id);
    if (activeFolderId === folder.id) setActiveFolderId(folder.parent_id ?? null);
    await loadSources();
  };
  const currentFolders = useMemo(() => folders.filter((folder) => (folder.parent_id ?? null) === activeFolderId), [folders, activeFolderId]);
  const breadcrumbs = useMemo(() => {
    const path: SourceFolder[] = [];
    let cursor = activeFolderId ? folders.find((folder) => folder.id === activeFolderId) : undefined;
    while (cursor) {
      path.unshift(cursor);
      cursor = cursor.parent_id ? folders.find((folder) => folder.id === cursor?.parent_id) : undefined;
    }
    return path;
  }, [activeFolderId, folders]);
  const moveSource = async (sourceId: string, folderId: string | null) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source || (source.folder_id ?? null) === folderId) return;
    await api.updateSource(spaceId, sourceId, { folder_id: folderId });
    setMessage(`《${source.title}》已移动。`);
    await loadSources();
  };
  const acceptSourceDrop = (event: DragEvent<HTMLElement>, folderId: string | null) => {
    const sourceId = event.dataTransfer.getData("application/x-learnfast-source") || draggedSourceId;
    if (!sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(null);
    setDraggedSourceId(null);
    void moveSource(sourceId, folderId);
  };

  const selected = sources.find((source) => source.id === selectedSourceId) ?? null;

  useEffect(() => {
    setMarkdown("");
    setChunks([]);
    if (!selected || selected.status !== "ready") return;
    api
      .getMarkdown(spaceId, selected.id)
      .then((result) => setMarkdown(result.markdown))
      .catch((exc) => setMarkdown(`无法读取 Markdown：${exc.message}`));
    api
      .getChunks(spaceId, selected.id)
      .then(setChunks)
      .catch(() => setChunks([]));
  }, [selected?.id, selected?.status, spaceId]);

  const upload = async (incomingFiles?: FileList | File[]) => {
    const files = incomingFiles ?? fileInputRef.current?.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await api.uploadSources(spaceId, files, activeFolderId);
      setMessage(`${files.length} 个资料文件已加入处理队列。`);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setFileSummary("未选择文件");
      setImportOpen(false);
      await loadSources();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "上传失败");
    } finally {
      setLoading(false);
    }
  };

  const updateFileSummary = (incomingFiles?: FileList | File[]) => {
    const files = incomingFiles ?? fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setFileSummary("未选择文件");
      return;
    }
    const names = Array.from(files).map((file) => file.name);
    setFileSummary(names.length === 1 ? names[0] : `${names.length} 个文件已选择`);
  };

  const handleFileDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  };

  const handleFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleFileDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    updateFileSummary(files);
    void upload(files);
  };

  const handleBoardDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    boardDragDepthRef.current += 1;
    setBoardDragActive(true);
  };

  const handleBoardDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleBoardDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    boardDragDepthRef.current = Math.max(0, boardDragDepthRef.current - 1);
    if (boardDragDepthRef.current === 0) setBoardDragActive(false);
  };

  const handleBoardDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    boardDragDepthRef.current = 0;
    setBoardDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    updateFileSummary(files);
    void upload(files);
  };

  const importUrl = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await api.importUrl(spaceId, { url, title: title || undefined });
      setUrl("");
      setTitle("");
      setMessage("链接已加入处理队列。");
      setImportOpen(false);
      await loadSources();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "导入失败");
    } finally {
      setLoading(false);
    }
  };

  const openSource = (source: Source) => {
    const next = new URLSearchParams(routeParams);
    next.set("source", source.id);
    next.set("view", "markdown");
    setRouteParams(next);
  };

  const closeSource = () => {
    const next = new URLSearchParams(routeParams);
    next.delete("source");
    next.delete("view");
    setRouteParams(next);
  };

  const switchDetailView = (view: SourceDetailView) => {
    const next = new URLSearchParams(routeParams);
    if (selectedSourceId) next.set("source", selectedSourceId);
    next.set("view", view);
    setRouteParams(next);
  };

  const toggleEnabled = async (source: Source) => {
    await api.updateSource(spaceId, source.id, { enabled: !source.enabled });
    await loadSources();
  };

  const retry = async (source: Source) => {
    await api.retrySource(spaceId, source.id);
    await loadSources();
  };

  const deleteSource = async (source: Source) => {
    const confirmed = await dialog.confirm({
      title: `删除资料“${source.title}”？`,
      body: "删除后会移除该资料的索引与详情记录。",
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!confirmed) return;
    await api.deleteSource(spaceId, source.id);
    if (selectedSourceId === source.id) closeSource();
    await loadSources();
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedSourceIds(new Set());
  };

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const allVisibleSourcesSelected = visibleSources.length > 0
    && visibleSources.every((source) => selectedSourceIds.has(source.id));

  const toggleAllVisibleSources = () => {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (allVisibleSourcesSelected) visibleSources.forEach((source) => next.delete(source.id));
      else visibleSources.forEach((source) => next.add(source.id));
      return next;
    });
  };

  const deleteSelectedSources = async () => {
    const sourceIds = [...selectedSourceIds];
    if (sourceIds.length === 0) return;
    const confirmed = await dialog.confirm({
      title: `删除已选择的 ${sourceIds.length} 个资料？`,
      body: "删除后会移除这些资料的索引与详情记录，此操作无法撤销。",
      confirmLabel: "批量删除",
      variant: "danger",
    });
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    const results = await Promise.allSettled(sourceIds.map((sourceId) => api.deleteSource(spaceId, sourceId)));
    const failedIds = sourceIds.filter((_, index) => results[index].status === "rejected");
    let refreshFailed = false;
    try {
      await loadSources();
    } catch (exc) {
      refreshFailed = true;
      setError(exc instanceof Error ? exc.message : "刷新资料列表失败");
    } finally {
      setLoading(false);
    }
    if (refreshFailed) return;

    if (failedIds.length > 0) {
      setSelectedSourceIds(new Set(failedIds));
      setError(`${sourceIds.length - failedIds.length} 个资料已删除，${failedIds.length} 个删除失败，请重试。`);
      return;
    }

    setMessage(`已删除 ${sourceIds.length} 个资料。`);
    exitSelectionMode();
  };

  const selectedKind = selected ? sourceKind(selected) : "file";
  const selectedIcon = sourceIconConfig(selectedKind);
  const SelectedIcon = selectedIcon.Icon;

  return (
    <div className="sources-layout">
      <section className="sources-board">
        {error && <TransientNotice message={error} tone="danger" onDismiss={() => setError(null)} />}
        {message && <TransientNotice message={message} tone="success" onDismiss={() => setMessage(null)} />}

        {selected ? (
          <section className="source-preview-route">
            <div className="source-route-head">
              <button className="button ghost" type="button" onClick={closeSource}>
                <ArrowLeft size={15} />
                返回资料库
              </button>
              <div className="source-route-label">
                <span>资料库</span>
                <span>/</span>
                <strong>{detailView === "chunks" ? "Chunk 片段" : "Markdown Preview"}</strong>
              </div>
            </div>

            <div className="source-preview-head">
              <span className={`source-file-icon source-file-${selectedKind} large`} title={selectedIcon.label}>
                <SelectedIcon size={30} weight="duotone" aria-hidden="true" />
                <span className="sr-only">{selectedIcon.label}</span>
              </span>
              <div>
                <p className="eyebrow">Markdown Preview</p>
                <h3>{selected.title}</h3>
                <p>{selected.type} · {selected.origin}</p>
              </div>
              <StatusBadge status={selected.status} />
            </div>

            {selected.status === "ready" ? (
              <>
                <div className="index-summary compact">
                  <div>
                    <span>Chunk 数</span>
                    <strong>{selected.chunk_count ?? chunks.length}</strong>
                  </div>
                  <div>
                    <span>索引版本</span>
                    <strong>{selected.version_id ?? "未记录"}</strong>
                  </div>
                  <div>
                    <span>索引时间</span>
                    <strong>{formatDate(selected.indexed_at, true)}</strong>
                  </div>
                </div>

                <div className="context-tabs source-detail-tabs" role="tablist" aria-label="资料详情">
                  <button
                    className={detailView === "markdown" ? "active" : ""}
                    onClick={() => switchDetailView("markdown")}
                    type="button"
                  >
                    Markdown 文档
                  </button>
                  <button
                    className={detailView === "chunks" ? "active" : ""}
                    onClick={() => switchDetailView("chunks")}
                    type="button"
                  >
                    Chunk 片段
                  </button>
                </div>

                {detailView === "markdown" ? (
                  <div className="source-markdown-stage">
                    <MarkdownRenderer
                      className="source-markdown-rendered"
                      markdown={markdown}
                      emptyText="正在读取 Markdown..."
                    />
                  </div>
                ) : (
                  <div className="chunk-full-list">
                    {chunks.map((chunk) => (
                      <article className="chunk-preview" key={chunk.id}>
                        <div className="chunk-meta">
                          <strong>#{chunk.ordinal + 1}</strong>
                          <span>{chunk.heading_path.join(" / ") || "未命名片段"}</span>
                          <span>{chunk.locator}</span>
                        </div>
                        <p>{compact(chunk.text, 520)}</p>
                      </article>
                    ))}
                    {chunks.length === 0 && (
                      <div className="empty">
                        <h3>片段还在路上</h3>
                        <p>等资料索引完成，小书会把拆好的片段整整齐齐放在这里。</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="empty large source-preview-empty">
                <h3>Markdown 还没准备好</h3>
                <p>小书正在等资料处理完成，马上就能在这里读到转换结果。</p>
              </div>
            )}
          </section>
        ) : (
          <>
            <div className="section-header sources-header">
              <div>
                <p className="eyebrow">Source Library</p>
                <h2>资料</h2>
              </div>
              <button className="button" type="button" onClick={() => setImportOpen(true)}>
                <UploadSimple size={15} />
                导入资料
              </button>
            </div>

            <section className="source-overview" aria-label="资料状态概览">
              <div>
                <span>全部资料</span>
                <strong>{sourceSummary.total}</strong>
              </div>
              <div>
                <span>可问答</span>
                <strong>{sourceSummary.ready}</strong>
              </div>
              <div>
                <span>处理中</span>
                <strong>{sourceSummary.processing}</strong>
              </div>
              <div>
                <span>失败</span>
                <strong>{sourceSummary.failed}</strong>
              </div>
            </section>

            <div className="source-toolbar">
              <label className="source-search">
                <MagnifyingGlass size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索资料、类型、状态或版本"
                />
              </label>
              <span className="source-count">{visibleSources.length} / {sources.length} 个资料</span>
            </div>
            <nav className="source-breadcrumbs" aria-label="资料路径">
              <button className={activeFolderId === null ? "current" : ""} onClick={() => setActiveFolderId(null)} onDragOver={(event) => { if (draggedSourceId) event.preventDefault(); }} onDrop={(event) => acceptSourceDrop(event, null)} type="button"><FolderOpen size={14} />资料库</button>
              {breadcrumbs.map((folder, index) => (
                <span key={folder.id}><CaretRight size={11} /><button className={index === breadcrumbs.length - 1 ? "current" : ""} onClick={() => setActiveFolderId(folder.id)} onDragOver={(event) => { if (draggedSourceId) event.preventDefault(); }} onDrop={(event) => acceptSourceDrop(event, folder.id)} type="button">{folder.name}</button></span>
              ))}
            </nav>
            <div className={`source-library-actions ${selectionMode ? "selecting" : ""}`.trim()}>
              {selectionMode ? (
                <div className="source-selection-toolbar">
                  <button className="button secondary" onClick={toggleAllVisibleSources} type="button">
                    {allVisibleSourcesSelected ? <CheckSquare size={16} weight="fill" /> : <Square size={16} />}
                    {allVisibleSourcesSelected ? "取消全选" : "全选当前列表"}
                  </button>
                  <span className="source-selection-count">已选择 {selectedSourceIds.size} 个</span>
                  <button className="button danger" disabled={selectedSourceIds.size === 0 || loading} onClick={deleteSelectedSources} type="button"><Trash size={16} />删除所选</button>
                  <button className="button ghost" onClick={exitSelectionMode} type="button"><X size={15} />取消</button>
                </div>
              ) : (
                <>
                  <div className="source-library-primary-actions">
                    <button className="button secondary" onClick={createFolder} type="button"><Folder size={16} />新建目录</button>
                    <button className="button secondary" disabled={visibleSources.length === 0} onClick={() => setSelectionMode(true)} type="button"><CheckSquare size={16} />选择</button>
                  </div>
                  {activeFolderId && <button className="button ghost source-parent-button" onClick={() => setActiveFolderId(folders.find((folder) => folder.id === activeFolderId)?.parent_id ?? null)} type="button"><ArrowLeft size={15} />返回上一级</button>}
                </>
              )}
            </div>

            <div
              className={`source-card-grid source-drop-surface ${boardDragActive ? "dragging" : ""}`.trim()}
              onDragEnter={handleBoardDragEnter}
              onDragLeave={handleBoardDragLeave}
              onDragOver={handleBoardDragOver}
              onDrop={handleBoardDrop}
            >
              {boardDragActive && (
                <div className="source-drop-overlay">
                  <UploadSimple size={26} />
                  <strong>松开即可导入资料</strong>
                  <span>多个文件会一起上传、转换成 Markdown 并写入索引。</span>
                </div>
              )}
              {currentFolders.map((folder) => (
                <article className={`source-card source-folder-card ${dragOverFolderId === folder.id ? "drop-target" : ""}`.trim()} key={folder.id} onClick={() => setActiveFolderId(folder.id)} onDragEnter={(event) => { if (draggedSourceId) { event.preventDefault(); setDragOverFolderId(folder.id); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverFolderId(null); }} onDragOver={(event) => { if (draggedSourceId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => acceptSourceDrop(event, folder.id)} onKeyDown={(event) => { if (event.key === "Enter") setActiveFolderId(folder.id); }} role="button" tabIndex={0}>
                  <div className="source-folder-visual" aria-hidden="true"><span /></div>
                  <div className="source-card-body"><h3>{folder.name}</h3><p>{sources.filter((source) => source.folder_id === folder.id).length} 个资料</p></div>
                  <div className="source-folder-actions" onClick={(event) => event.stopPropagation()}><button aria-label={`重命名目录：${folder.name}`} className="icon-button" onClick={() => renameFolder(folder)} type="button"><PencilSimple size={15} /></button><button aria-label={`删除目录：${folder.name}`} className="icon-button danger-text" onClick={() => deleteFolder(folder)} type="button"><Trash size={15} /></button></div>
                </article>
              ))}
              {visibleSources.map((source) => {
                const kind = sourceKind(source);
                const icon = sourceIconConfig(kind);
                const CardIcon = icon.Icon;
                return (
                  <article
                    aria-label={selectionMode ? `${selectedSourceIds.has(source.id) ? "取消选择" : "选择"}资料：${source.title}` : `打开资料预览：${source.title}`}
                    aria-pressed={selectionMode ? selectedSourceIds.has(source.id) : undefined}
                    className={`source-card source-file-card ${source.enabled ? "" : "disabled"} ${draggedSourceId === source.id ? "dragging-source" : ""} ${selectedSourceIds.has(source.id) ? "selected" : ""}`.trim()}
                    draggable={!selectionMode}
                    key={source.id}
                    onDragEnd={() => { setDraggedSourceId(null); setDragOverFolderId(null); }}
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-learnfast-source", source.id); setDraggedSourceId(source.id); }}
                    onClick={() => selectionMode ? toggleSourceSelection(source.id) : openSource(source)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (selectionMode) toggleSourceSelection(source.id);
                        else openSource(source);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="source-card-top">
                      <div className="source-card-leading">
                        {selectionMode && (
                          <span className={`source-card-selector ${selectedSourceIds.has(source.id) ? "selected" : ""}`} aria-hidden="true">
                            {selectedSourceIds.has(source.id) ? <CheckSquare size={20} weight="fill" /> : <Square size={20} />}
                          </span>
                        )}
                        <span className={`source-file-icon source-file-${kind}`} title={icon.label}>
                          <CardIcon size={24} weight="duotone" aria-hidden="true" />
                          <span className="sr-only">{icon.label}</span>
                        </span>
                      </div>
                      <StatusBadge status={source.status} />
                    </div>
                    <div className="source-card-body">
                      <h3>{source.title}</h3>
                      <p title={source.origin}>{source.type} · {source.origin}</p>
                    </div>
                    <dl className="source-card-meta">
                      <div>
                        <dt>片段</dt>
                        <dd>{source.chunk_count ?? 0}</dd>
                      </div>
                      <div>
                        <dt>版本</dt>
                        <dd>{source.version_id ?? "未记录"}</dd>
                      </div>
                      <div>
                        <dt>索引</dt>
                        <dd>{formatDate(source.indexed_at)}</dd>
                      </div>
                    </dl>
                    {source.error_message && <p className="error-line">{source.error_message}</p>}
                    {!selectionMode && <div className="source-card-actions" onClick={(event) => event.stopPropagation()}>
                      <button className="button ghost" type="button" onClick={() => openSource(source)}>
                        <CardIcon size={15} weight="duotone" />
                        预览
                      </button>
                      <button className="button ghost" type="button" onClick={() => toggleEnabled(source)}>
                        <Power size={15} />
                        {source.enabled ? "停用" : "启用"}
                      </button>
                      {source.status === "failed" && (
                        <button className="button ghost" type="button" onClick={() => retry(source)}>
                          <ArrowClockwise size={15} />
                          重试
                        </button>
                      )}
                      <button className="button ghost danger-text" type="button" onClick={() => deleteSource(source)}>
                        <Trash size={15} />
                        删除
                      </button>
                    </div>}
                  </article>
                );
              })}
              {sources.length === 0 && (
                <div className="empty source-grid-empty">
                  <h3>这里还没有资料</h3>
                  <p>把文件轻轻拖进来，小书会帮你转成 Markdown，之后就能一起问答啦。</p>
                </div>
              )}
              {sources.length > 0 && currentFolders.length === 0 && visibleSources.length === 0 && (
                <div className="empty source-grid-empty">
                  <h3>暂时没找到</h3>
                  <p>换个关键词试试，或者清空搜索，让小书把所有资料都摆出来。</p>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <section
            aria-modal="true"
            className="source-import-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="source-import-modal-head">
              <div>
                <p className="eyebrow">Import Source</p>
                <h3>导入资料</h3>
              </div>
              <button className="button ghost" type="button" onClick={() => setImportOpen(false)}>
                <X size={15} />
                关闭
              </button>
            </div>

            <div className="source-import-grid">
              <div
                className={`panel upload-dropzone ${fileDragActive ? "dragging" : ""}`.trim()}
                onDragEnter={handleFileDragEnter}
                onDragLeave={handleFileDragLeave}
                onDragOver={handleFileDragOver}
                onDrop={handleFileDrop}
              >
                <p className="upload-location"><FolderOpen size={15} />保存到：资料库{breadcrumbs.map((folder) => ` / ${folder.name}`).join("")}</p>
                <label>
                  上传文件
                  <input
                    accept=".pdf,.docx,.pptx,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.epub,.csv,.xls,.xlsx"
                    className="native-file-input"
                    multiple
                    onChange={() => updateFileSummary()}
                    ref={fileInputRef}
                    type="file"
                  />
                </label>
                <div className="file-picker">
                  <button
                    className="button secondary"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <FileArrowUp size={15} />
                    选择文件
                  </button>
                  <span title={fileSummary}>{fileSummary}</span>
                </div>
                <p className="drop-hint">也可以一次拖拽多个文件到这里上传。</p>
                <button className="button" disabled={loading} onClick={() => upload()} type="button">
                  <UploadSimple size={15} />
                  {loading ? "处理中..." : "上传并转换"}
                </button>
              </div>

              <form className="panel" onSubmit={importUrl}>
                <label>
                  网页或 YouTube 链接
                  <input
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://..."
                    value={url}
                  />
                </label>
                <label>
                  标题
                  <input
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="可选"
                    value={title}
                  />
                </label>
                <button className="button" disabled={loading || !url.trim()}>
                  <LinkSimple size={15} />
                  导入链接
                </button>
              </form>
            </div>
          </section>
        </div>
      )}
      {dialog.node}
    </div>
  );
}

function sourceKind(source: Source): SourceKind {
  const value = `${source.type ?? ""} ${source.origin ?? ""}`.toLowerCase();
  const extension = value.match(/\.([a-z0-9]+)(?:[?#]|\s|$)/)?.[1] ?? source.type.toLowerCase();

  if (value.includes("youtube") || value.startsWith("url") || source.type === "url") return "url";
  if (["md", "markdown"].includes(extension)) return "md";
  if (["ppt", "pptx", "key"].includes(extension)) return "pptx";
  if (["doc", "docx"].includes(extension)) return "docx";
  if (["xls", "xlsx"].includes(extension)) return "xlsx";
  if (extension === "csv") return "csv";
  if (["html", "htm"].includes(extension)) return "html";
  if (["js", "jsx", "ts", "tsx", "py", "sql", "css", "json"].includes(extension)) return "code";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "img";
  if (["mp3", "wav", "m4a", "ogg"].includes(extension)) return "audio";
  if (["mp4", "mov", "webm"].includes(extension)) return "video";
  if (["zip", "rar", "7z"].includes(extension)) return "zip";
  if (extension === "pdf") return "pdf";
  if (extension === "epub") return "epub";
  if (extension === "txt") return "txt";
  return "file";
}

function sourceIconConfig(kind: SourceKind): SourceIconConfig {
  const configs: Record<SourceKind, SourceIconConfig> = {
    audio: { Icon: FileAudio, label: "音频文件" },
    code: { Icon: FileCode, label: "代码文件" },
    csv: { Icon: FileCsv, label: "CSV 文件" },
    docx: { Icon: FileDoc, label: "Word 文档" },
    epub: { Icon: FileText, label: "EPUB 文档" },
    file: { Icon: FileIcon, label: "文件" },
    html: { Icon: FileHtml, label: "HTML 文件" },
    img: { Icon: FileImage, label: "图片文件" },
    md: { Icon: FileMd, label: "Markdown 文件" },
    pdf: { Icon: FilePdf, label: "PDF 文件" },
    pptx: { Icon: FilePpt, label: "演示文稿" },
    txt: { Icon: FileText, label: "文本文件" },
    url: { Icon: GlobeSimple, label: "网页链接" },
    video: { Icon: FileVideo, label: "视频文件" },
    xlsx: { Icon: FileXls, label: "表格文件" },
    zip: { Icon: FileZip, label: "压缩文件" },
  };
  return configs[kind];
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    hour: withTime ? "2-digit" : undefined,
    minute: withTime ? "2-digit" : undefined,
    month: "2-digit",
    year: "2-digit",
  });
}

function compact(text: string, limit = 220) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}

function hasDroppedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}
