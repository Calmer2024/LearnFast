import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { api } from "../lib/api";
import type { SystemLog } from "../lib/types";

const categoryLabels: Record<string, string> = {
  space: "空间",
  model: "模型",
  source: "资料",
  search: "搜索",
  rag: "RAG",
  chat: "问答",
  note: "笔记",
  feedback: "反馈",
};

export function SystemConsole() {
  const { spaceId } = useParams();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const scopeLabel = useMemo(
    () => (spaceId ? "当前空间 + 全局" : "全局"),
    [spaceId],
  );

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listSystemLogs({ spaceId, limit: 140 });
      setLogs(rows);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "控制台日志加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await api.listSystemLogs({ spaceId, limit: 140 });
        if (!cancelled) {
          setLogs(rows);
          setError(null);
        }
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : "控制台日志加载失败");
        }
      }
    };
    load();
    const timer = window.setInterval(load, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, spaceId]);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [logs, open]);

  return (
    <div className={`system-console ${open ? "open" : ""}`}>
      <button
        className="console-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? "折叠控制台" : "控制台"}
      </button>

      {open && (
        <section className="console-panel" aria-label="系统控制台">
          <header className="console-header">
            <div>
              <p className="eyebrow">System Console</p>
              <h2>系统控制台</h2>
              <p className="muted">范围：{scopeLabel}</p>
            </div>
            <div className="console-actions">
              <button className="button ghost" onClick={loadLogs} disabled={loading}>
                {loading ? "刷新中" : "刷新"}
              </button>
              <button className="button ghost" onClick={() => setLogs([])}>
                清空视图
              </button>
            </div>
          </header>

          {error && <div className="notice danger">{error}</div>}

          <div className="console-log-list">
            {logs.map((log) => (
              <article className={`console-entry level-${log.level}`} key={log.id}>
                <div className="console-entry-head">
                  <span className="console-time">{formatTime(log.created_at)}</span>
                  <span className="console-level">{log.level}</span>
                  <span className="console-category">
                    {categoryLabels[log.category] ?? log.category}
                  </span>
                </div>
                <p>{log.message}</p>
                {Object.keys(log.details).length > 0 && (
                  <details>
                    <summary>处理细节</summary>
                    <pre>{JSON.stringify(log.details, null, 2)}</pre>
                  </details>
                )}
              </article>
            ))}
            {logs.length === 0 && !error && (
              <div className="empty console-empty">
                <h3>还没有核心日志</h3>
                <p>执行上传、索引、问答、检索或模型测试后，这里会显示系统处理过程。</p>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </section>
      )}
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
