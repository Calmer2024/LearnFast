from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from uuid import uuid4

from learnfast.core.errors import bad_request, not_found
from learnfast.core.limits import (
    MAX_NOTE_SIZE_BYTES,
    MAX_NOTE_SIZE_MB,
    MAX_REPORT_RANGE_DAYS,
)
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now
from learnfast.services.indexer import index_note_markdown
from learnfast.services.memory_service import extract_memory_candidates_from_note
from learnfast.services.system_logs import log_event


WEAKNESS_PATTERNS = (
    "薄弱",
    "不熟",
    "不稳定",
    "混淆",
    "错误",
    "还需要",
    "需加强",
    "需要练习",
    "遗漏",
)


def list_reports(space_id: str, limit: int = 20) -> list[dict]:
    limit = max(1, min(limit, 50))
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, space_id, title, range_start, range_end, source_ids_json,
                   metadata_json, status, saved_note_id, created_at, updated_at
            FROM reports
            WHERE space_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (space_id, limit),
        ).fetchall()
    return [_report_response(dict(row), include_markdown=False) for row in rows]


def get_report(space_id: str, report_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM reports WHERE id = ? AND space_id = ?",
            (report_id, space_id),
        ).fetchone()
    report = row_to_dict(row)
    if not report:
        raise not_found("Learning report not found.")
    return _report_response(report)


def generate_report(
    *,
    space_id: str,
    range_start: str | None = None,
    range_end: str | None = None,
    source_ids: list[str] | None = None,
    include_notes: bool = True,
    include_memories: bool = True,
    title: str | None = None,
) -> dict:
    start_date, end_date = _validate_range(range_start, range_end)
    clean_source_ids = _validate_source_ids(space_id, source_ids)
    context = _collect_context(
        space_id=space_id,
        range_start=start_date.isoformat(),
        range_end=end_date.isoformat(),
        source_ids=clean_source_ids,
        include_notes=include_notes,
        include_memories=include_memories,
    )
    if context["signal_count"] == 0:
        raise bad_request(
            "当前范围内还没有可复盘的学习证据。请先完成任务、保存笔记、进行带引用问答，或扩大报告范围。"
        )

    custom_title = _compact(title, 160) if title is not None else ""
    report_title = custom_title or _compact(_default_title(context["space"], start_date, end_date), 160)
    markdown, evidences = _render_report_markdown(
        title=report_title,
        range_start=start_date.isoformat(),
        range_end=end_date.isoformat(),
        source_ids=clean_source_ids,
        context=context,
    )
    metadata = {
        "generation_mode": "local_deterministic_mvp",
        "include_notes": include_notes,
        "include_memories": include_memories,
        "evidence_count": len(evidences),
        "counts": context["counts"],
        "evidences": evidences,
    }
    now = utc_now()
    report_id = str(uuid4())
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO reports (
                id, space_id, title, range_start, range_end, source_ids_json,
                markdown, metadata_json, status, saved_note_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated', NULL, ?, ?)
            """,
            (
                report_id,
                space_id,
                report_title,
                start_date.isoformat(),
                end_date.isoformat(),
                json.dumps(clean_source_ids, ensure_ascii=False),
                markdown,
                json.dumps(metadata, ensure_ascii=False),
                now,
                now,
            ),
        )
        conn.execute("UPDATE spaces SET updated_at = ? WHERE id = ?", (now, space_id))
    log_event(
        "report",
        "手动学习报告已生成",
        space_id=space_id,
        details={
            "report_id": report_id,
            "title": report_title,
            "range_start": start_date.isoformat(),
            "range_end": end_date.isoformat(),
            "source_ids": clean_source_ids,
            "evidence_count": len(evidences),
            "counts": context["counts"],
        },
    )
    return get_report(space_id, report_id)


def save_report_as_note(
    *,
    space_id: str,
    report_id: str,
    title: str | None = None,
) -> dict:
    report = get_report(space_id, report_id)
    note_title = _compact(title or report["title"], 160)
    if not note_title:
        note_title = "学习报告"
    markdown = report["markdown"].strip() + "\n"
    _validate_note_markdown(markdown)
    tags = ["报告", "学习复盘"]
    now = utc_now()
    note_id = report.get("saved_note_id")
    existing = _get_note_or_none(space_id, note_id) if note_id else None
    if existing:
        with get_db() as conn:
            conn.execute(
                """
                UPDATE notes
                SET title = ?, markdown = ?, tags_json = ?, status = 'saved',
                    source_type = 'report', updated_at = ?
                WHERE id = ? AND space_id = ?
                """,
                (
                    note_title,
                    markdown,
                    json.dumps(tags, ensure_ascii=False),
                    now,
                    existing["id"],
                    space_id,
                ),
            )
        note_id = existing["id"]
    else:
        note_id = str(uuid4())
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO notes (
                    id, space_id, title, markdown, tags_json, status,
                    source_type, source_message_id, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'saved', 'report', NULL, ?, ?)
                """,
                (
                    note_id,
                    space_id,
                    note_title,
                    markdown,
                    json.dumps(tags, ensure_ascii=False),
                    now,
                    now,
                ),
            )
    note = _get_note(space_id, note_id)
    index_result = index_note_markdown(space_id, note, markdown)
    note["chunk_count"] = index_result.chunk_count
    note["index_version_id"] = index_result.version_id
    note["indexed_at"] = index_result.indexed_at
    memory_candidates = extract_memory_candidates_from_note(space_id, note)
    with get_db() as conn:
        conn.execute(
            """
            UPDATE reports
            SET saved_note_id = ?, status = 'saved_note', updated_at = ?
            WHERE id = ? AND space_id = ?
            """,
            (note_id, utc_now(), report_id, space_id),
        )
    log_event(
        "report",
        "学习报告已保存为笔记",
        space_id=space_id,
        details={
            "report_id": report_id,
            "note_id": note_id,
            "title": note_title,
            "chunk_count": note.get("chunk_count"),
            "memory_candidate_count": len(memory_candidates),
        },
    )
    return {"report": get_report(space_id, report_id), "note": note}


