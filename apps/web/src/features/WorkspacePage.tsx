import {
  ArrowLeft,
  Brain,
  CalendarCheck,
  ChartLine,
  ChatTeardropText,
  DownloadSimple,
  Files,
  MagnifyingGlass,
  NotePencil,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { TransientNotice } from "../components/TransientNotice";
import type { Space } from "../lib/types";
import { LearningSection } from "./learning/LearningSection";
import { MemoriesSection } from "./memories/MemoriesSection";
import { NotesSection } from "./notes/NotesSection";
import { PlansSection } from "./plans/PlansSection";
import { ReportsSection } from "./reports/ReportsSection";
import { SearchSection } from "./search/SearchSection";
import { SourcesSection } from "./sources/SourcesSection";

const sections = [
  { id: "learning", label: "学习", icon: ChatTeardropText },
  { id: "search", label: "搜索", icon: MagnifyingGlass },
  { id: "sources", label: "资料", icon: Files },
  { id: "notes", label: "笔记", icon: NotePencil },
  { id: "plans", label: "计划", icon: CalendarCheck },
  { id: "memories", label: "记忆", icon: Brain },
  { id: "reports", label: "报告", icon: ChartLine },
] as const;

export function WorkspacePage() {
  const { spaceId, section } = useParams();
  const navigate = useNavigate();
  const [space, setSpace] = useState<Space | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const activeSection = section ?? "learning";

  useEffect(() => {
    if (!spaceId) return;
    api
      .getSpace(spaceId)
      .then(setSpace)
      .catch((exc) => setError(exc.message));
  }, [spaceId]);

  const content = useMemo(() => {
    if (!spaceId) return null;
    if (activeSection === "learning") return <LearningSection spaceId={spaceId} />;
    if (activeSection === "search") return <SearchSection spaceId={spaceId} />;
    if (activeSection === "sources") return <SourcesSection spaceId={spaceId} />;
    if (activeSection === "notes") return <NotesSection spaceId={spaceId} />;
    if (activeSection === "plans") return <PlansSection spaceId={spaceId} />;
    if (activeSection === "memories") return <MemoriesSection spaceId={spaceId} />;
    if (activeSection === "reports") return <ReportsSection spaceId={spaceId} />;
    return <PlaceholderSection section={activeSection} />;
  }, [activeSection, spaceId]);

  if (!spaceId) return <Navigate to="/" replace />;

  const exportSpace = async () => {
    if (!spaceId || !space) return;
    setExporting(true);
    setError(null);
    try {
      const result = await api.exportSpaceMarkdown(spaceId);
      const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFilename(result.title)}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "空间导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="workspace">
      <aside className="workspace-sidebar">
        <div className="workspace-heading">
          <div className="workspace-title">
            <h1>{space?.name ?? "学习空间"}</h1>
            {space && <StatusBadge status={space.status} />}
          </div>
          <Link className="back-link" to="/">
            <ArrowLeft size={14} />
            返回空间
          </Link>
        </div>
        <p className="workspace-goal">{space?.goal || "还没有填写 README。"}</p>
        <nav className="workspace-nav">
          {sections.map((item) => (
            <button
              className={item.id === activeSection ? "active" : ""}
              key={item.id}
              onClick={() => navigate(`/spaces/${spaceId}/${item.id}`)}
            >
              <item.icon size={16} weight={item.id === activeSection ? "fill" : "regular"} />
              {item.label}
            </button>
          ))}
        </nav>
        <button className="workspace-export" disabled={exporting || !space} onClick={exportSpace} type="button">
          <DownloadSimple size={15} />
          {exporting ? "导出中..." : "导出空间"}
        </button>
      </aside>
      <section className="workspace-main">
        {error && <TransientNotice message={error} tone="danger" onDismiss={() => setError(null)} />}
        {content}
      </section>
    </main>
  );
}

function PlaceholderSection({ section }: { section: string }) {
  const labels: Record<string, string> = {
    learning: "学习问答",
    notes: "笔记",
    plans: "计划",
    memories: "记忆",
    reports: "报告",
    search: "搜索",
  };
  return (
    <div className="empty large">
      <h2>{labels[section] ?? "工作区"}</h2>
      <p>这个入口还在安静准备中，之后会和当前知识库一起长出更多能力。</p>
    </div>
  );
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "learnfast-space";
}
