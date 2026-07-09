from __future__ import annotations

import json
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from learnfast.api.routes.spaces import require_space
from learnfast.core.errors import bad_request, not_found
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now
from learnfast.services.rag_chat import (
    CitationCandidate,
    citation_response,
    retrieve_for_question,
    stream_answer,
    trace_response,
)
from learnfast.services.system_logs import log_event

router = APIRouter(tags=["chat"])


class ChatStreamIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    source_ids: list[str] | None = None
    use_mqe: bool = True
    use_hyde: bool = True


class SaveNoteIn(BaseModel):
    title: str | None = Field(default=None, max_length=160)


class FeedbackIn(BaseModel):
    rating: str = Field(pattern="^(up|down)$")
    issue_type: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=1000)


@router.get("/spaces/{space_id}/chat/messages")
def list_chat_messages(space_id: str, limit: int = 40) -> list[dict]:
    require_space(space_id)
    limit = max(1, min(limit, 100))
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM chat_messages
                WHERE space_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (space_id, limit),
            ).fetchall()
        ]
    rows.reverse()
    return _messages_with_citations(rows)


@router.post("/spaces/{space_id}/chat/stream")
def stream_chat(space_id: str, payload: ChatStreamIn) -> StreamingResponse:
    require_space(space_id)
    question = payload.question.strip()
    if not question:
        raise bad_request("Question cannot be empty.")
    source_ids = _validate_source_scope(space_id, payload.source_ids)

    return StreamingResponse(
        _chat_events(
            space_id=space_id,
            question=question,
            source_ids=source_ids,
            use_mqe=payload.use_mqe,
            use_hyde=payload.use_hyde,
        ),
        media_type="application/x-ndjson",
    )


@router.post("/spaces/{space_id}/chat/{message_id}/save-note")
def save_chat_answer_as_note(space_id: str, message_id: str, payload: SaveNoteIn) -> dict:
    require_space(space_id)
    message = _get_message(space_id, message_id)
    if message["role"] != "assistant":
        raise bad_request("Only assistant answers can be saved as notes.")

    parent = None
    if message.get("parent_message_id"):
        parent = _get_message(space_id, message["parent_message_id"])
    citations = _list_citations(message_id)
    title = (payload.title or _note_title(parent, message)).strip()
    markdown = _note_markdown(title, parent, message, citations)
    now = utc_now()
    note_id = str(uuid4())
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO notes (
                id, space_id, title, markdown, tags_json, status,
                source_type, source_message_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, '[]', 'saved', 'chat_answer', ?, ?, ?)
            """,
            (note_id, space_id, title, markdown, message_id, now, now),
        )
    log_event(
        "note",
        "AI 回答已保存为笔记",
        space_id=space_id,
        details={
            "message_id": message_id,
            "note_id": note_id,
            "title": title,
            "citation_count": len(citations),
        },
    )
    return _get_note(space_id, note_id)


@router.post("/spaces/{space_id}/chat/{message_id}/feedback")
def submit_chat_feedback(space_id: str, message_id: str, payload: FeedbackIn) -> dict:
    require_space(space_id)
    message = _get_message(space_id, message_id)
    if message["role"] != "assistant":
        raise bad_request("Feedback can only be attached to assistant answers.")
    feedback_id = str(uuid4())
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO chat_feedback (
                id, space_id, message_id, rating, issue_type, note, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                feedback_id,
                space_id,
                message_id,
                payload.rating,
                payload.issue_type,
                payload.note,
                now,
            ),
        )
    log_event(
        "feedback",
        "回答反馈已记录",
        space_id=space_id,
        details={
            "message_id": message_id,
            "feedback_id": feedback_id,
            "rating": payload.rating,
            "issue_type": payload.issue_type,
        },
    )
    return {"id": feedback_id, "message_id": message_id, "rating": payload.rating}


@router.get("/spaces/{space_id}/notes")
def list_notes(space_id: str) -> list[dict]:
    require_space(space_id)
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM notes
                WHERE space_id = ?
                ORDER BY updated_at DESC
                """,
                (space_id,),
            ).fetchall()
        ]
    return [_note_response(row) for row in rows]


