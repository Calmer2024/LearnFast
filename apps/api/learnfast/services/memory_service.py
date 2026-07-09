from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from uuid import uuid4

from learnfast.core.errors import bad_request, not_found
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now
from learnfast.services.system_logs import log_event


MEMORY_LAYERS = [
    {
        "id": "space_profile",
        "label": "空间画像记忆",
        "description": "学习目标、考试日期、当前阶段、偏好语言。",
    },
    {
        "id": "source_semantic",
        "label": "资料语义记忆",
        "description": "资料主题、关键概念、章节结构、重要结论。",
    },
    {
        "id": "user_note",
        "label": "用户笔记记忆",
        "description": "用户手写笔记、摘录、感悟、总结。",
    },
    {
        "id": "dialogue_episodic",
        "label": "对话情节记忆",
        "description": "近期问答主题、未解决问题、用户反馈。",
    },
    {
        "id": "learning_ability",
        "label": "学习能力记忆",
        "description": "掌握程度、薄弱知识点、错题或困惑。",
    },
    {
        "id": "preference",
        "label": "偏好记忆",
        "description": "回答风格、解释深度、题型偏好。",
    },
    {
        "id": "plan_progress",
        "label": "计划进度记忆",
        "description": "当前任务、完成记录、延期原因。",
    },
]

VALID_LAYER_IDS = {layer["id"] for layer in MEMORY_LAYERS}
VALID_SOURCE_TYPES = {"chat", "note", "source", "plan", "manual"}
VALID_CANDIDATE_STATUSES = {"pending", "accepted", "ignored"}
VALID_IMPACTS = {"low", "medium", "high"}

WEAKNESS_PATTERNS = (
    "混淆",
    "困惑",
    "不懂",
    "不会",
    "总是错",
    "老是错",
    "易错",
    "记不住",
    "薄弱",
    "confuse",
    "confused",
    "struggle",
    "weak",
)
PREFERENCE_PATTERNS = (
    "我喜欢",
    "我希望",
    "希望你",
    "请用",
    "以后回答",
    "偏好",
    "prefer",
    "用中文",
    "用英文",
)
PROFILE_PATTERNS = ("目标", "考试", "截止", "deadline", "本周", "两周", "一个月")


@dataclass(frozen=True)
class CandidateSeed:
    layer: str
    content: str
    source_type: str
    source_id: str | None
    source_title: str
    source_excerpt: str
    confidence: float
    impact: str


def list_memory_layers() -> list[dict]:
    return MEMORY_LAYERS


def get_memory_settings(space_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM memory_settings WHERE space_id = ?",
            (space_id,),
        ).fetchone()
        if row is None:
            now = utc_now()
            conn.execute(
                """
                INSERT INTO memory_settings (
                    space_id, auto_extract_enabled, created_at, updated_at
                )
                VALUES (?, 1, ?, ?)
                """,
                (space_id, now, now),
            )
            row = conn.execute(
                "SELECT * FROM memory_settings WHERE space_id = ?",
                (space_id,),
            ).fetchone()
    return _settings_response(row_to_dict(row) or {})


def update_memory_settings(space_id: str, auto_extract_enabled: bool) -> dict:
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO memory_settings (
                space_id, auto_extract_enabled, created_at, updated_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(space_id) DO UPDATE SET
                auto_extract_enabled = excluded.auto_extract_enabled,
                updated_at = excluded.updated_at
            """,
            (space_id, 1 if auto_extract_enabled else 0, now, now),
        )
    log_event(
        "memory",
        "空间自动记忆提取设置已更新",
        space_id=space_id,
        details={"auto_extract_enabled": auto_extract_enabled},
    )
    return get_memory_settings(space_id)


def list_memory_candidates(
    space_id: str,
    *,
    status: str | None = "pending",
    layer: str | None = None,
) -> list[dict]:
    if status is not None and status not in VALID_CANDIDATE_STATUSES:
        raise bad_request("Invalid memory candidate status.")
    if layer is not None:
        _validate_layer(layer)
    clauses = ["space_id = ?"]
    params: list[object] = [space_id]
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if layer is not None:
        clauses.append("layer = ?")
        params.append(layer)
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT *
            FROM memory_candidates
            WHERE {' AND '.join(clauses)}
            ORDER BY
                CASE impact
                    WHEN 'high' THEN 0
                    WHEN 'medium' THEN 1
                    ELSE 2
                END,
                updated_at DESC
            """,
            tuple(params),
        ).fetchall()
    return [_candidate_response(dict(row)) for row in rows]


