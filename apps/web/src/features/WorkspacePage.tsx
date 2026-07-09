import {
  ArrowLeft,
  Brain,
  CalendarCheck,
  ChartLine,
  ChatTeardropText,
  Files,
  NotePencil,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { Space } from "../lib/types";
import { LearningSection } from "./learning/LearningSection";
import { MemoriesSection } from "./memories/MemoriesSection";
import { NotesSection } from "./notes/NotesSection";
import { SourcesSection } from "./sources/SourcesSection";

const sections = [
  { id: "learning", label: "学习", icon: ChatTeardropText },
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
    if (activeSection === "sources") return <SourcesSection spaceId={spaceId} />;
    if (activeSection === "notes") return <NotesSection spaceId={spaceId} />;
    if (activeSection === "memories") return <MemoriesSection spaceId={spaceId} />;
    return <PlaceholderSection section={activeSection} />;
  }, [activeSection, spaceId]);

  if (!spaceId) return <Navigate to="/" replace />;

  return (
    <main className="workspace">
      <aside className="workspace-sidebar">
        <Link className="back-link" to="/">
          <ArrowLeft size={14} />
          返回空间
        </Link>
        <div className="workspace-title">
          <h1>{space?.name ?? "学习空间"}</h1>
          {space && <StatusBadge status={space.status} />}
        </div>
        <p>{space?.goal || "还没有填写学习目标。"}</p>
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
      </aside>
      <section className="workspace-main">
        {error && <div className="notice danger">{error}</div>}
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
  };
  return (
    <div className="empty large">
      <h2>{labels[section] ?? "工作区"}</h2>
      <p>MVP01-08 已完成本地骨架、模型设置、学习空间、资料导入、索引、问答、笔记和记忆。这个入口已预留给后续阶段。</p>
    </div>
  );
}
