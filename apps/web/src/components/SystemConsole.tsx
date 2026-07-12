import { ArrowDown, ArrowsClockwise, Broom, TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { api } from "../lib/api";
import { TransientNotice } from "./TransientNotice";
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
  const [newLogCount, setNewLogCount] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastSeenLogIdRef = useRef<number | null>(null);
  const pinnedToBottomRef = useRef(true);

  const scopeLabel = useMemo(
    () => (spaceId ? "当前空间 + 全局" : "全局"),
    [spaceId],
  );

  const isNearBottom = () => {
    const list = listRef.current;
    if (!list) return true;
    return list.scrollHeight - list.scrollTop - list.clientHeight < 56;
  };

  const scrollToLatest = () => {
    endRef.current?.scrollIntoView({ block: "end" });
    pinnedToBottomRef.current = true;
    setNewLogCount(0);
  };

  const handleLogScroll = () => {
    pinnedToBottomRef.current = isNearBottom();
    if (pinnedToBottomRef.current) {
      setNewLogCount(0);
    }
  };

  const applyLogs = (rows: SystemLog[]) => {
    const latestId = rows.length > 0 ? rows[rows.length - 1].id : null;
    const previousLatestId = lastSeenLogIdRef.current;
    const initialLoad = previousLatestId === null;
    const addedCount =
      latestId !== null && previousLatestId !== null
        ? rows.filter((log) => log.id > previousLatestId).length
        : 0;
    const hasNewLogs = addedCount > 0;

    lastSeenLogIdRef.current = latestId;
    setLogs(rows);

    if (initialLoad || (hasNewLogs && pinnedToBottomRef.current)) {
      window.requestAnimationFrame(scrollToLatest);
    } else if (hasNewLogs) {
      setNewLogCount((count) => count + addedCount);
    }
  };

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listSystemLogs({ spaceId, limit: 140 });
      applyLogs(rows);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "控制台日志加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    lastSeenLogIdRef.current = null;
    pinnedToBottomRef.current = true;
    setNewLogCount(0);
    const load = async () => {
      try {
        const rows = await api.listSystemLogs({ spaceId, limit: 140 });
        if (!cancelled) {
          applyLogs(rows);
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

  return (
    <div className={`system-console ${open ? "open" : ""}`}>
      <button
        className="console-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <TerminalWindow size={15} />
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
                <ArrowsClockwise size={15} />
                {loading ? "刷新中" : "刷新"}
              </button>
              <button className="button ghost" onClick={() => setLogs([])}>
                <Broom size={15} />
                清空视图
              </button>
            </div>
          </header>

          {error && <TransientNotice message={error} tone="danger" onDismiss={() => setError(null)} />}
          {newLogCount > 0 && (
            <button className="console-jump button secondary" type="button" onClick={scrollToLatest}>
              <ArrowDown size={15} />
              {newLogCount} 条新日志
            </button>
          )}

          <div className="console-log-list" ref={listRef} onScroll={handleLogScroll}>
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
                <LogDetailSummary details={log.details} />
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
                <h3>控制台现在很安静</h3>
                <p>上传、索引、问答或模型测试开始后，小书会把处理过程放到这里。</p>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </section>
      )}
    </div>
  );
}

function LogDetailSummary({ details }: { details: Record<string, unknown> }) {
  const preferredKeys = [
    "title",
    "operation",
    "stage",
    "result",
    "status",
    "progress",
    "type",
    "source_id",
    "job_id",
    "file_size_bytes",
    "markdown_chars",
    "chunk_count",
    "version_id",
    "error_code",
    "error",
  ];
  const entries = preferredKeys
    .filter((key) => details[key] !== undefined && details[key] !== null && details[key] !== "")
    .slice(0, 8)
    .map((key) => [key, details[key]] as const);
  if (entries.length === 0) return null;
  return (
    <dl className="console-detail-grid">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{detailLabel(key)}</dt>
          <dd title={formatDetailValue(value)}>{formatDetailValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function detailLabel(key: string) {
  const labels: Record<string, string> = {
    chunk_count: "分块",
    error: "错误",
    error_code: "错误码",
    file_size_bytes: "大小",
    job_id: "任务",
    markdown_chars: "Markdown",
    operation: "操作",
    progress: "进度",
    result: "结果",
    source_id: "资料",
    stage: "阶段",
    status: "状态",
    title: "对象",
    type: "类型",
    version_id: "版本",
  };
  return labels[key] ?? key;
}

function formatDetailValue(value: unknown) {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
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