def get_memory_candidate(space_id: str, candidate_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM memory_candidates WHERE id = ? AND space_id = ?",
            (candidate_id, space_id),
        ).fetchone()
    candidate = row_to_dict(row)
    if not candidate:
        raise not_found("Memory candidate not found.")
    return _candidate_response(candidate)


def update_memory_candidate(
    space_id: str,
    candidate_id: str,
    *,
    content: str | None = None,
    layer: str | None = None,
    impact: str | None = None,
) -> dict:
    current = get_memory_candidate(space_id, candidate_id)
    next_content = _normalize_content(content) if content is not None else current["content"]
    next_layer = layer or current["layer"]
    next_impact = impact or current["impact"]
    _validate_layer(next_layer)
    _validate_impact(next_impact)
    now = utc_now()
    content_hash = _content_hash(next_layer, next_content)
    with get_db() as conn:
        conn.execute(
            """
            UPDATE memory_candidates
            SET layer = ?, content = ?, impact = ?, content_hash = ?, updated_at = ?
            WHERE id = ? AND space_id = ?
            """,
            (
                next_layer,
                next_content,
                next_impact,
                content_hash,
                now,
                candidate_id,
                space_id,
            ),
        )
    log_event(
        "memory",
        "记忆候选已改写",
        space_id=space_id,
        details={"candidate_id": candidate_id, "layer": next_layer, "impact": next_impact},
    )
    return get_memory_candidate(space_id, candidate_id)


def confirm_memory_candidate(
    space_id: str,
    candidate_id: str,
    *,
    content: str | None = None,
    layer: str | None = None,
) -> dict:
    candidate = get_memory_candidate(space_id, candidate_id)
    if candidate["status"] == "accepted" and candidate.get("accepted_memory_id"):
        memory = get_memory(space_id, candidate["accepted_memory_id"], include_deleted=True)
        if memory["status"] == "active":
            return memory
    if candidate["status"] == "ignored":
        raise bad_request("Ignored memory candidates cannot be confirmed.")

    next_content = _normalize_content(content) if content is not None else candidate["content"]
    next_layer = layer or candidate["layer"]
    memory = create_memory(
        space_id=space_id,
        layer=next_layer,
        content=next_content,
        source_type=candidate["source_type"],
        source_id=candidate.get("source_id"),
        source_title=candidate.get("source_title") or "",
        source_excerpt=candidate.get("source_excerpt") or "",
        priority=_priority_for_impact(candidate["impact"]),
        candidate_id=candidate_id,
    )
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE memory_candidates
            SET status = 'accepted',
                accepted_memory_id = ?,
                updated_at = ?
            WHERE id = ? AND space_id = ?
            """,
            (memory["id"], now, candidate_id, space_id),
        )
    log_event(
        "memory",
        "记忆候选已确认进入长期记忆",
        space_id=space_id,
        details={
            "candidate_id": candidate_id,
            "memory_id": memory["id"],
            "layer": memory["layer"],
            "source_type": memory["source_type"],
        },
    )
    return memory


def ignore_memory_candidate(space_id: str, candidate_id: str) -> dict:
    get_memory_candidate(space_id, candidate_id)
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE memory_candidates
            SET status = 'ignored', updated_at = ?
            WHERE id = ? AND space_id = ?
            """,
            (now, candidate_id, space_id),
        )
    log_event(
        "memory",
        "记忆候选已忽略",
        space_id=space_id,
        details={"candidate_id": candidate_id},
    )
    return get_memory_candidate(space_id, candidate_id)


def list_memories(
    space_id: str,
    *,
    layer: str | None = None,
    include_deleted: bool = False,
) -> list[dict]:
    if layer is not None:
        _validate_layer(layer)
    clauses = ["space_id = ?"]
    params: list[object] = [space_id]
    if not include_deleted:
        clauses.append("status = 'active'")
    if layer is not None:
        clauses.append("layer = ?")
        params.append(layer)
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT *
            FROM memories
            WHERE {' AND '.join(clauses)}
            ORDER BY priority DESC, updated_at DESC
            """,
            tuple(params),
        ).fetchall()
    return [_memory_response(dict(row)) for row in rows]


def get_memory(space_id: str, memory_id: str, *, include_deleted: bool = False) -> dict:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM memories
            WHERE id = ? AND space_id = ?
            """,
            (memory_id, space_id),
        ).fetchone()
    memory = row_to_dict(row)
    if not memory or (memory["status"] == "deleted" and not include_deleted):
        raise not_found("Memory not found.")
    return _memory_response(memory)