def export_report_markdown(space_id: str, report_id: str) -> dict:
    report = get_report(space_id, report_id)
    return {
        "report_id": report_id,
        "title": report["title"],
        "markdown": report["markdown"],
    }


def _collect_context(
    *,
    space_id: str,
    range_start: str,
    range_end: str,
    source_ids: list[str],
    include_notes: bool,
    include_memories: bool,
) -> dict:
    space = _space(space_id)
    tasks = _tasks_for_report(space_id, source_ids)
    completed_tasks = [
        task
        for task in tasks
        if task["status"] == "done"
        and _date_in_range(task.get("completed_at") or task.get("updated_at"), range_start, range_end)
    ]
    unfinished_tasks = [
        task
        for task in tasks
        if task["status"] != "done" and task.get("plan_status") == "active"
    ]
    review_tasks = [
        task
        for task in completed_tasks
        if task.get("review_result") or task.get("task_type") == "review"
    ]
    notes = _recent_notes(space_id, range_start, range_end) if include_notes else []
    cited_messages = _cited_messages(space_id, range_start, range_end, source_ids)
    memories = _active_memories(space_id) if include_memories else []
    sources = _ready_sources(space_id, source_ids)
    counts = {
        "completed_tasks": len(completed_tasks),
        "unfinished_tasks": len(unfinished_tasks),
        "review_tasks": len(review_tasks),
        "notes": len(notes),
        "cited_messages": len(cited_messages),
        "memories": len(memories),
        "ready_sources": len(sources),
    }
    signal_count = len(completed_tasks) + len(notes) + len(cited_messages)
    return {
        "space": space,
        "sources": sources,
        "completed_tasks": completed_tasks,
        "unfinished_tasks": unfinished_tasks,
        "review_tasks": review_tasks,
        "notes": notes,
        "cited_messages": cited_messages,
        "memories": memories,
        "counts": counts,
        "signal_count": signal_count,
    }