def _chat_events(
    space_id: str,
    question: str,
    source_ids: list[str] | None,
    use_mqe: bool,
    use_hyde: bool,
):
    user_message_id = str(uuid4())
    assistant_message_id = str(uuid4())
    created_at = utc_now()
    log_event(
        "chat",
        "收到学习问答请求",
        space_id=space_id,
        details={
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "question_preview": _preview(question),
            "source_scope": "all_ready_sources" if source_ids is None else source_ids,
            "mqe_enabled": use_mqe,
            "hyde_enabled": use_hyde,
        },
    )
    user_message = {
        "id": user_message_id,
        "space_id": space_id,
        "role": "user",
        "content": question,
        "parent_message_id": None,
        "context_snapshot": {},
        "created_at": created_at,
        "citations": [],
    }
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO chat_messages (
                id, space_id, role, content, parent_message_id,
                context_snapshot_json, created_at
            )
            VALUES (?, ?, 'user', ?, NULL, '{}', ?)
            """,
            (user_message_id, space_id, question, created_at),
        )

    yield _event(
        {
            "type": "start",
            "user_message": user_message,
            "assistant_message": {
                "id": assistant_message_id,
                "space_id": space_id,
                "role": "assistant",
                "content": "",
                "parent_message_id": user_message_id,
                "context_snapshot": {},
                "created_at": created_at,
                "citations": [],
            },
        }
    )

    try:
        citations, trace = retrieve_for_question(
            space_id=space_id,
            question=question,
            source_ids=source_ids,
            use_mqe=use_mqe,
            use_hyde=use_hyde,
        )
        citation_payload = [citation_response(citation) for citation in citations]
        trace_payload = trace_response(trace)
        log_event(
            "rag",
            "检索完成，已构建回答上下文",
            space_id=space_id,
            details={
                "assistant_message_id": assistant_message_id,
                "query_count": len(trace.queries),
                "mqe_used": trace.mqe_used,
                "hyde_used": trace.hyde_used,
                "source_scope": trace.source_ids or "all_ready_sources",
                "citation_count": len(citations),
                "insufficient_reason": trace.insufficient_reason,
            },
        )
        yield _event(
            {
                "type": "retrieval",
                "message_id": assistant_message_id,
                "search": trace_payload,
                "citations": citation_payload,
            }
        )

        answer_parts: list[str] = []
        for chunk in stream_answer(question, citations, trace):
            answer_parts.append(chunk)
            yield _event(
                {
                    "type": "token",
                    "message_id": assistant_message_id,
                    "content": chunk,
                }
            )
        answer = "".join(answer_parts).strip()
        if not answer:
            answer = "资料不足：模型没有返回可用内容，请稍后重试或调整来源范围。"

        assistant_created_at = utc_now()
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, space_id, role, content, parent_message_id,
                    context_snapshot_json, created_at
                )
                VALUES (?, ?, 'assistant', ?, ?, ?, ?)
                """,
                (
                    assistant_message_id,
                    space_id,
                    answer,
                    user_message_id,
                    json.dumps(trace_payload, ensure_ascii=False),
                    assistant_created_at,
                ),
            )
            _insert_citations(conn, space_id, assistant_message_id, citations, assistant_created_at)

        log_event(
            "chat",
            "学习问答回答完成",
            space_id=space_id,
            details={
                "assistant_message_id": assistant_message_id,
                "answer_chars": len(answer),
                "citation_count": len(citations),
                "enhanced_search_used": trace.enhanced_search_used,
            },
        )
        yield _event(
            {
                "type": "done",
                "message": {
                    "id": assistant_message_id,
                    "space_id": space_id,
                    "role": "assistant",
                    "content": answer,
                    "parent_message_id": user_message_id,
                    "context_snapshot": trace_payload,
                    "created_at": assistant_created_at,
                    "citations": citation_payload,
                },
                "search": trace_payload,
                "citations": citation_payload,
            }
        )
    except Exception as exc:
        log_event(
            "chat",
            "学习问答失败",
            level="error",
            space_id=space_id,
            details={
                "assistant_message_id": assistant_message_id,
                "question_preview": _preview(question),
                "error": str(exc),
            },
        )
        yield _event({"type": "error", "message": str(exc)})


