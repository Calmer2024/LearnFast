from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass

import httpx

from learnfast.core.limits import MAX_CONTEXT_CHUNKS
from learnfast.infrastructure.database import get_db, row_to_dict
from learnfast.infrastructure.secret_store import secret_store
from learnfast.services.indexer import ChunkSearchResult, search_chunks
from learnfast.services.model_providers import PROVIDERS


class ChatModelError(Exception):
    pass


@dataclass(frozen=True)
class ChatModelConfig:
    provider_id: str
    base_url: str
    model: str
    api_key: str


@dataclass(frozen=True)
class CitationCandidate:
    chunk_id: str
    source_id: str
    source_title: str
    version_id: str
    ordinal: int
    heading_path: list[str]
    locator: str
    quote_snapshot: str
    score: float


@dataclass(frozen=True)
class RetrievalTrace:
    original_query: str
    queries: list[str]
    hyde_document: str | None
    mqe_used: bool
    hyde_used: bool
    enhanced_search_used: bool
    source_ids: list[str] | None
    context_count: int
    insufficient_reason: str | None = None


def retrieve_for_question(
    space_id: str,
    question: str,
    source_ids: list[str] | None,
    use_mqe: bool,
    use_hyde: bool,
) -> tuple[list[CitationCandidate], RetrievalTrace]:
    queries = _expanded_queries(question) if use_mqe else [question.strip()]
    hyde_document = _hyde_document(question) if use_hyde else None
    search_inputs = [*queries]
    if hyde_document:
        search_inputs.append(hyde_document)

    by_chunk: dict[str, ChunkSearchResult] = {}
    for query in search_inputs:
        for result in search_chunks(
            space_id,
            query,
            limit=MAX_CONTEXT_CHUNKS,
            source_ids=source_ids,
        ):
            current = by_chunk.get(result.id)
            if current is None or result.score > current.score:
                by_chunk[result.id] = result

    ranked = sorted(by_chunk.values(), key=lambda item: item.score, reverse=True)
    citations = [_citation_candidate(result) for result in ranked[:MAX_CONTEXT_CHUNKS]]
    insufficient_reason = None
    if not citations:
        insufficient_reason = (
            "当前资料范围没有检索到可引用片段。请上传资料、等待索引完成，或放宽来源范围。"
        )

    trace = RetrievalTrace(
        original_query=question,
        queries=queries,
        hyde_document=hyde_document,
        mqe_used=use_mqe and len(queries) > 1,
        hyde_used=hyde_document is not None,
        enhanced_search_used=(use_mqe and len(queries) > 1) or hyde_document is not None,
        source_ids=source_ids,
        context_count=len(citations),
        insufficient_reason=insufficient_reason,
    )
    return citations, trace


def stream_answer(
    question: str,
    citations: list[CitationCandidate],
    trace: RetrievalTrace,
) -> Iterator[str]:
    config = _load_chat_model_config()
    if not citations:
        yield _insufficient_answer(trace)
        return
    if not config:
        yield from _stream_local_answer(question, citations)
        return
    try:
        yield from _stream_remote_answer(config, question, citations)
    except ChatModelError as exc:
        fallback = (
            f"聊天模型调用失败：{exc}。\n\n"
            "下面先给出基于检索片段的本地摘录式回答，方便你不中断学习：\n\n"
        )
        yield fallback
        yield from _stream_local_answer(question, citations, include_model_notice=False)


def citation_response(citation: CitationCandidate) -> dict:
    return {
        "chunk_id": citation.chunk_id,
        "source_id": citation.source_id,
        "source_title": citation.source_title,
        "version_id": citation.version_id,
        "ordinal": citation.ordinal,
        "heading_path": citation.heading_path,
        "locator": citation.locator,
        "quote_snapshot": citation.quote_snapshot,
        "score": round(citation.score, 6),
    }


def trace_response(trace: RetrievalTrace) -> dict:
    return {
        "original_query": trace.original_query,
        "queries": trace.queries,
        "hyde_document": trace.hyde_document,
        "mqe_used": trace.mqe_used,
        "hyde_used": trace.hyde_used,
        "enhanced_search_used": trace.enhanced_search_used,
        "source_ids": trace.source_ids,
        "context_count": trace.context_count,
        "insufficient_reason": trace.insufficient_reason,
    }


def _expanded_queries(question: str) -> list[str]:
    normalized = " ".join(question.split())
    if not normalized:
        return []
    keywords = _keywords(normalized)
    candidates = [
        normalized,
        f"根据学习资料解释：{normalized}",
        f"{normalized} 的定义、步骤、差异、例子、注意事项",
    ]
    if keywords:
        candidates.append(" ".join(keywords))
    deduped: list[str] = []
    for item in candidates:
        value = item.strip()
        if value and value not in deduped:
            deduped.append(value)
    return deduped


