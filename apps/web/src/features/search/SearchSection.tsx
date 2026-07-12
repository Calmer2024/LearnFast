import {
  ArrowSquareOut,
  Brain,
  CalendarCheck,
  FileText,
  Files,
  MagnifyingGlass,
  NotePencil,
} from "@phosphor-icons/react";
import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../lib/api";
import { TransientNotice } from "../../components/TransientNotice";
import type { SearchResult } from "../../lib/types";

const resultLabels: Record<SearchResult["result_type"], string> = {
  source_title: "资料标题",
  source_chunk: "资料片段",
  note: "笔记",
  note_chunk: "笔记片段",
  memory: "记忆",
  plan_task: "计划任务",
};

const resultIcons: Record<SearchResult["result_type"], typeof Files> = {
  source_title: Files,
  source_chunk: FileText,
  note: NotePencil,
  note_chunk: NotePencil,
  memory: Brain,
  plan_task: CalendarCheck,
};

export function SearchSection({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const next: Partial<Record<SearchResult["result_type"], number>> = {};
    for (const result of results) {
      next[result.result_type] = (next[result.result_type] ?? 0) + 1;
    }
    return next;
  }, [results]);

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.search(spaceId, value);
      setResults(response.results);
      setSearchedQuery(response.query);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "搜索失败");
    } finally {
      setBusy(false);
    }
  };

  const openResult = (result: SearchResult) => {
    if (result.result_type === "source_title" || result.result_type === "source_chunk") {
      navigate(`/spaces/${spaceId}/sources?source=${result.source_id}&view=markdown`);
      return;
    }
    if (result.result_type === "note" || result.result_type === "note_chunk") {
      navigate(`/spaces/${spaceId}/notes`);
      return;
    }
    if (result.result_type === "plan_task") {
      navigate(`/spaces/${spaceId}/plans`);
      return;
    }
    if (result.result_type === "memory") {
      navigate(`/spaces/${spaceId}/memories`);
    }
  };

  return (
    <div className="search-layout">
      <section className="search-main">
        <div className="search-header">
          <div>
            <p className="eyebrow">Unified Search</p>
            <h2>空间搜索</h2>
          </div>
        </div>

        {error && <TransientNotice message={error} tone="danger" onDismiss={() => setError(null)} />}

        <form className="search-composer" onSubmit={runSearch}>
          <label className="search-field large">
            <MagnifyingGlass size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索资料、笔记、记忆和计划任务"
            />
          </label>
          <button className="button" disabled={busy || !query.trim()}>
            <MagnifyingGlass size={15} />
            搜索
          </button>
        </form>

        <section className="search-overview">
          <div>
            <span>结果</span>
            <strong>{results.length}</strong>
          </div>
          <div>
            <span>资料</span>
            <strong>{(counts.source_title ?? 0) + (counts.source_chunk ?? 0)}</strong>
          </div>
          <div>
            <span>笔记</span>
            <strong>{(counts.note ?? 0) + (counts.note_chunk ?? 0)}</strong>
          </div>
          <div>
            <span>计划/记忆</span>
            <strong>{(counts.plan_task ?? 0) + (counts.memory ?? 0)}</strong>
          </div>
        </section>

        <section className="search-results">
          {results.map((result) => {
            const Icon = resultIcons[result.result_type];
            return (
              <article className="search-result-card" key={result.id}>
                <div className="search-result-head">
                  <span className="search-result-type">
                    <Icon size={15} />
                    {resultLabels[result.result_type]}
                  </span>
                  <span className="search-score">{Math.round(result.score * 100)}%</span>
                </div>
                <h3>{result.title}</h3>
                <p>{result.quote_snapshot || result.source_title}</p>
                <div className="search-result-meta">
                  <span>{result.source_title}</span>
                  {result.heading_path.length > 0 && <span>{result.heading_path.join(" / ")}</span>}
                  <span>{result.locator}</span>
                </div>
                <button className="button ghost" type="button" onClick={() => openResult(result)}>
                  <ArrowSquareOut size={15} />
                  打开
                </button>
              </article>
            );
          })}
          {searchedQuery && results.length === 0 && (
            <div className="empty large">
              <h3>小书暂时没翻到</h3>
              <p>换个更轻一点的关键词，或者先补充资料和笔记再试试。</p>
            </div>
          )}
          {!searchedQuery && (
            <div className="empty large">
              <h3>想找什么呀</h3>
              <p>输入关键词，小书会帮你翻资料、笔记、记忆和计划任务。</p>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