def _render_report_markdown(
    *,
    title: str,
    range_start: str,
    range_end: str,
    source_ids: list[str],
    context: dict,
) -> tuple[str, list[dict]]:
    evidences: list[dict] = []
    space = context["space"]
    counts = context["counts"]
    lines = [
        f"# {title}",
        "",
        f"- 学习空间：{space['name']}",
        f"- 报告范围：{range_start} 至 {range_end}",
        f"- 学习目标：{space.get('goal') or '未设置'}",
        f"- 来源范围：{_source_scope_label(context['sources'], source_ids)}",
        f"- 生成方式：本地确定性 MVP 报告",
        "",
        "## 完成事项",
        "",
    ]
    completed = context["completed_tasks"][:8]
    if completed:
        for task in completed:
            ref = _add_evidence(
                evidences,
                source_type="plan_task",
                source_id=task["id"],
                title=task["title"],
                detail=f"计划《{task['plan_title']}》 · 完成于 {_date_label(task.get('completed_at'))}",
                quote=task.get("review_result") or task.get("description") or task["title"],
            )
            lines.append(
                f"- 已完成“{task['title']}”，状态记录为{_status_label(task['status'])}。证据：[{ref}]"
            )
            if task.get("review_result"):
                lines.append(f"  - 复习结果：{task['review_result']}")
    else:
        lines.append("- 本范围内没有已完成任务记录。")

    lines.extend(["", "## 未完成事项", ""])
    unfinished = context["unfinished_tasks"][:10]
    if unfinished:
        for task in unfinished:
            ref = _add_evidence(
                evidences,
                source_type="plan_task",
                source_id=task["id"],
                title=task["title"],
                detail=f"计划《{task['plan_title']}》 · 当前状态 {_status_label(task['status'])}",
                quote=task.get("description") or task.get("recommended_reason") or task["title"],
            )
            due = f"，截止 {task['due_date']}" if task.get("due_date") else ""
            lines.append(
                f"- “{task['title']}”仍为{_status_label(task['status'])}{due}。证据：[{ref}]"
            )
            if task.get("recommended_reason"):
                lines.append(f"  - 推荐原因：{task['recommended_reason']}")
    else:
        lines.append("- 当前计划范围内没有未完成任务。")

    lines.extend(["", "## 主要知识点", ""])
    knowledge_lines = _knowledge_lines(context, evidences)
    if knowledge_lines:
        lines.extend(knowledge_lines)
    else:
        lines.append("- 本范围内缺少带引用问答或笔记，暂不提炼知识点，避免生成空泛结论。")

    lines.extend(["", "## 薄弱点", ""])
    weakness_lines = _weakness_lines(context, evidences)
    if weakness_lines:
        lines.extend(weakness_lines)
    else:
        lines.append("- 本范围内没有明确薄弱点记录；下一轮复习应主动记录错因、卡点或不确定概念。")

    lines.extend(["", "## 下一步建议", ""])
    suggestion_lines = _suggestion_lines(context, evidences)
    if suggestion_lines:
        lines.extend(suggestion_lines)
    else:
        lines.append("- 继续完成当前计划，并在每次复习后回写结果，形成下一份报告的证据链。")

    lines.extend(["", "## 证据来源", ""])
    if evidences:
        for evidence in evidences:
            line = f"[{evidence['ref']}] {evidence['source_label']}：{evidence['title']}"
            if evidence.get("detail"):
                line += f" · {evidence['detail']}"
            lines.append(line)
            if evidence.get("quote"):
                lines.append(f"> {_compact(evidence['quote'], 320)}")
                lines.append("")
    else:
        lines.append("- 未收集到可引用证据。")

    lines.extend(["", "## 数据概览", ""])
    lines.extend(
        [
            f"- 完成任务：{counts['completed_tasks']}",
            f"- 未完成任务：{counts['unfinished_tasks']}",
            f"- 复习记录：{counts['review_tasks']}",
            f"- 笔记：{counts['notes']}",
            f"- 带引用问答：{counts['cited_messages']}",
            f"- 长期记忆：{counts['memories']}",
            f"- 可用资料：{counts['ready_sources']}",
        ]
    )
    return "\n".join(lines).strip() + "\n", evidences