def _hyde_document(question: str) -> str:
    normalized = " ".join(question.split())
    return (
        "这是一段仅用于语义检索的假设学习资料，不是真实引用来源。"
        f"问题：{normalized}。"
        "相关资料可能会说明核心概念、前置条件、操作步骤、对比关系、常见误区和例子。"
    )


def _keywords(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9_]{3,}|[\u4e00-\u9fff]{1}", text.lower())
    stopwords = {
        "the",
        "and",
        "for",
        "with",
        "from",
        "what",
        "how",
        "why",
        "are",
        "is",
        "什么",
        "如何",
        "为什么",
        "这个",
        "哪些",
    }
    result: list[str] = []
    for token in tokens:
        if token in stopwords or token in result:
            continue
        result.append(token)
        if len(result) >= 12:
            break
    return result


def _citation_candidate(result: ChunkSearchResult) -> CitationCandidate:
    return CitationCandidate(
        chunk_id=result.id,
        source_id=result.source_id,
        source_title=result.source_title,
        version_id=result.version_id,
        ordinal=result.ordinal,
        heading_path=result.heading_path,
        locator=result.locator,
        quote_snapshot=_quote(result.text),
        score=result.score,
    )


def _quote(text: str, limit: int = 420) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _load_chat_model_config() -> ChatModelConfig | None:
    provider = PROVIDERS["deepseek_chat"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM model_configs WHERE provider_id = ? AND enabled = 1",
            (provider.id,),
        ).fetchone()
    config = row_to_dict(row)
    if not config or not config.get("secret_ref"):
        return None
    api_key = secret_store.get_api_key(config.get("secret_ref"))
    base_url = (config.get("base_url") or provider.base_url or "").rstrip("/")
    model = config.get("default_chat_model") or provider.chat_models[0]
    if not api_key or not base_url or not model:
        return None
    return ChatModelConfig(provider.id, base_url, model, api_key)


def _stream_remote_answer(
    config: ChatModelConfig,
    question: str,
    citations: list[CitationCandidate],
) -> Iterator[str]:
    messages = [
        {
            "role": "system",
            "content": (
                "你是 LearnFast 的学习问答助手。只根据提供的学习资料片段回答。"
                "结论后用 [1]、[2] 这样的编号标注来源；如果资料没有直接支持，明确说资料不足。"
                "不要把假设检索内容当作来源。"
            ),
        },
        {
            "role": "user",
            "content": _remote_prompt(question, citations),
        },
    ]
    try:
        with httpx.stream(
            "POST",
            f"{config.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": config.model,
                "messages": messages,
                "temperature": 0.2,
                "stream": True,
            },
            timeout=60,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line:
                    continue
                if isinstance(line, bytes):
                    line = line.decode("utf-8", errors="replace")
                if not line.startswith("data:"):
                    continue
                data = line.removeprefix("data:").strip()
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = payload.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content")
                if content:
                    yield content
    except Exception as exc:
        raise ChatModelError(str(exc)) from exc


def _remote_prompt(question: str, citations: list[CitationCandidate]) -> str:
    context_lines = []
    for index, citation in enumerate(citations, start=1):
        heading = " / ".join(citation.heading_path) or "未命名片段"
        context_lines.append(
            f"[{index}] {citation.source_title} · {heading} · {citation.locator}\n"
            f"{citation.quote_snapshot}"
        )
    return (
        f"问题：{question}\n\n"
        "可用学习资料片段：\n"
        + "\n\n".join(context_lines)
        + "\n\n请给出面向学习者的清晰回答，并在使用资料结论时标注引用编号。"
    )


def _stream_local_answer(
    question: str,
    citations: list[CitationCandidate],
    include_model_notice: bool = True,
) -> Iterator[str]:
    paragraphs: list[str] = []
    if include_model_notice:
        paragraphs.append(
            "未配置可用聊天模型，下面是基于检索片段生成的本地摘录式回答。"
        )
    paragraphs.append(f"针对“{question}”，当前资料中最相关的信息如下：")
    for index, citation in enumerate(citations[:5], start=1):
        heading = " / ".join(citation.heading_path) or "未命名片段"
        paragraphs.append(
            f"- {citation.source_title} 的“{heading}”提到：{citation.quote_snapshot} [{index}]"
        )
    paragraphs.append(
        "如果你需要更综合的解释、例题或对比分析，请先在模型设置中配置聊天模型。"
    )
    answer = "\n\n".join(paragraphs)
    for chunk in _chunks(answer):
        yield chunk


def _insufficient_answer(trace: RetrievalTrace) -> str:
    reason = trace.insufficient_reason or "当前资料不足以回答这个问题。"
    return (
        f"资料不足：{reason}\n\n"
        "我不会在没有引用的情况下编造答案。你可以先上传相关资料，确认资料状态为“ready”，"
        "或者扩大这次问答的来源范围后重试。"
    )


def _chunks(text: str, size: int = 120) -> Iterator[str]:
    for start in range(0, len(text), size):
        yield text[start : start + size]
