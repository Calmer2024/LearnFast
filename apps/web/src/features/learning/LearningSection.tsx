import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../lib/api";
import type { ChatMessage, ChatStreamEvent, Citation, RetrievalTrace, Source } from "../../lib/types";

export function LearningSection({ spaceId }: { spaceId: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [question, setQuestion] = useState("");
  const [useMqe, setUseMqe] = useState(true);
  const [useHyde, setUseHyde] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [feedbackMessageIds, setFeedbackMessageIds] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);

  const readySources = useMemo(
    () => sources.filter((source) => source.status === "ready" && source.enabled),
    [sources],
  );
  const readySourceIds = useMemo(() => readySources.map((source) => source.id), [readySources]);

  useEffect(() => {
    let mounted = true;
    Promise.all([api.listSources(spaceId), api.listChatMessages(spaceId)])
      .then(([sourceRows, messageRows]) => {
        if (!mounted) return;
        setSources(sourceRows);
        setMessages(messageRows);
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : "学习页加载失败"));
    return () => {
      mounted = false;
    };
  }, [spaceId]);

  useEffect(() => {
    if (selectionTouched) return;
    setSelectedSourceIds(readySourceIds);
  }, [readySourceIds, selectionTouched]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  const submitQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || streaming) return;
    setError(null);
    setNotice(null);
    setStreaming(true);
    setQuestion("");

    const selectedReadyIds = selectedSourceIds.filter((id) => readySourceIds.includes(id));
    const allReadySelected = readySourceIds.length > 0 && selectedReadyIds.length === readySourceIds.length;

    try {
      await api.streamChat(
        spaceId,
        {
          question: value,
          source_ids: allReadySelected ? null : selectedReadyIds,
          use_mqe: useMqe,
          use_hyde: useHyde,
        },
        handleStreamEvent,
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "问答失败");
    } finally {
      setStreaming(false);
    }
  };

  const handleStreamEvent = (event: ChatStreamEvent) => {
    if (event.type === "start") {
      setMessages((current) => upsertMany(current, [event.user_message, event.assistant_message]));
      return;
    }
    if (event.type === "retrieval") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.message_id
            ? { ...message, citations: event.citations, context_snapshot: event.search }
            : message,
        ),
      );
      return;
    }
    if (event.type === "token") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.message_id
            ? { ...message, content: `${message.content}${event.content}` }
            : message,
        ),
      );
      return;
    }
    if (event.type === "done") {
      setMessages((current) => upsertMany(current, [event.message]));
      return;
    }
    if (event.type === "error") {
      setError(event.message);
    }
  };

  const toggleSource = (sourceId: string) => {
    setSelectionTouched(true);
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  };

  const saveAsNote = async (message: ChatMessage) => {
    setError(null);
    setNotice(null);
    try {
      const note = await api.saveChatNote(spaceId, message.id);
      setSavedMessageIds((current) => new Set(current).add(message.id));
      setNotice(`已保存为笔记：${note.title}`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "保存笔记失败");
    }
  };

  const submitFeedback = async (message: ChatMessage, rating: "up" | "down") => {
    setError(null);
    try {
      await api.submitChatFeedback(spaceId, message.id, {
        rating,
        issue_type: rating === "down" ? "answer_quality" : undefined,
      });
      setFeedbackMessageIds((current) => new Set(current).add(message.id));
      setNotice(rating === "up" ? "已记录：这条回答有帮助。" : "已记录：后续会用这类反馈改进检索与回答。");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "提交反馈失败");
    }
  };

  return (
    <div className="learning-layout">
      <section className="chat-pane">
        <div className="section-header">
          <div>
            <p className="eyebrow">Learning Chat</p>
            <h2>学习问答</h2>
          </div>
        </div>

        {error && <div className="notice danger">{error}</div>}
        {notice && <div className="notice success">{notice}</div>}

        <div className="message-list">
          {messages.length === 0 && (
            <div className="empty chat-empty">
              <h3>开始基于资料提问</h3>
              <p>选择来源范围后输入问题。回答会默认展示引用，资料不足时会明确说明。</p>
            </div>
          )}
          {messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="message-label">{message.role === "user" ? "你" : "LearnFast"}</div>
              <div className="message-body">{message.content || "正在生成回答..."}</div>
              {message.role === "assistant" && (
                <>
                  <SearchSummary trace={message.context_snapshot} />
                  <CitationList citations={message.citations} />
                  <div className="message-actions">
                    <button
                      className="button ghost"
                      disabled={!message.content || savedMessageIds.has(message.id)}
                      onClick={() => saveAsNote(message)}
                    >
                      {savedMessageIds.has(message.id) ? "已保存" : "保存为笔记"}
                    </button>
                    <button
                      className="button ghost"
                      disabled={!message.content || feedbackMessageIds.has(message.id)}
                      onClick={() => submitFeedback(message, "up")}
                    >
                      有帮助
                    </button>
                    <button
                      className="button ghost"
                      disabled={!message.content || feedbackMessageIds.has(message.id)}
                      onClick={() => submitFeedback(message, "down")}
                    >
                      有问题
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
          <div ref={endRef} />
        </div>

        <form className="chat-composer" onSubmit={submitQuestion}>
          <textarea
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：这些资料中 Pandas 数据清洗的核心步骤是什么？"
          />
          <button className="button" disabled={streaming || !question.trim()}>
            {streaming ? "回答中..." : "提问"}
          </button>
        </form>
      </section>

      <aside className="context-panel">
        <section className="panel">
          <div className="section-header compact">
            <div>
              <p className="eyebrow">Source Scope</p>
              <h3>来源范围</h3>
            </div>
          </div>
          <div className="source-scope-actions">
            <button
              className="button ghost"
              onClick={() => {
                setSelectionTouched(true);
                setSelectedSourceIds(readySourceIds);
              }}
            >
              全选
            </button>
            <button
              className="button ghost"
              onClick={() => {
                setSelectionTouched(true);
                setSelectedSourceIds([]);
              }}
            >
              清空
            </button>
          </div>
          <div className="source-scope-list">
            {readySources.map((source) => (
              <label className="source-check" key={source.id}>
                <input
                  type="checkbox"
                  checked={selectedSourceIds.includes(source.id)}
                  onChange={() => toggleSource(source.id)}
                />
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.chunk_count ?? 0} 个片段</small>
                </span>
              </label>
            ))}
            {readySources.length === 0 && (
              <p className="muted">当前没有已启用且可问答的资料。你仍可以提问，但系统会提示资料不足。</p>
            )}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Retrieval</p>
          <h3>增强检索</h3>
          <label className="inline-check">
            <input type="checkbox" checked={useMqe} onChange={(event) => setUseMqe(event.target.checked)} />
            MQE 多查询扩展
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={useHyde} onChange={(event) => setUseHyde(event.target.checked)} />
            HyDE 假设文档检索
          </label>
          <p className="muted small-text">HyDE 只改善召回，不会作为真实来源引用展示。</p>
        </section>
      </aside>
    </div>
  );
}

function SearchSummary({ trace }: { trace?: Partial<RetrievalTrace> }) {
  if (!trace || typeof trace.context_count !== "number") return null;
  return (
    <div className="search-summary">
      <span>{trace.enhanced_search_used ? "已进行增强检索" : "基础检索"}</span>
      <span>{trace.context_count} 个引用候选</span>
      {trace.mqe_used && <span>MQE</span>}
      {trace.hyde_used && <span>HyDE</span>}
      {trace.insufficient_reason && <span>{trace.insufficient_reason}</span>}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="citation-list">
      {citations.slice(0, 6).map((citation, index) => (
        <article className="citation-card" key={`${citation.chunk_id}-${index}`}>
          <div className="chunk-meta">
            <strong>[{index + 1}] {citation.source_title}</strong>
            <span>{citation.heading_path.join(" / ") || "未命名片段"}</span>
            <span>{citation.locator}</span>
          </div>
          <p>{citation.quote_snapshot}</p>
        </article>
      ))}
    </div>
  );
}

function upsertMany(current: ChatMessage[], incoming: ChatMessage[]) {
  const next = [...current];
  for (const message of incoming) {
    const index = next.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      next[index] = { ...next[index], ...message };
    } else {
      next.push(message);
    }
  }
  return next;
}