def _knowledge_lines(context: dict, evidences: list[dict]) -> list[str]:
    lines: list[str] = []
    for message in context["cited_messages"][:4]:
        citation = message["citations"][0]
        ref = _add_evidence(
            evidences,
            source_type=citation["source_type"],
            source_id=citation["source_id"],
            title=citation["source_title"],
            detail=f"问答引用 · {citation['locator']}",
            quote=citation["quote_snapshot"],
        )
        topic = _compact(message.get("question") or message["content"], 90)
        point = _first_sentence(message["content"])
        lines.append(f"- 围绕“{topic}”，已形成结论：{point}。证据：[{ref}]")
    used_note_ids = set()
    for note in context["notes"][:4]:
        if note["id"] in used_note_ids:
            continue
        used_note_ids.add(note["id"])
        summary = _note_summary(note)
        if not summary:
            continue
        ref = _add_evidence(
            evidences,
            source_type="note",
            source_id=note["id"],
            title=note["title"],
            detail=f"笔记更新于 {_date_label(note.get('updated_at'))}",
            quote=summary,
        )
        lines.append(f"- 笔记《{note['title']}》沉淀了：{summary}。证据：[{ref}]")
        if len(lines) >= 6:
            break
    return lines


def _weakness_lines(context: dict, evidences: list[dict]) -> list[str]:
    lines: list[str] = []
    for task in context["review_tasks"]:
        result = task.get("review_result") or ""
        if not any(pattern in result for pattern in WEAKNESS_PATTERNS):
            continue
        ref = _add_evidence(
            evidences,
            source_type="plan_task",
            source_id=task["id"],
            title=task["title"],
            detail=f"复习任务 · 完成于 {_date_label(task.get('completed_at'))}",
            quote=result,
        )
        lines.append(f"- 复习结果提示仍有卡点：{_compact(result, 140)}。证据：[{ref}]")
        if len(lines) >= 3:
            return lines
    for memory in context["memories"]:
        if memory["layer"] != "learning_ability":
            continue
        ref = _add_evidence(
            evidences,
            source_type="memory",
            source_id=memory["id"],
            title=memory["source_title"] or "长期记忆",
            detail="学习能力记忆",
            quote=memory["content"],
        )
        lines.append(f"- 长期记忆记录了薄弱点：{memory['content']}。证据：[{ref}]")
        if len(lines) >= 4:
            break
    overdue = [task for task in context["unfinished_tasks"] if _is_overdue(task.get("due_date"))]
    if overdue:
        task = overdue[0]
        ref = _add_evidence(
            evidences,
            source_type="plan_task",
            source_id=task["id"],
            title=task["title"],
            detail=f"延期任务 · 截止 {task['due_date']}",
            quote=task.get("description") or task["title"],
        )
        lines.append(f"- 存在延期任务“{task['title']}”，需要缩小下一步动作。证据：[{ref}]")
    return lines[:5]