def create_memory(
    *,
    space_id: str,
    layer: str,
    content: str,
    source_type: str = "manual",
    source_id: str | None = None,
    source_title: str = "",
    source_excerpt: str = "",
    priority: int = 0,
    candidate_id: str | None = None,
) -> dict:
    _validate_layer(layer)
    _validate_source_type(source_type)
    normalized_content = _normalize_content(content)
    memory_id = str(uuid4())
    now = utc_now()
    content_hash = _content_hash(layer, normalized_content)
    with get_db() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO memories (
                id, space_id, layer, content, source_type, source_id,
                source_title, source_excerpt, priority, status, candidate_id,
                content_hash, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
            """,
            (
                memory_id,
                space_id,
                layer,
                normalized_content,
                source_type,
                source_id,
                source_title.strip()[:200],
                _compact(source_excerpt, 500),
                max(-5, min(priority, 5)),
                candidate_id,
                content_hash,
                now,
                now,
            ),
        )
        row = conn.execute(
            """
            SELECT *
            FROM memories
            WHERE space_id = ?
              AND source_type = ?
              AND IFNULL(source_id, '') = IFNULL(?, '')
              AND content_hash = ?
            """,
            (space_id, source_type, source_id, content_hash),
        ).fetchone()
        if row and row["status"] == "deleted":
            conn.execute(
                """
                UPDATE memories
                SET status = 'active',
                    content = ?,
                    layer = ?,
                    priority = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (normalized_content, layer, max(-5, min(priority, 5)), now, row["id"]),
            )
            row = conn.execute("SELECT * FROM memories WHERE id = ?", (row["id"],)).fetchone()
    memory = _memory_response(dict(row))
    log_event(
        "memory",
        "长期记忆已创建",
        space_id=space_id,
        details={
            "memory_id": memory["id"],
            "layer": memory["layer"],
            "source_type": memory["source_type"],
        },
    )
    return memory


def update_memory(
    space_id: str,
    memory_id: str,
    *,
    content: str | None = None,
    layer: str | None = None,
    priority: int | None = None,
) -> dict:
    current = get_memory(space_id, memory_id)
    next_content = _normalize_content(content) if content is not None else current["content"]
    next_layer = layer or current["layer"]
    _validate_layer(next_layer)
    next_priority = current["priority"] if priority is None else max(-5, min(priority, 5))
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE memories
            SET layer = ?, content = ?, priority = ?, content_hash = ?, updated_at = ?
            WHERE id = ? AND space_id = ? AND status = 'active'
            """,
            (
                next_layer,
                next_content,
                next_priority,
                _content_hash(next_layer, next_content),
                now,
                memory_id,
                space_id,
            ),
        )
    log_event(
        "memory",
        "长期记忆已更新",
        space_id=space_id,
        details={"memory_id": memory_id, "layer": next_layer, "priority": next_priority},
    )
    return get_memory(space_id, memory_id)


def delete_memory(space_id: str, memory_id: str) -> dict:
    current = get_memory(space_id, memory_id)
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE memories
            SET status = 'deleted', updated_at = ?
            WHERE id = ? AND space_id = ?
            """,
            (now, memory_id, space_id),
        )
    log_event(
        "memory",
        "长期记忆已删除，不再进入新问答上下文",
        level="warn",
        space_id=space_id,
        details={"memory_id": memory_id, "layer": current["layer"]},
    )
    return {"deleted": True, "id": memory_id}


def delete_memories_for_source(space_id: str, source_type: str, source_id: str) -> dict:
    _validate_source_type(source_type)
    now = utc_now()
    with get_db() as conn:
        memory_count = conn.execute(
            """
            UPDATE memories
            SET status = 'deleted', updated_at = ?
            WHERE space_id = ? AND source_type = ? AND source_id = ? AND status = 'active'
            """,
            (now, space_id, source_type, source_id),
        ).rowcount
        candidate_count = conn.execute(
            """
            UPDATE memory_candidates
            SET status = 'ignored', updated_at = ?
            WHERE space_id = ? AND source_type = ? AND source_id = ? AND status = 'pending'
            """,
            (now, space_id, source_type, source_id),
        ).rowcount
    log_event(
        "memory",
        "来源关联记忆已选择性遗忘",
        level="warn",
        space_id=space_id,
        details={
            "source_type": source_type,
            "source_id": source_id,
            "deleted_memories": memory_count,
            "ignored_candidates": candidate_count,
        },
    )
    return {"deleted_memories": memory_count, "ignored_candidates": candidate_count}


