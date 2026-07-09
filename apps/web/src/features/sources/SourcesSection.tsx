import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { StatusBadge } from "../../components/StatusBadge";
import { api } from "../../lib/api";
import type { Source, SourceChunk } from "../../lib/types";

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
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [chunks, setChunks] = useState<SourceChunk[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSources = async () => {
    const rows = await api.listSources(spaceId);
    setSources(rows);
    if (!selectedSourceId && rows.length > 0) {
      setSelectedSourceId(rows[0].id);
    }
  };

  useEffect(() => {
    loadSources().catch((exc) => setError(exc.message));
  }, [spaceId]);

  const hasProcessing = useMemo(
    () => sources.some((source) => processingStatuses.has(source.status)),
    [sources],
  );

  useEffect(() => {
    if (!hasProcessing) return;
    const timer = window.setInterval(() => {
      loadSources().catch((exc) => setError(exc.message));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasProcessing, spaceId, selectedSourceId]);

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

  const upload = async () => {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await api.uploadSources(spaceId, files);
      setMessage("资料已加入处理队列。");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadSources();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "上传失败");
    } finally {
      setLoading(false);
    }
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
      await loadSources();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "导入失败");
    } finally {
      setLoading(false);
    }
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
    const confirmed = window.confirm(`删除资料“${source.title}”？`);
    if (!confirmed) return;
    await api.deleteSource(spaceId, source.id);
    if (selectedSourceId === source.id) setSelectedSourceId(null);
    await loadSources();
  };

  return (
    <div className="sources-layout">
      <section className="sources-left">
        <div className="section-header">
          <div>
            <p className="eyebrow">Source Library</p>
            <h2>资料</h2>
          </div>
        </div>

        {error && <div className="notice danger">{error}</div>}
        {message && <div className="notice success">{message}</div>}

        <div className="panel">
          <label>
            上传文件
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.epub,.csv,.xls,.xlsx"
            />
          </label>
          <button className="button" onClick={upload} disabled={loading}>
            {loading ? "处理中..." : "上传并转换"}
          </button>
        </div>

        <form className="panel" onSubmit={importUrl}>
          <label>
            网页或 YouTube 链接
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
          <label>
            标题
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="可选"
            />
          </label>
          <button className="button" disabled={loading || !url.trim()}>
            导入链接
          </button>
        </form>

        <div className="source-list">
          {sources.map((source) => (
            <article
              className={`source-row ${selectedSourceId === source.id ? "selected" : ""}`}
              key={source.id}
              onClick={() => setSelectedSourceId(source.id)}
            >
              <div>
                <h3>{source.title}</h3>
                <p>{source.type} · {source.origin}</p>
                {source.status === "ready" && (
                  <p>
                    {source.chunk_count ?? 0} 个片段 · {source.version_id ?? "未记录版本"}
                  </p>
                )}
              </div>
              <div className="source-actions" onClick={(event) => event.stopPropagation()}>
                <StatusBadge status={source.status} />
                <button className="button ghost" onClick={() => toggleEnabled(source)}>
                  {source.enabled ? "停用" : "启用"}
                </button>
                {source.status === "failed" && (
                  <button className="button ghost" onClick={() => retry(source)}>
                    重试
                  </button>
                )}
                <button className="button ghost danger-text" onClick={() => deleteSource(source)}>
                  删除
                </button>
              </div>
              {source.error_message && <p className="error-line">{source.error_message}</p>}
            </article>
          ))}
          {sources.length === 0 && (
            <div className="empty">
              <h3>还没有资料</h3>
              <p>上传文件或导入链接，系统会转成 Markdown 供后续问答使用。</p>
            </div>
          )}
        </div>
      </section>

      <section className="preview-pane">
        <div className="section-header">
          <div>
            <p className="eyebrow">Markdown Preview</p>
            <h2>{selected?.title ?? "选择一个资料"}</h2>
          </div>
          {selected && <StatusBadge status={selected.status} />}
        </div>
        {selected?.status === "ready" ? (
          <>
            <div className="index-summary">
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
                <strong>{selected.indexed_at ? new Date(selected.indexed_at).toLocaleString() : "未记录"}</strong>
              </div>
            </div>

            {chunks.length > 0 && (
              <div className="chunk-preview-list">
                {chunks.slice(0, 3).map((chunk) => (
                  <article className="chunk-preview" key={chunk.id}>
                    <div className="chunk-meta">
                      <strong>#{chunk.ordinal + 1}</strong>
                      <span>{chunk.heading_path.join(" / ") || "未命名片段"}</span>
                      <span>{chunk.locator}</span>
                    </div>
                    <p>{compact(chunk.text)}</p>
                  </article>
                ))}
              </div>
            )}

            <pre className="markdown-preview">{markdown || "正在读取 Markdown..."}</pre>
          </>
        ) : (
          <div className="empty large">
            <h3>Markdown 尚未可用</h3>
            <p>资料处理完成后会在这里展示转换结果。</p>
          </div>
        )}
      </section>
    </div>
  );
}

function compact(text: string, limit = 220) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}