def _suggestion_lines(context: dict, evidences: list[dict]) -> list[str]:
    lines: list[str] = []
    if context["unfinished_tasks"]:
        high = next(
            (task for task in context["unfinished_tasks"] if task.get("priority") == "high"),
            context["unfinished_tasks"][0],
        )
        ref = _add_evidence(
            evidences,
            source_type="plan_task",
            source_id=high["id"],
            title=high["title"],
            detail=f"未完成任务 · {_status_label(high['status'])}",
            quote=high.get("description") or high.get("recommended_reason") or high["title"],
        )
        lines.append(f"- 下一步先处理“{high['title']}”，把范围压到一次可完成行动。证据：[{ref}]")
    if context["cited_messages"] and not context["review_tasks"]:
        message = context["cited_messages"][0]
        citation = message["citations"][0]
        ref = _add_evidence(
            evidences,
            source_type=citation["source_type"],
            source_id=citation["source_id"],
            title=citation["source_title"],
            detail="最近带引用问答",
            quote=citation["quote_snapshot"],
        )
        lines.append("- 把最近带引用问答转成复习任务，并回写复习结果。证据：[{ref}]".format(ref=ref))
    if context["notes"]:
        note = context["notes"][0]
        ref = _add_evidence(
            evidences,
            source_type="note",
            source_id=note["id"],
            title=note["title"],
            detail="最近笔记",
            quote=_note_summary(note),
        )
        lines.append(f"- 将笔记《{note['title']}》整理成 3 个自测问题。证据：[{ref}]")
    if not context["notes"] and context["sources"]:
        source = context["sources"][0]
        ref = _add_evidence(
            evidences,
            source_type="source",
            source_id=source["id"],
            title=source["title"],
            detail=f"已就绪资料 · {source.get('chunk_count') or 0} 个片段",
            quote="资料已完成索引，可作为下一轮笔记和问答依据。",
        )
        lines.append(f"- 先基于《{source['title']}》补一条结构化笔记。证据：[{ref}]")
    return lines[:5]


def _tasks_for_report(space_id: str, source_ids: list[str]) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT plan_tasks.*, plans.title AS plan_title, plans.status AS plan_status
            FROM plan_tasks
            JOIN plans ON plans.id = plan_tasks.plan_id
            WHERE plan_tasks.space_id = ?
            ORDER BY plan_tasks.order_index ASC, plan_tasks.updated_at DESC
            """,
            (space_id,),
        ).fetchall()
    tasks = [_task_response(dict(row)) for row in rows]
    if not source_ids:
        return tasks
    selected = set(source_ids)
    return [
        task
        for task in tasks
        if not task["source_ids"] or selected.intersection(task["source_ids"])
    ]


def _recent_notes(space_id: str, range_start: str, range_end: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT notes.*,
                   (
                       SELECT COUNT(*)
                       FROM note_chunks
                       WHERE note_chunks.note_id = notes.id
                   ) AS chunk_count
            FROM notes
            WHERE space_id = ?
              AND substr(updated_at, 1, 10) BETWEEN ? AND ?
            ORDER BY updated_at DESC
            LIMIT 8
            """,
            (space_id, range_start, range_end),
        ).fetchall()
    return [_note_response(dict(row)) for row in rows]