def active_memory_context(space_id: str, limit: int = 6) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, layer, content, source_type, source_id, source_title, priority, updated_at
            FROM memories
            WHERE space_id = ? AND status = 'active'
            ORDER BY priority DESC, updated_at DESC
            LIMIT ?
            """,
            (space_id, max(1, min(limit, 12))),
        ).fetchall()
    return [_memory_context_response(dict(row)) for row in rows]


def extract_memory_candidates_from_note(space_id: str, note: dict) -> list[dict]:
    if not _auto_extract_enabled(space_id):
        return []
    title = (note.get("title") or "未命名笔记").strip()
    markdown = note.get("markdown") or ""
    text = _plain_text(markdown)
    if not text:
        return []
    seeds = [
        CandidateSeed(
            layer="user_note",
            content=f"用户笔记《{title}》记录：{_compact(_first_sentence(text), 180)}",
            source_type="note",
            source_id=note["id"],
            source_title=title,
            source_excerpt=_compact(text, 360),
            confidence=0.78,
            impact="medium",
        )
    ]
    weakness = _find_sentence(text, WEAKNESS_PATTERNS)
    if weakness:
        seeds.append(
            CandidateSeed(
                layer="learning_ability",
                content=f"用户可能需要复习或澄清：{_compact(weakness, 180)}",
                source_type="note",
                source_id=note["id"],
                source_title=title,
                source_excerpt=_compact(weakness, 360),
                confidence=0.84,
                impact="high",
            )
        )
    preference = _find_sentence(text, PREFERENCE_PATTERNS)
    if preference:
        seeds.append(
            CandidateSeed(
                layer="preference",
                content=f"用户表达了学习交互偏好：{_compact(preference, 180)}",
                source_type="note",
                source_id=note["id"],
                source_title=title,
                source_excerpt=_compact(preference, 360),
                confidence=0.8,
                impact="high",
            )
        )
    created = _insert_candidate_seeds(space_id, seeds)
    if created:
        log_event(
            "memory",
            "已从笔记生成记忆候选",
            space_id=space_id,
            details={"note_id": note["id"], "candidate_count": len(created)},
        )
    return created


def extract_memory_candidates_from_chat(
    space_id: str,
    *,
    user_message: dict,
    assistant_message: dict,
) -> list[dict]:
    if not _auto_extract_enabled(space_id):
        return []
    question = _compact(user_message.get("content") or "", 240)
    answer = _compact(assistant_message.get("content") or "", 240)
    source_excerpt = _compact(f"Q: {question}\nA: {answer}", 500)
    seeds = [
        CandidateSeed(
            layer="dialogue_episodic",
            content=f"用户围绕“{question}”进行了学习问答。",
            source_type="chat",
            source_id=assistant_message["id"],
            source_title="学习问答",
            source_excerpt=source_excerpt,
            confidence=0.72,
            impact="medium",
        )
    ]
    weakness = _find_sentence(question, WEAKNESS_PATTERNS)
    if weakness:
        seeds.append(
            CandidateSeed(
                layer="learning_ability",
                content=f"用户可能存在待澄清的薄弱点：{_compact(weakness, 180)}",
                source_type="chat",
                source_id=assistant_message["id"],
                source_title="学习问答",
                source_excerpt=source_excerpt,
                confidence=0.82,
                impact="high",
            )
        )
    preference = _find_sentence(question, PREFERENCE_PATTERNS)
    if preference:
        seeds.append(
            CandidateSeed(
                layer="preference",
                content=f"用户表达了回答偏好：{_compact(preference, 180)}",
                source_type="chat",
                source_id=assistant_message["id"],
                source_title="学习问答",
                source_excerpt=source_excerpt,
                confidence=0.8,
                impact="high",
            )
        )
    profile = _find_sentence(question, PROFILE_PATTERNS)
    if profile:
        seeds.append(
            CandidateSeed(
                layer="space_profile",
                content=f"当前学习空间可能需要关注：{_compact(profile, 180)}",
                source_type="chat",
                source_id=assistant_message["id"],
                source_title="学习问答",
                source_excerpt=source_excerpt,
                confidence=0.68,
                impact="high",
            )
        )
    created = _insert_candidate_seeds(space_id, seeds)
    if created:
        log_event(
            "memory",
            "已从对话生成记忆候选",
            space_id=space_id,
            details={"message_id": assistant_message["id"], "candidate_count": len(created)},
        )
    return created


def _insert_candidate_seeds(space_id: str, seeds: list[CandidateSeed]) -> list[dict]:
    created: list[dict] = []
    now = utc_now()
    with get_db() as conn:
        for seed in seeds:
            _validate_layer(seed.layer)
            _validate_source_type(seed.source_type)
            _validate_impact(seed.impact)
            content = _normalize_content(seed.content)
            content_hash = _content_hash(seed.layer, content)
            candidate_id = str(uuid4())
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO memory_candidates (
                    id, space_id, layer, content, source_type, source_id,
                    source_title, source_excerpt, confidence, impact, status,
                    content_hash, accepted_memory_id, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?)
                """,
                (
                    candidate_id,
                    space_id,
                    seed.layer,
                    content,
                    seed.source_type,
                    seed.source_id,
                    seed.source_title.strip()[:200],
                    _compact(seed.source_excerpt, 500),
                    max(0.0, min(seed.confidence, 1.0)),
                    seed.impact,
                    content_hash,
                    now,
                    now,
                ),
            )
            if cursor.rowcount:
                row = conn.execute(
                    "SELECT * FROM memory_candidates WHERE id = ?",
                    (candidate_id,),
                ).fetchone()
                created.append(_candidate_response(dict(row)))
    return created


