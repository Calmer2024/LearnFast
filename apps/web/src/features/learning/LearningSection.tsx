import {
  BookmarkSimple,
  CaretDown,
  CheckSquare,
  Check,
  CopySimple,
  SidebarSimple,
  PaperPlaneTilt,
  ThumbsDown,
  ThumbsUp,
  XSquare,
} from "@phosphor-icons/react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { TransientNotice } from "../../components/TransientNotice";
import { api } from "../../lib/api";
import type { ChatMessage, ChatStreamEvent, Citation, RetrievalTrace, Source } from "../../lib/types";

type ReviewTarget = {
  planId: string;
  taskId: string;
  prompt: string;
};

type LearningContextView = "overview" | "sources" | "retrieval";

export function LearningSection({ spaceId }: { spaceId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sources, setSources] = useState<Source[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [question, setQuestion] = useState("");
  const [contextView, setContextView] = useState<LearningContextView>("overview");
  const [contextCollapsed, setContextCollapsed] = useState(true);
  const [useMqe, setUseMqe] = useState(true);
  const [useHyde, setUseHyde] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [feedbackMessageIds, setFeedbackMessageIds] = useState<Set<string>>(new Set());
  const [copiedMessageIds, setCopiedMessageIds] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const loadedReviewKeyRef = useRef("");
  const reviewTargetRef = useRef<ReviewTarget | null>(null);
  const pendingReviewTargetRef = useRef<ReviewTarget | null>(null);

  const readySources = useMemo(
    () => sources.filter((source) => source.status === "ready" && source.enabled),
    [sources],
  );
  const readySourceIds = useMemo(() => readySources.map((source) => source.id), [readySources]);
  const selectedReadyIds = useMemo(
    () => selectedSourceIds.filter((id) => readySourceIds.includes(id)),
    [readySourceIds, selectedSourceIds],
  );
  const lastAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages],
  );

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
    const planId = searchParams.get("reviewPlanId");
    const taskId = searchParams.get("reviewTaskId");
    const prompt = searchParams.get("reviewPrompt");
    if (!planId || !taskId || !prompt) return;
    const key = `${planId}:${taskId}:${prompt}`;
    if (loadedReviewKeyRef.current === key) return;
    loadedReviewKeyRef.current = key;
    reviewTargetRef.current = { planId, taskId, prompt };
    setQuestion(prompt);
    setNotice("已载入计划复习任务。提交后，复习结果会自动回写到计划进度。");
    const next = new URLSearchParams(searchParams);
    next.delete("reviewPlanId");
    next.delete("reviewTaskId");
    next.delete("reviewPrompt");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (selectionTouched) return;
    setSelectedSourceIds(readySourceIds);
  }, [readySourceIds, selectionTouched]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [question]);

  const submitQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || streaming) return;
    setError(null);
    setNotice(null);
    setStreaming(true);
    setQuestion("");
    pendingReviewTargetRef.current = reviewTargetRef.current;
    reviewTargetRef.current = null;

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
            ? { ...message, context_snapshot: event.search }
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
      const reviewTarget = pendingReviewTargetRef.current;
      if (reviewTarget) {
        pendingReviewTargetRef.current = null;
        void api
          .recordPlanReviewResult(spaceId, reviewTarget.planId, reviewTarget.taskId, {
            message_id: event.message.id,
            result: `复习问答已完成：${event.search.original_query || reviewTarget.prompt}`,
            mark_completed: true,
          })
          .then(() => setNotice("复习结果已回写计划任务。"))
          .catch((exc) =>
            setError(exc instanceof Error ? exc.message : "复习结果回写失败"),
          );
      }
      return;
    }
    if (event.type === "error") {
      pendingReviewTargetRef.current = null;
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

  const copyAnswer = async (message: ChatMessage) => {
    if (!message.content.trim()) return;
    await navigator.clipboard.writeText(message.content);
    setCopiedMessageIds((current) => new Set(current).add(message.id));
    window.setTimeout(() => {
      setCopiedMessageIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }, 1400);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <div className={`learning-layout ${contextCollapsed ? "context-collapsed" : ""}`.trim()}>
      <section className="chat-pane">
        <div className="section-header">
          <div>
            <p className="eyebrow">Learning Chat</p>
            <h2>学习问答</h2>
          </div>
        </div>

        {error && <TransientNotice message={error} tone="danger" onDismiss={() => setError(null)} />}
        {notice && <TransientNotice message={notice} tone="success" onDismiss={() => setNotice(null)} />}

        <div className="message-list">
          {messages.length === 0 && (
            <div className="empty chat-empty">
              <h3>准备好一起学习啦</h3>
              <p>选好资料范围后，把问题交给小书；它会认真带上引用，不会偷偷编答案。</p>
            </div>
          )}
          {messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              {message.role === "assistant" && (
                <span className="agent-avatar" aria-hidden="true">
                  <img src="/learnfast-logo.png" alt="" />
                </span>
              )}
              {message.role === "user" && <div className="message-label">你</div>}
              {message.role === "assistant" ? (
                <MarkdownRenderer
                  markdown={message.content}
                  className="message-markdown"
                  emptyText="正在生成回答..."
                  highlightCitations
                />
              ) : (
                <div className="message-body">{message.content || "正在生成回答..."}</div>
              )}
              {message.role === "assistant" && (
                <>
                  <SearchSummary trace={message.context_snapshot} />
                  <CitationList citations={message.citations} />
                  <div className="message-actions">
                    <button
                      className="button ghost"
                      disabled={!message.content}
                      onClick={() => copyAnswer(message)}
                    >
                      {copiedMessageIds.has(message.id) ? <Check size={15} /> : <CopySimple size={15} />}
                      {copiedMessageIds.has(message.id) ? "已复制" : "复制回答"}
                    </button>
                    <button
                      className="button ghost"
                      disabled={!message.content || savedMessageIds.has(message.id)}
                      onClick={() => saveAsNote(message)}
                    >
                      <BookmarkSimple size={15} />
                      {savedMessageIds.has(message.id) ? "已保存" : "保存为笔记"}
                    </button>
                    <button
                      className="button ghost"
                      disabled={!message.content || feedbackMessageIds.has(message.id)}
                      onClick={() => submitFeedback(message, "up")}
                    >
                      <ThumbsUp size={15} />
                      有帮助
                    </button>
                    <button
                      className="button ghost"
                      disabled={!message.content || feedbackMessageIds.has(message.id)}
                      onClick={() => submitFeedback(message, "down")}
                    >
                      <ThumbsDown size={15} />
                      有问题
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
          <div ref={endRef} />
        </div>

        <div className="chat-input-layer">
          <form className="chat-composer" onSubmit={submitQuestion}>
            <div className="chat-input-bar">
              <textarea
                ref={composerRef}
                rows={1}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="例如：这些资料中 Pandas 数据清洗的核心步骤是什么？"
              />
            </div>
            <button
              aria-label={streaming ? "回答中" : "提问"}
              className="button chat-send-button"
              disabled={streaming || !question.trim()}
              title={streaming ? "回答中" : "提问"}
            >
              <PaperPlaneTilt size={17} />
            </button>
          </form>
        </div>
      </section>

      <aside className="context-panel">
        <section className="panel context-overview-panel">
          <div className="section-header compact">
            <div>
              <p className="eyebrow">Context</p>
              <h3>本次问答上下文</h3>
            </div>
            <button
              className="icon-button context-collapse-button"
              type="button"
              aria-label={contextCollapsed ? "展开上下文面板" : "折叠上下文面板"}
              title={contextCollapsed ? "展开上下文面板" : "折叠上下文面板"}
              onClick={() => setContextCollapsed((current) => !current)}
            >
              <SidebarSimple size={17} />
            </button>
          </div>
          <div className="context-panel-content">
          <div className="context-metrics">
            <div>
              <span>可用资料</span>
              <strong>{readySources.length}</strong>
            </div>
            <div>
              <span>已选范围</span>
              <strong>{selectedReadyIds.length}</strong>
            </div>
            <div>
              <span>检索模式</span>
              <strong>{useMqe || useHyde ? "增强" : "基础"}</strong>
            </div>
          </div>
          <div className="context-tabs" role="tablist" aria-label="学习问答上下文">
            <button
              className={contextView === "overview" ? "active" : ""}
              onClick={() => setContextView("overview")}
              type="button"
            >
              概览
            </button>
            <button
              className={contextView === "sources" ? "active" : ""}
              onClick={() => setContextView("sources")}
              type="button"
            >
              来源
            </button>
            <button
              className={contextView === "retrieval" ? "active" : ""}
              onClick={() => setContextView("retrieval")}
              type="button"
            >
              检索
            </button>
          </div>
          </div>
        </section>

        <div className="context-panel-content">
        {contextView === "overview" && (
          <section className="panel context-summary-panel">
            <p className="eyebrow">Current Focus</p>
            <h3>默认保持低干扰</h3>
            <p className="muted">当前会使用你选中的资料范围回答。需要精确控制来源或关闭增强检索时，再切换到对应面板。</p>
            {lastAssistantMessage?.context_snapshot && (
              <div className="context-recent">
                <span>最近一次检索</span>
                <strong>{lastAssistantMessage.context_snapshot.context_count ?? 0} 个引用候选</strong>
              </div>
            )}
          </section>
        )}

        {contextView === "sources" && (
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
                <CheckSquare size={15} />
                全选
              </button>
              <button
                className="button ghost"
                onClick={() => {
                  setSelectionTouched(true);
                  setSelectedSourceIds([]);
                }}
              >
                <XSquare size={15} />
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
        )}

        {contextView === "retrieval" && (
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
        )}
        </div>
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
  const [expanded, setExpanded] = useState(false);
  if (!citations.length) return null;
  return (
    <div className={`citation-panel ${expanded ? "expanded" : ""}`.trim()}>
      <button className="citation-panel-toggle" onClick={() => setExpanded((current) => !current)} type="button">
        <span>
          <strong>引用来源</strong>
          <small>{citations.length} 个候选片段</small>
        </span>
        <CaretDown size={15} />
      </button>
      {expanded && (
        <div className="citation-list">
          {citations.map((citation, index) => (
            <article className="citation-card" key={`${citation.chunk_id}-${index}`}>
              <div className="chunk-meta">
                <strong>
                  <span className="citation-ref">[{index + 1}]</span>
                  {citation.source_type === "note" ? "笔记" : "资料"}：{citation.source_title}
                </strong>
                <span>{citation.heading_path.join(" / ") || "未命名片段"}</span>
                <span>{citation.locator}</span>
              </div>
              <p>{citation.text || citation.quote_snapshot}</p>
            </article>
          ))}
        </div>
      )}
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