def _cited_messages(
    space_id: str,
    range_start: str,
    range_end: str,
    source_ids: list[str],
) -> list[dict]:
    params: list[object] = [space_id, range_start, range_end]
    source_clause = ""
    if source_ids:
        placeholders = ", ".join("?" for _ in source_ids)
        source_clause = f" AND citations.source_type = 'source' AND citations.source_id IN ({placeholders})"
        params.extend(source_ids)
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT citations.*, chat_messages.content AS answer_content,
                   chat_messages.created_at AS answered_at,
                   parent.content AS question_content
            FROM citations
            JOIN chat_messages ON chat_messages.id = citations.message_id
            LEFT JOIN chat_messages AS parent ON parent.id = chat_messages.parent_message_id
            WHERE citations.space_id = ?
              AND substr(chat_messages.created_at, 1, 10) BETWEEN ? AND ?
              {source_clause}
            ORDER BY chat_messages.created_at DESC, citations.score DESC
            LIMIT 16
            """,
            tuple(params),
        ).fetchall()
    grouped: dict[str, dict] = {}
    for row in rows:
        item = dict(row)
        message = grouped.setdefault(
            item["message_id"],
            {
                "message_id": item["message_id"],
                "content": item["answer_content"],
                "question": item.get("question_content") or "未记录原问题",
                "created_at": item["answered_at"],
                "citations": [],
            },
        )
        message["citations"].append(_citation_response(item))
    return list(grouped.values())[:6]


def _active_memories(space_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM memories
            WHERE space_id = ? AND status = 'active'
            ORDER BY priority DESC, updated_at DESC
            LIMIT 8
            """,
            (space_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def _ready_sources(space_id: str, source_ids: list[str]) -> list[dict]:
    params: list[object] = [space_id]
    clause = ""
    if source_ids:
        placeholders = ", ".join("?" for _ in source_ids)
        clause = f" AND id IN ({placeholders})"
        params.extend(source_ids)
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT id, title, status, chunk_count, updated_at
            FROM sources
            WHERE space_id = ? AND status = 'ready' AND enabled = 1 {clause}
            ORDER BY updated_at DESC
            LIMIT 8
            """,
            tuple(params),
        ).fetchall()
    return [dict(row) for row in rows]


def _space(space_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM spaces WHERE id = ?", (space_id,)).fetchone()
    space = row_to_dict(row)
    if not space:
        raise not_found("Learning space not found.")
    return space


def _validate_range(range_start: str | None, range_end: str | None) -> tuple[date, date]:
    end_date = _parse_date(range_end, "range_end") if range_end else date.today()
    start_date = _parse_date(range_start, "range_start") if range_start else end_date - timedelta(days=7)
    if start_date > end_date:
        raise bad_request("range_start cannot be later than range_end.")
    if (end_date - start_date).days > MAX_REPORT_RANGE_DAYS:
        raise bad_request(f"Single report range cannot exceed {MAX_REPORT_RANGE_DAYS} days.")
    return start_date, end_date


def _validate_source_ids(space_id: str, source_ids: list[str] | None) -> list[str]:
    deduped: list[str] = []
    for source_id in source_ids or []:
        value = str(source_id).strip()
        if value and value not in deduped:
            deduped.append(value)
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


def _parse_date(value: str | None, field_name: str) -> date:
    try:
        return datetime.strptime(value or "", "%Y-%m-%d").date()
    except ValueError as exc:
        raise bad_request(f"{field_name} must be an ISO date like 2026-07-10.") from exc


def _date_in_range(value: str | None, range_start: str, range_end: str) -> bool:
    if not value:
        return False
    day = value[:10]
    return range_start <= day <= range_end


def _is_overdue(value: str | None) -> bool:
    if not value:
        return False
    parsed = _parse_date_or_none(value)
    return bool(parsed and parsed < date.today())


def _parse_date_or_none(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _report_response(row: dict, *, include_markdown: bool = True) -> dict:
    response = {
        "id": row["id"],
        "space_id": row["space_id"],
        "title": row["title"],
        "range_start": row["range_start"],
        "range_end": row["range_end"],
        "source_ids": json.loads(row.get("source_ids_json") or "[]"),
        "metadata": json.loads(row.get("metadata_json") or "{}"),
        "status": row.get("status") or "generated",
        "saved_note_id": row.get("saved_note_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if include_markdown:
        response["markdown"] = row["markdown"]
    return response


def _task_response(row: dict) -> dict:
    return {
        "id": row["id"],
        "space_id": row["space_id"],
        "plan_id": row["plan_id"],
        "plan_title": row.get("plan_title") or "当前计划",
        "plan_status": row.get("plan_status") or "active",
        "title": row["title"],
        "description": row.get("description") or "",
        "task_type": row.get("task_type") or "study",
        "status": row.get("status") or "todo",
        "priority": row.get("priority") or "medium",
        "due_date": row.get("due_date"),
        "source_ids": json.loads(row.get("source_ids_json") or "[]"),
        "review_prompt": row.get("review_prompt") or "",
        "recommended_reason": row.get("recommended_reason") or "",
        "completed_at": row.get("completed_at"),
        "review_result": row.get("review_result") or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _citation_response(row: dict) -> dict:
    return {
        "chunk_id": row["chunk_id"],
        "source_type": row.get("source_type") or "source",
        "source_id": row["source_id"],
        "source_title": row["source_title"],
        "version_id": row["version_id"],
        "ordinal": row["ordinal"],
        "heading_path": json.loads(row.get("heading_path_json") or "[]"),
        "locator": row["locator"],
        "quote_snapshot": row["quote_snapshot"],
        "score": round(row["score"], 6),
    }


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
        "chunk_count": row.get("chunk_count", 0),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _get_note(space_id: str, note_id: str) -> dict:
    note = _get_note_or_none(space_id, note_id)
    if not note:
        raise not_found("Note not found.")
    return note


def _get_note_or_none(space_id: str, note_id: str | None) -> dict | None:
    if not note_id:
        return None
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT notes.*,
                   (
                       SELECT COUNT(*)
                       FROM note_chunks
                       WHERE note_chunks.note_id = notes.id
                   ) AS chunk_count
            FROM notes
            WHERE id = ? AND space_id = ?
            """,
            (note_id, space_id),
        ).fetchone()
    return _note_response(dict(row)) if row else None