def _event(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def _preview(value: str, limit: int = 160) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _validate_source_scope(space_id: str, source_ids: list[str] | None) -> list[str] | None:
    if source_ids is None:
        return None
    deduped = []
    for source_id in source_ids:
        if source_id not in deduped:
            deduped.append(source_id)
    if not deduped:
        return []
    placeholders = ", ".join("?" for _ in deduped)
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT id
            FROM sources
            WHERE space_id = ? AND id IN ({placeholders})
            """,
            (space_id, *deduped),
        ).fetchall()
    found = {row["id"] for row in rows}
    missing = [source_id for source_id in deduped if source_id not in found]
    if missing:
        raise bad_request("Selected source does not belong to this learning space.")
    return deduped


def _insert_citations(
    conn,
    space_id: str,
    message_id: str,
    citations: list[CitationCandidate],
    created_at: str,
) -> None:
    for citation in citations:
        conn.execute(
            """
            INSERT INTO citations (
                id, space_id, message_id, chunk_id, source_id, source_title,
                version_id, ordinal, heading_path_json, locator,
                quote_snapshot, score, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                space_id,
                message_id,
                citation.chunk_id,
                citation.source_id,
                citation.source_title,
                citation.version_id,
                citation.ordinal,
                json.dumps(citation.heading_path, ensure_ascii=False),
                citation.locator,
                citation.quote_snapshot,
                citation.score,
                created_at,
            ),
        )


def _get_message(space_id: str, message_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM chat_messages WHERE id = ? AND space_id = ?",
            (message_id, space_id),
        ).fetchone()
    message = row_to_dict(row)
    if not message:
        raise not_found("Chat message not found.")
    return message


def _list_citations(message_id: str) -> list[dict]:
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM citations
                WHERE message_id = ?
                ORDER BY score DESC
                """,
                (message_id,),
            ).fetchall()
        ]
    return [_citation_row_response(row) for row in rows]


def _messages_with_citations(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    message_ids = [row["id"] for row in rows]
    placeholders = ", ".join("?" for _ in message_ids)
    with get_db() as conn:
        citation_rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT *
                FROM citations
                WHERE message_id IN ({placeholders})
                ORDER BY score DESC
                """,
                tuple(message_ids),
            ).fetchall()
        ]
    citations_by_message: dict[str, list[dict]] = {}
    for row in citation_rows:
        citations_by_message.setdefault(row["message_id"], []).append(
            _citation_row_response(row)
        )
    return [
        _message_response(row, citations_by_message.get(row["id"], []))
        for row in rows
    ]


def _message_response(row: dict, citations: list[dict]) -> dict:
    return {
        "id": row["id"],
        "space_id": row["space_id"],
        "role": row["role"],
        "content": row["content"],
        "parent_message_id": row.get("parent_message_id"),
        "context_snapshot": json.loads(row.get("context_snapshot_json") or "{}"),
        "created_at": row["created_at"],
        "citations": citations,
    }


def _citation_row_response(row: dict) -> dict:
    return {
        "chunk_id": row["chunk_id"],
        "source_id": row["source_id"],
        "source_title": row["source_title"],
        "version_id": row["version_id"],
        "ordinal": row["ordinal"],
        "heading_path": json.loads(row["heading_path_json"]),
        "locator": row["locator"],
        "quote_snapshot": row["quote_snapshot"],
        "score": round(row["score"], 6),
    }


def _note_title(parent: dict | None, message: dict) -> str:
    seed = parent["content"] if parent else message["content"]
    compact = " ".join(seed.split())
    if len(compact) > 44:
        compact = f"{compact[:44].rstrip()}..."
    return f"问答笔记：{compact}"


def _note_markdown(
    title: str,
    parent: dict | None,
    message: dict,
    citations: list[dict],
) -> str:
    question = parent["content"] if parent else "未记录原问题"
    lines = [
        f"# {title}",
        "",
        "## 原问题",
        "",
        question,
        "",
        "## 回答",
        "",
        message["content"],
        "",
        "## 引用",
        "",
    ]
    if citations:
        for index, citation in enumerate(citations, start=1):
            heading = " / ".join(citation["heading_path"]) or "未命名片段"
            lines.extend(
                [
                    f"{index}. {citation['source_title']} · {heading} · {citation['locator']}",
                    "",
                    f"> {citation['quote_snapshot']}",
                    "",
                ]
            )
    else:
        lines.append("本回答没有可保存的资料引用。")
    return "\n".join(lines).strip() + "\n"


def _get_note(space_id: str, note_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM notes WHERE id = ? AND space_id = ?",
            (note_id, space_id),
        ).fetchone()
    note = row_to_dict(row)
    if not note:
        raise not_found("Note not found.")
    return _note_response(note)


def _note_response(row: dict) -> dict:
    return {
        "id": row["id"],
        "space_id": row["space_id"],
        "title": row["title"],
        "markdown": row["markdown"],
        "tags": json.loads(row.get("tags_json") or "[]"),
        "status": row["status"],
        "source_type": row.get("source_type"),
        "source_message_id": row.get("source_message_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
