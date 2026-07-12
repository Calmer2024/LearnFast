import {
  CheckCircle,
  DownloadSimple,
  Files,
  FloppyDisk,
  MagicWand,
  NotePencil,
} from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { TransientNotice } from "../../components/TransientNotice";
import { api } from "../../lib/api";
import type { LearningReport, Source } from "../../lib/types";

export function ReportsSection({ spaceId }: { spaceId: string }) {
  const [reports, setReports] = useState<LearningReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<LearningReport | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [rangeStart, setRangeStart] = useState(() => localDateOffset(-7));
  const [rangeEnd, setRangeEnd] = useState(() => localDateOffset(0));
  const [title, setTitle] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const readySources = useMemo(
    () => sources.filter((source) => source.status === "ready" && source.enabled),
    [sources],
  );
  const counts = selectedReport?.metadata.counts ?? {};

  const load = async () => {
    const [reportRows, sourceRows] = await Promise.all([
      api.listReports(spaceId),
      api.listSources(spaceId),
    ]);
    setReports(reportRows);
    setSources(sourceRows);
    if (reportRows.length > 0) {
      const current = await api.getReport(spaceId, reportRows[0].id);
      setSelectedReport(current);
    } else {
      setSelectedReport(null);
    }
  };

  useEffect(() => {
    load().catch((exc) => setError(exc instanceof Error ? exc.message : "报告加载失败"));
  }, [spaceId]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "报告操作失败");
    } finally {
      setBusy(false);
    }
  };

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    await runAction(async () => {
      const report = await api.generateReport(spaceId, {
        range_start: rangeStart || null,
        range_end: rangeEnd || null,
        source_ids: selectedSourceIds,
        include_notes: includeNotes,
        include_memories: includeMemories,
        title: title.trim() || undefined,
      });
      setSelectedReport(report);
      setReports(await api.listReports(spaceId));
      setNotice("学习报告已生成。");
    });
  };

  const openReport = async (report: LearningReport) => {
    await runAction(async () => {
      setSelectedReport(await api.getReport(spaceId, report.id));
    });
  };

  const saveAsNote = async () => {
    if (!selectedReport) return;
    await runAction(async () => {
      const result = await api.saveReportNote(spaceId, selectedReport.id);
      setSelectedReport(result.report);
      setReports(await api.listReports(spaceId));
      setNotice("报告已保存为笔记。");
    });
  };

  const exportMarkdown = async () => {
    if (!selectedReport) return;
    await runAction(async () => {
      const result = await api.exportReportMarkdown(spaceId, selectedReport.id);
      const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFilename(result.title)}.md`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("报告已导出为 Markdown。");
    });
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  };

  return (
    <div className="reports-layout">
      <section className="reports-main">
        <div className="reports-header">
          <div>
            <p className="eyebrow">Report Loop</p>
            <h2>{selectedReport?.title ?? "学习报告"}</h2>
          </div>
          <div className="report-actions">
            <button className="button ghost" disabled={busy || !selectedReport} onClick={saveAsNote} type="button">
              <FloppyDisk size={15} />
              保存为笔记
            </button>
            <button className="button ghost" disabled={busy || !selectedReport} onClick={exportMarkdown} type="button">
              <DownloadSimple size={15} />
              导出 Markdown
            </button>
          </div>
        </div>

        {error && <TransientNotice message={error} tone="danger" onDismiss={() => setError(null)} />}
        {notice && <TransientNotice message={notice} tone="success" onDismiss={() => setNotice(null)} />}

        {selectedReport ? (
          <>
            <section className="report-overview">
              <div>
                <span>证据</span>
                <strong>{selectedReport.metadata.evidence_count ?? 0}</strong>
              </div>
              <div>
                <span>完成</span>
                <strong>{counts.completed_tasks ?? 0}</strong>
              </div>
              <div>
                <span>未完成</span>
                <strong>{counts.unfinished_tasks ?? 0}</strong>
              </div>
              <div>
                <span>问答</span>
                <strong>{counts.cited_messages ?? 0}</strong>
              </div>
            </section>

            <section className="report-context">
              <span>{selectedReport.range_start} 至 {selectedReport.range_end}</span>
              <span>{selectedReport.source_ids.length > 0 ? `${selectedReport.source_ids.length} 个资料范围` : "全部资料范围"}</span>
              <span>{selectedReport.status === "saved_note" ? "已保存笔记" : "已生成"}</span>
              {selectedReport.saved_note_id && <span>笔记 {selectedReport.saved_note_id.slice(0, 8)}</span>}
            </section>

            <div className="report-markdown-stage">
              <MarkdownRenderer markdown={selectedReport.markdown ?? ""} emptyText="报告内容为空。" />
            </div>
          </>
        ) : (
          <div className="empty large">
            <h2>还没有学习报告</h2>
            <p>等你积累一点问答、笔记和计划进度，小书就能帮你整理阶段小结。</p>
          </div>
        )}
      </section>

      <aside className="reports-side">
        <section className="panel">
          <p className="eyebrow">Generate</p>
          <h3>生成报告</h3>
          <form className="report-form" onSubmit={generate}>
            <label>
              报告标题
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可留空自动生成" />
            </label>
            <div className="report-date-grid">
              <label>
                开始日期
                <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
              </label>
              <label>
                结束日期
                <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
              </label>
            </div>
            <div className="report-source-list">
              <div className="report-source-list-head">
                <Files size={15} />
                <span>{selectedSourceIds.length > 0 ? `${selectedSourceIds.length} 个资料` : "全部资料"}</span>
              </div>
              {readySources.map((source) => (
                <label className="report-source-option" key={source.id}>
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes(source.id)}
                    onChange={() => toggleSource(source.id)}
                  />
                  <span>{source.title}</span>
                </label>
              ))}
            </div>
            <label className="inline-check report-check">
              <input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
              包含笔记
            </label>
            <label className="inline-check report-check">
              <input type="checkbox" checked={includeMemories} onChange={(event) => setIncludeMemories(event.target.checked)} />
              包含记忆
            </label>
            <button className="button" disabled={busy}>
              <MagicWand size={15} />
              生成报告
            </button>
          </form>
        </section>

        <section className="panel report-history-panel">
          <p className="eyebrow">History</p>
          <h3>历史报告</h3>
          <div className="report-list">
            {reports.map((report) => (
              <button
                className={selectedReport?.id === report.id ? "active" : ""}
                disabled={busy}
                key={report.id}
                onClick={() => openReport(report)}
                type="button"
              >
                <span>
                  {report.status === "saved_note" ? <CheckCircle size={15} weight="fill" /> : <NotePencil size={15} />}
                  {report.title}
                </span>
                <small>{formatDate(report.updated_at)}</small>
              </button>
            ))}
            {reports.length === 0 && (
              <div className="empty report-list-empty">
                <h3>还没有历史报告</h3>
                <p>小书会等你多学一点再整理。</p>
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function localDateOffset(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "learning-report";
}