def _settings_response(row: dict) -> dict:
    return {
        "space_id": row["space_id"],
        "auto_extract_enabled": bool(row["auto_extract_enabled"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _candidate_response(row: dict) -> dict:
    return {
        "id": row["id"],
        "space_id": row["space_id"],
        "layer": row["layer"],
        "content": row["content"],
        "source_type": row["source_type"],
        "source_id": row.get("source_id"),
        "source_title": row.get("source_title") or "",
        "source_excerpt": row.get("source_excerpt") or "",
        "confidence": round(float(row.get("confidence") or 0), 4),
        "impact": row.get("impact") or "medium",
        "status": row["status"],
        "accepted_memory_id": row.get("accepted_memory_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _memory_response(row: dict) -> dict:
    return {
        "id": row["id"],
        "space_id": row["space_id"],
        "layer": row["layer"],
        "content": row["content"],
        "source_type": row["source_type"],
        "source_id": row.get("source_id"),
        "source_title": row.get("source_title") or "",
        "source_excerpt": row.get("source_excerpt") or "",
        "priority": int(row.get("priority") or 0),
        "status": row.get("status") or "active",
        "candidate_id": row.get("candidate_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _memory_context_response(row: dict) -> dict:
    return {
        "id": row["id"],
        "layer": row["layer"],
        "content": row["content"],
        "source_type": row["source_type"],
        "source_id": row.get("source_id"),
        "source_title": row.get("source_title") or "",
        "priority": int(row.get("priority") or 0),
        "updated_at": row["updated_at"],
    }


def _auto_extract_enabled(space_id: str) -> bool:
    return bool(get_memory_settings(space_id)["auto_extract_enabled"])


def _validate_layer(layer: str) -> None:
    if layer not in VALID_LAYER_IDS:
        raise bad_request("Invalid memory layer.")


def _validate_source_type(source_type: str) -> None:
    if source_type not in VALID_SOURCE_TYPES:
        raise bad_request("Invalid memory source type.")


def _validate_impact(impact: str) -> None:
    if impact not in VALID_IMPACTS:
        raise bad_request("Invalid memory impact.")


def _normalize_content(content: str) -> str:
    value = " ".join(content.strip().split())
    if not value:
        raise bad_request("Memory content cannot be empty.")
    if len(value) > 1200:
        raise bad_request("Memory content cannot exceed 1200 characters.")
    return value


def _content_hash(layer: str, content: str) -> str:
    return hashlib.sha256(f"{layer}:{_normalize_for_hash(content)}".encode("utf-8")).hexdigest()


def _normalize_for_hash(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _priority_for_impact(impact: str) -> int:
    if impact == "high":
        return 2
    if impact == "medium":
        return 1
    return 0


def _plain_text(markdown: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", markdown)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^[#>*\-\s]+", "", text, flags=re.MULTILINE)
    return _compact(text, 4000)


def _first_sentence(text: str) -> str:
    sentences = _sentences(text)
    return sentences[0] if sentences else text


def _find_sentence(text: str, patterns: tuple[str, ...]) -> str | None:
    lowered = text.lower()
    if not any(pattern.lower() in lowered for pattern in patterns):
        return None
    for sentence in _sentences(text):
        sentence_lower = sentence.lower()
        if any(pattern.lower() in sentence_lower for pattern in patterns):
            return sentence
    return _compact(text, 180)


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[。！？!?])\s+|[\r\n]+", text)
    sentences = []
    for part in parts:
        value = _compact(part, 240)
        if value:
            sentences.append(value)
    return sentences


def _compact(text: str, limit: int = 200) -> str:
    value = " ".join(str(text).split())
    if len(value) <= limit:
        return value
    return f"{value[:limit].rstrip()}..."