def _validate_note_markdown(markdown: str) -> None:
    if not markdown.strip():
        raise bad_request("Report markdown cannot be empty.")
    if len(markdown.encode("utf-8")) > MAX_NOTE_SIZE_BYTES:
        raise bad_request(f"Single note cannot exceed {MAX_NOTE_SIZE_MB} MB.")


def _add_evidence(
    evidences: list[dict],
    *,
    source_type: str,
    source_id: str,
    title: str,
    detail: str,
    quote: str,
) -> str:
    ref = f"E{len(evidences) + 1}"
    evidences.append(
        {
            "ref": ref,
            "source_type": source_type,
            "source_label": _source_type_label(source_type),
            "source_id": source_id,
            "title": _compact(title, 180),
            "detail": _compact(detail, 240),
            "quote": _compact(quote, 500),
        }
    )
    return ref


def _source_scope_label(sources: list[dict], source_ids: list[str]) -> str:
    if not source_ids:
        return "当前空间全部可用资料、笔记、计划和记忆"
    if not sources:
        return "已选择资料，但当前没有可用索引"
    names = "、".join(source["title"] for source in sources[:4])
    if len(sources) > 4:
        names += f"等 {len(sources)} 个资料"
    return names


def _note_summary(note: dict) -> str:
    markdown = note.get("markdown") or ""
    headings = [
        line.lstrip("#").strip()
        for line in markdown.splitlines()
        if line.strip().startswith("#")
    ]
    if headings:
        return _compact("、".join(headings[:3]), 180)
    return _first_sentence(_plain_text(markdown))


def _first_sentence(text: str) -> str:
    compact = _compact(_plain_text(text), 220)
    if not compact:
        return "未记录摘要"
    parts = re.split(r"(?<=[。！？!?\.])\s+", compact)
    return _compact(parts[0] if parts else compact, 180)


def _plain_text(markdown: str) -> str:
    text = re.sub(r"```.*?```", " ", markdown, flags=re.S)
    text = re.sub(r"[#>*_`\-\[\]\(\)]", " ", text)
    return " ".join(text.split())


def _default_title(space: dict, start_date: date, end_date: date) -> str:
    return f"学习报告：{space['name']} {start_date.isoformat()} 至 {end_date.isoformat()}"


def _date_label(value: str | None) -> str:
    if not value:
        return "未记录"
    return value[:10]


def _status_label(status: str) -> str:
    return {
        "todo": "待做",
        "in_progress": "进行中",
        "done": "已完成",
        "skipped": "已跳过",
    }.get(status, status)


def _source_type_label(source_type: str) -> str:
    return {
        "source": "资料",
        "note": "笔记",
        "plan_task": "计划任务",
        "memory": "长期记忆",
    }.get(source_type, source_type)


def _compact(value: object, limit: int = 200) -> str:
    text = " ".join(str(value or "").strip().split())
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."
