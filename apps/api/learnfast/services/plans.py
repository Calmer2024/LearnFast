from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from uuid import uuid4

from learnfast.core.errors import bad_request, not_found
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now
from learnfast.services.memory_service import create_memory, list_memories
from learnfast.services.system_logs import log_event


VALID_PLAN_STATUSES = {"active", "archived"}
VALID_TASK_TYPES = {"study", "review", "practice", "note"}
VALID_TASK_STATUSES = {"todo", "in_progress", "done", "skipped"}
VALID_PRIORITIES = {"low", "medium", "high"}


def get_current_plan(space_id: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM plans
            WHERE space_id = ? AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (space_id,),
        ).fetchone()
    plan = row_to_dict(row)
    if not plan:
        return None
    return get_plan(space_id, plan["id"])


def get_plan(space_id: str, plan_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM plans WHERE id = ? AND space_id = ?",
            (plan_id, space_id),
        ).fetchone()
    plan = row_to_dict(row)
    if not plan:
        raise not_found("Learning plan not found.")
    return _plan_response(plan)


def create_plan(
    *,
    space_id: str,
    title: str | None,
    goal: str,
    cadence: str = "",
    target_level: str = "",
    deadline: str | None = None,
    assumptions: dict | None = None,
    rationale: str = "",
    tasks: list[dict] | None = None,
    replace_current: bool = True,
) -> dict:
    normalized_goal = _compact(goal, 1000)
    if not normalized_goal:
        raise bad_request("Plan goal cannot be empty.")
    _validate_date(deadline, "deadline")
    task_seeds = tasks or _starter_tasks(normalized_goal)
    if not task_seeds:
        raise bad_request("Plan must contain at least one task.")

    now = utc_now()
    plan_id = str(uuid4())
    plan_title = _compact(title or _plan_title(normalized_goal), 160)
    with get_db() as conn:
        if replace_current:
            conn.execute(
                """
                UPDATE plans
                SET status = 'archived', updated_at = ?
                WHERE space_id = ? AND status = 'active'
                """,
                (now, space_id),
            )
        conn.execute(
            """
            INSERT INTO plans (
                id, space_id, title, goal, status, cadence, target_level,
                deadline, assumptions_json, rationale, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                plan_id,
                space_id,
                plan_title,
                normalized_goal,
                _compact(cadence, 120),
                _compact(target_level, 160),
                deadline,
                json.dumps(assumptions or {}, ensure_ascii=False),
                _compact(rationale, 1200),
                now,
                now,
            ),
        )
        _insert_task_seeds(conn, space_id, plan_id, task_seeds, now)
        _touch_space(conn, space_id, now)

    log_event(
        "plan",
        "学习计划已创建",
        space_id=space_id,
        details={"plan_id": plan_id, "title": plan_title, "task_count": len(task_seeds)},
    )
    return get_plan(space_id, plan_id)


def generate_plan(
    *,
    space_id: str,
    goal: str | None = None,
    cadence: str = "每周 4 次，每次 45 分钟",
    target_level: str = "能独立复述核心概念，并完成基础练习",
    deadline: str | None = None,
    replace_current: bool = True,
) -> dict:
    space = _space(space_id)
    ready_sources = _ready_sources(space_id)
    notes = _recent_notes(space_id)
    weakness_memories = [
        memory
        for memory in list_memories(space_id, layer="learning_ability")
        if memory["status"] == "active"
    ]
    normalized_goal = _compact(goal or space.get("goal") or "", 1000)
    if not normalized_goal:
        normalized_goal = "建立当前主题的基础理解，并形成可复习的笔记和问答记录。"
    _validate_date(deadline, "deadline")

    assumptions = {
        "goal": normalized_goal,
        "cadence": _compact(cadence, 120),
        "target_level": _compact(target_level, 160),
        "deadline": deadline,
        "source_count": len(ready_sources),
        "note_count": len(notes),
        "weakness_count": len(weakness_memories),
        "generation_mode": "local_deterministic_mvp",
    }
    tasks = _generated_tasks(
        goal=normalized_goal,
        ready_sources=ready_sources,
        notes=notes,
        weakness_memories=weakness_memories,
        deadline=deadline,
    )
    rationale = _plan_rationale(ready_sources, notes, weakness_memories)
    plan = create_plan(
        space_id=space_id,
        title=f"{_plan_title(normalized_goal)}",
        goal=normalized_goal,
        cadence=cadence,
        target_level=target_level,
        deadline=deadline,
        assumptions=assumptions,
        rationale=rationale,
        tasks=tasks,
        replace_current=replace_current,
    )
    log_event(
        "plan",
        "AI 学习计划建议已生成",
        space_id=space_id,
        details={
            "plan_id": plan["id"],
            "source_count": len(ready_sources),
            "note_count": len(notes),
            "weakness_count": len(weakness_memories),
            "task_count": len(plan["tasks"]),
        },
    )
    return plan


def update_plan(
    space_id: str,
    plan_id: str,
    *,
    title: str | None = None,
    goal: str | None = None,
    status: str | None = None,
    cadence: str | None = None,
    target_level: str | None = None,
    deadline: str | None = None,
) -> dict:
    get_plan(space_id, plan_id)
    values: list[tuple[str, object]] = []
    if title is not None:
        values.append(("title", _required_compact(title, "Plan title", 160)))
    if goal is not None:
        values.append(("goal", _required_compact(goal, "Plan goal", 1000)))
    if status is not None:
        _validate_choice(status, VALID_PLAN_STATUSES, "Invalid plan status.")
        values.append(("status", status))
    if cadence is not None:
        values.append(("cadence", _compact(cadence, 120)))
    if target_level is not None:
        values.append(("target_level", _compact(target_level, 160)))
    if deadline is not None:
        _validate_date(deadline or None, "deadline")
        values.append(("deadline", deadline or None))
    if not values:
        raise bad_request("No fields to update.")

    now = utc_now()
    assignments = ", ".join(f"{column} = ?" for column, _ in values)
    params = [value for _, value in values]
    params.extend([now, plan_id, space_id])
    with get_db() as conn:
        conn.execute(
            f"""
            UPDATE plans
            SET {assignments}, updated_at = ?
            WHERE id = ? AND space_id = ?
            """,
            tuple(params),
        )
        _touch_space(conn, space_id, now)
    log_event(
        "plan",
        "学习计划已更新",
        space_id=space_id,
        details={"plan_id": plan_id, "changes": [column for column, _ in values]},
    )
    return get_plan(space_id, plan_id)


def create_task(
    space_id: str,
    plan_id: str,
    payload: dict,
) -> dict:
    get_plan(space_id, plan_id)
    task = _normalize_task_seed(payload, order_index=_next_order_index(plan_id))
    now = utc_now()
    task_id = str(uuid4())
    with get_db() as conn:
        _insert_task(conn, space_id, plan_id, task_id, task, now)
        _insert_event(
            conn,
            space_id=space_id,
            plan_id=plan_id,
            task_id=task_id,
            event_type="created",
            note="任务已创建",
            metadata={},
            created_at=now,
        )
        _touch_plan_and_space(conn, space_id, plan_id, now)
    log_event(
        "plan",
        "计划任务已创建",
        space_id=space_id,
        details={"plan_id": plan_id, "task_id": task_id, "title": task["title"]},
    )
    return get_plan(space_id, plan_id)


def update_task(
    space_id: str,
    plan_id: str,
    task_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    task_type: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    due_date: str | None = None,
    source_ids: list[str] | None = None,
    review_prompt: str | None = None,
    recommended_reason: str | None = None,
    order_index: int | None = None,
) -> dict:
    current = _get_task(space_id, plan_id, task_id)
    values: list[tuple[str, object]] = []
    event_metadata: dict[str, object] = {}
    if title is not None:
        values.append(("title", _required_compact(title, "Task title", 180)))
    if description is not None:
        values.append(("description", _compact(description, 1200)))
    if task_type is not None:
        _validate_choice(task_type, VALID_TASK_TYPES, "Invalid task type.")
        values.append(("task_type", task_type))
    if status is not None:
        _validate_choice(status, VALID_TASK_STATUSES, "Invalid task status.")
        values.append(("status", status))
        if status == "done" and current["status"] != "done":
            values.append(("completed_at", utc_now()))
        if status != "done" and current["status"] == "done":
            values.append(("completed_at", None))
    if priority is not None:
        _validate_choice(priority, VALID_PRIORITIES, "Invalid task priority.")
        values.append(("priority", priority))
    if due_date is not None:
        _validate_date(due_date or None, "due_date")
        values.append(("due_date", due_date or None))
    if source_ids is not None:
        clean_source_ids = _validate_source_ids(space_id, source_ids)
        values.append(("source_ids_json", json.dumps(clean_source_ids, ensure_ascii=False)))
        event_metadata["source_ids"] = clean_source_ids
    if review_prompt is not None:
        values.append(("review_prompt", _compact(review_prompt, 1200)))
    if recommended_reason is not None:
        values.append(("recommended_reason", _compact(recommended_reason, 500)))
    if order_index is not None:
        values.append(("order_index", max(0, int(order_index))))
    if not values:
        raise bad_request("No fields to update.")

    now = utc_now()
    assignments = ", ".join(f"{column} = ?" for column, _ in values)
    params = [value for _, value in values]
    params.extend([now, task_id, plan_id, space_id])
    with get_db() as conn:
        conn.execute(
            f"""
            UPDATE plan_tasks
            SET {assignments}, updated_at = ?
            WHERE id = ? AND plan_id = ? AND space_id = ?
            """,
            tuple(params),
        )
        _insert_event(
            conn,
            space_id=space_id,
            plan_id=plan_id,
            task_id=task_id,
            event_type="updated",
            note="任务已编辑",
            metadata={"changed_fields": [column for column, _ in values], **event_metadata},
            created_at=now,
        )
        _touch_plan_and_space(conn, space_id, plan_id, now)
    log_event(
        "plan",
        "计划任务已更新",
        space_id=space_id,
        details={"plan_id": plan_id, "task_id": task_id, "changes": [column for column, _ in values]},
    )
    return get_plan(space_id, plan_id)


def complete_task(
    space_id: str,
    plan_id: str,
    task_id: str,
    *,
    review_result: str | None = None,
    message_id: str | None = None,
) -> dict:
    task = _get_task(space_id, plan_id, task_id)
    if message_id is not None:
        _validate_assistant_message(space_id, message_id)
    now = utc_now()
    result = _compact(review_result or task.get("review_result") or "", 1600)
    with get_db() as conn:
        conn.execute(
            """
            UPDATE plan_tasks
            SET status = 'done',
                completed_at = COALESCE(completed_at, ?),
                review_result = ?,
                last_review_message_id = COALESCE(?, last_review_message_id),
                updated_at = ?
            WHERE id = ? AND plan_id = ? AND space_id = ?
            """,
            (now, result, message_id, now, task_id, plan_id, space_id),
        )
        _insert_event(
            conn,
            space_id=space_id,
            plan_id=plan_id,
            task_id=task_id,
            event_type="completed",
            note=result or "任务已完成",
            metadata={"message_id": message_id},
            created_at=now,
        )
        _touch_plan_and_space(conn, space_id, plan_id, now)
    _remember_task_progress(space_id, task, "已完成", result)
    log_event(
        "plan",
        "计划任务已完成，空间进度已同步",
        space_id=space_id,
        details={"plan_id": plan_id, "task_id": task_id, "message_id": message_id},
    )
    return get_plan(space_id, plan_id)


def record_review_result(
    space_id: str,
    plan_id: str,
    task_id: str,
    *,
    result: str,
    message_id: str | None = None,
    mark_completed: bool = True,
) -> dict:
    task = _get_task(space_id, plan_id, task_id)
    if message_id is not None:
        _validate_assistant_message(space_id, message_id)
    normalized_result = _required_compact(result, "Review result", 1600)
    now = utc_now()
    status_clause = ", status = 'done', completed_at = COALESCE(completed_at, ?)" if mark_completed else ""
    params: list[object] = [normalized_result, message_id, now]
    if mark_completed:
        params.insert(2, now)
    params.extend([task_id, plan_id, space_id])
    with get_db() as conn:
        conn.execute(
            f"""
            UPDATE plan_tasks
            SET review_result = ?,
                last_review_message_id = COALESCE(?, last_review_message_id)
                {status_clause},
                updated_at = ?
            WHERE id = ? AND plan_id = ? AND space_id = ?
            """,
            tuple(params),
        )
        _insert_event(
            conn,
            space_id=space_id,
            plan_id=plan_id,
            task_id=task_id,
            event_type="review_recorded",
            note=normalized_result,
            metadata={"message_id": message_id, "mark_completed": mark_completed},
            created_at=now,
        )
        _touch_plan_and_space(conn, space_id, plan_id, now)
    _remember_task_progress(space_id, task, "复习已记录", normalized_result)
    log_event(
        "plan",
        "复习问答结果已回写计划任务",
        space_id=space_id,
        details={"plan_id": plan_id, "task_id": task_id, "message_id": message_id},
    )
    return get_plan(space_id, plan_id)


def delete_task(space_id: str, plan_id: str, task_id: str) -> dict:
    _get_task(space_id, plan_id, task_id)
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            "DELETE FROM plan_tasks WHERE id = ? AND plan_id = ? AND space_id = ?",
            (task_id, plan_id, space_id),
        )
        _touch_plan_and_space(conn, space_id, plan_id, now)
    log_event(
        "plan",
        "计划任务已删除",
        level="warn",
        space_id=space_id,
        details={"plan_id": plan_id, "task_id": task_id},
    )
    return get_plan(space_id, plan_id)


def export_plan_markdown(space_id: str, plan_id: str) -> dict:
    plan = get_plan(space_id, plan_id)
    summary = plan["summary"]
    lines = [
        f"# {plan['title']}",
        "",
        f"- 学习目标：{plan['goal']}",
        f"- 节奏假设：{plan['cadence'] or '未设置'}",
        f"- 目标水平：{plan['target_level'] or '未设置'}",
        f"- 截止日期：{plan['deadline'] or '未设置'}",
        f"- 当前进度：{summary['done_tasks']}/{summary['total_tasks']} ({summary['progress_percent']}%)",
        "",
        "## 关键假设",
        "",
    ]
    if plan["assumptions"]:
        for key, value in plan["assumptions"].items():
            lines.append(f"- {key}: {value if value not in (None, '') else '未设置'}")
    else:
        lines.append("- 未记录。")
    lines.extend(["", "## 任务列表", ""])
    for task in plan["tasks"]:
        marker = "x" if task["status"] == "done" else " "
        due = f" · 截止 {task['due_date']}" if task.get("due_date") else ""
        lines.append(f"- [{marker}] {task['title']} ({_task_type_label(task['task_type'])} / {task['priority']}){due}")
        if task.get("description"):
            lines.append(f"  - 说明：{task['description']}")
        if task.get("recommended_reason"):
            lines.append(f"  - 推荐原因：{task['recommended_reason']}")
        if task.get("review_result"):
            lines.append(f"  - 复习结果：{task['review_result']}")
    lines.extend(["", "## 计划调整建议", ""])
    suggestions = plan["adjustment_suggestions"]
    if suggestions:
        lines.extend(f"- {suggestion}" for suggestion in suggestions)
    else:
        lines.append("- 当前没有明显调整建议。")
    markdown = "\n".join(lines).strip() + "\n"
    return {"plan_id": plan_id, "title": plan["title"], "markdown": markdown}


def active_plan_summary(space_id: str) -> dict:
    plan = get_current_plan(space_id)
    if not plan:
        return {
            "plan_id": None,
            "total_tasks": 0,
            "done_tasks": 0,
            "progress_percent": 0,
            "overdue_tasks": 0,
        }
    summary = plan["summary"]
    return {
        "plan_id": plan["id"],
        "total_tasks": summary["total_tasks"],
        "done_tasks": summary["done_tasks"],
        "progress_percent": summary["progress_percent"],
        "overdue_tasks": summary["overdue_tasks"],
    }


def active_plan_summaries(space_ids: list[str]) -> dict[str, dict]:
    if not space_ids:
        return {}
    placeholders = ", ".join("?" for _ in space_ids)
    with get_db() as conn:
        plan_rows = conn.execute(
            f"""
            SELECT *
            FROM plans
            WHERE status = 'active' AND space_id IN ({placeholders})
            ORDER BY updated_at DESC
            """,
            tuple(space_ids),
        ).fetchall()
        plans_by_space: dict[str, dict] = {}
        for row in plan_rows:
            plan = dict(row)
            plans_by_space.setdefault(plan["space_id"], plan)
        plan_ids = [plan["id"] for plan in plans_by_space.values()]
        task_rows = []
        if plan_ids:
            task_placeholders = ", ".join("?" for _ in plan_ids)
            task_rows = conn.execute(
                f"""
                SELECT plan_id, status, due_date
                FROM plan_tasks
                WHERE plan_id IN ({task_placeholders})
                """,
                tuple(plan_ids),
            ).fetchall()
    today = date.today()
    tasks_by_plan: dict[str, list[dict]] = {}
    for row in task_rows:
        tasks_by_plan.setdefault(row["plan_id"], []).append(dict(row))
    summaries: dict[str, dict] = {}
    for space_id in space_ids:
        plan = plans_by_space.get(space_id)
        if not plan:
            summaries[space_id] = {
                "plan_id": None,
                "total_tasks": 0,
                "done_tasks": 0,
                "progress_percent": 0,
                "overdue_tasks": 0,
            }
            continue
        tasks = tasks_by_plan.get(plan["id"], [])
        summaries[space_id] = _summary_from_tasks(plan["id"], tasks, today)
    return summaries


def _plan_response(row: dict) -> dict:
    tasks = _list_tasks(row["space_id"], row["id"])
    return {
        "id": row["id"],
        "space_id": row["space_id"],
        "title": row["title"],
        "goal": row["goal"],
        "status": row["status"],
        "cadence": row.get("cadence") or "",
        "target_level": row.get("target_level") or "",
        "deadline": row.get("deadline"),
        "assumptions": json.loads(row.get("assumptions_json") or "{}"),
        "rationale": row.get("rationale") or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "tasks": tasks,
        "summary": _plan_summary(row["id"], tasks),
        "adjustment_suggestions": _adjustment_suggestions(row, tasks),
    }


def _list_tasks(space_id: str, plan_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM plan_tasks
            WHERE space_id = ? AND plan_id = ?
            ORDER BY order_index ASC, created_at ASC
            """,
            (space_id, plan_id),
        ).fetchall()
    return [_task_response(dict(row)) for row in rows]


def _task_response(row: dict) -> dict:
    return {
        "id": row["id"],
        "space_id": row["space_id"],
        "plan_id": row["plan_id"],
        "title": row["title"],
        "description": row.get("description") or "",
        "task_type": row.get("task_type") or "study",
        "status": row.get("status") or "todo",
        "priority": row.get("priority") or "medium",
        "due_date": row.get("due_date"),
        "source_ids": json.loads(row.get("source_ids_json") or "[]"),
        "review_prompt": row.get("review_prompt") or "",
        "recommended_reason": row.get("recommended_reason") or "",
        "order_index": int(row.get("order_index") or 0),
        "completed_at": row.get("completed_at"),
        "last_review_message_id": row.get("last_review_message_id"),
        "review_result": row.get("review_result") or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _plan_summary(plan_id: str, tasks: list[dict]) -> dict:
    return _summary_from_tasks(plan_id, tasks, date.today())


def _summary_from_tasks(plan_id: str, tasks: list[dict], today: date) -> dict:
    total = len(tasks)
    done = sum(1 for task in tasks if task["status"] == "done")
    review_total = sum(1 for task in tasks if task.get("task_type") == "review")
    review_done = sum(
        1
        for task in tasks
        if task.get("task_type") == "review" and task.get("status") == "done"
    )
    overdue = 0
    for task in tasks:
        if task.get("status") == "done" or not task.get("due_date"):
            continue
        parsed = _parse_date(task["due_date"])
        if parsed and parsed < today:
            overdue += 1
    progress = round((done / total) * 100) if total else 0
    last_completed = max(
        [task["completed_at"] for task in tasks if task.get("completed_at")],
        default=None,
    )
    return {
        "plan_id": plan_id,
        "total_tasks": total,
        "done_tasks": done,
        "active_tasks": sum(1 for task in tasks if task["status"] in {"todo", "in_progress"}),
        "review_tasks": review_total,
        "review_done_tasks": review_done,
        "overdue_tasks": overdue,
        "progress_percent": progress,
        "last_completed_at": last_completed,
    }


def _adjustment_suggestions(plan_row: dict, tasks: list[dict]) -> list[str]:
    summary = _plan_summary(plan_row["id"], tasks)
    suggestions: list[str] = []
    if not tasks:
        return ["先添加 1-3 个可执行任务，避免计划停留在目标描述。"]
    if summary["overdue_tasks"] >= 2:
        suggestions.append("已有多个延期任务，建议缩小本周范围，只保留一个高优先级学习任务和一个复习任务。")
    elif summary["overdue_tasks"] == 1:
        suggestions.append("有 1 个任务已延期，可以降低优先级或拆成更小的 25 分钟任务。")
    if summary["done_tasks"] == 0 and summary["total_tasks"] >= 3:
        suggestions.append("计划尚未产生完成记录，建议先完成最短的复习问答任务，形成第一次反馈。")
    if summary["review_tasks"] and summary["review_done_tasks"] == 0:
        suggestions.append("复习任务还没有记录结果，建议从计划页进入学习问答并回写掌握情况。")
    if summary["progress_percent"] >= 80 and summary["total_tasks"] > 0:
        suggestions.append("当前计划接近完成，可以生成下一轮资料整理或阶段报告。")
    return suggestions[:4]


def _generated_tasks(
    *,
    goal: str,
    ready_sources: list[dict],
    notes: list[dict],
    weakness_memories: list[dict],
    deadline: str | None,
) -> list[dict]:
    start = date.today()
    due_dates = _due_dates(start, deadline, 6)
    tasks: list[dict] = [
        {
            "title": "校准学习目标与验收标准",
            "description": f"用 3-5 句话写清楚：完成这个计划后，你希望能做到什么。当前目标：{goal}",
            "task_type": "study",
            "priority": "high",
            "due_date": due_dates[0],
            "recommended_reason": "AI 生成计划前需要先确认目标、节奏和目标水平这些关键假设。",
        }
    ]
    if ready_sources:
        for index, source in enumerate(ready_sources[:3], start=1):
            tasks.append(
                {
                    "title": f"精读资料：{source['title']}",
                    "description": "阅读资料并标记不理解的概念、例子和可复习段落。",
                    "task_type": "study",
                    "priority": "high" if index == 1 else "medium",
                    "due_date": due_dates[min(index, len(due_dates) - 1)],
                    "source_ids": [source["id"]],
                    "recommended_reason": "基于当前空间已索引资料生成，优先把资料转化为可问答上下文。",
                }
            )
        review_topic = ready_sources[0]["title"]
        tasks.append(
            {
                "title": f"复习问答：解释《{review_topic}》的核心概念",
                "description": "从计划页进入学习问答，要求 LearnFast 基于资料追问你核心概念和薄弱点。",
                "task_type": "review",
                "priority": "high",
                "due_date": due_dates[min(len(ready_sources) + 1, len(due_dates) - 1)],
                "source_ids": [source["id"] for source in ready_sources[:3]],
                "review_prompt": f"请基于《{review_topic}》和当前空间资料，围绕“{goal}”设计一轮复习问答。先问我 3 个诊断问题，再根据回答指出薄弱点。",
                "recommended_reason": "复习项来自已就绪资料，推荐原因：计划节点到期前需要确认是否能主动回忆。",
            }
        )
    else:
        tasks.extend(
            [
                {
                    "title": "补充第一批学习资料或碎片笔记",
                    "description": "上传资料、导入网页，或先写一条碎片笔记，给后续问答和复习提供依据。",
                    "task_type": "note",
                    "priority": "high",
                    "due_date": due_dates[1],
                    "recommended_reason": "当前空间还没有可引用资料，先补上下文才能形成可靠复习。",
                },
                {
                    "title": "首轮诊断复习问答",
                    "description": "在没有资料时先围绕目标自测，记录自己已经知道和还不确定的部分。",
                    "task_type": "review",
                    "priority": "medium",
                    "due_date": due_dates[2],
                    "review_prompt": f"我正在学习：{goal}。请不要编造资料结论，先问我 5 个诊断问题，帮助我拆出需要补资料和复习的主题。",
                    "recommended_reason": "没有资料时仍可通过目标澄清启动初始计划，复习结果会回写计划进度。",
                },
            ]
        )
    if notes:
        tasks.append(
            {
                "title": "整理最近笔记为复习提纲",
                "description": f"选择最近的笔记《{notes[0]['title']}》，整理成 5 个可复述的问题。",
                "task_type": "note",
                "priority": "medium",
                "due_date": due_dates[-2],
                "recommended_reason": "已有笔记可以转化为复习问题，避免笔记只沉淀不回看。",
            }
        )
    if weakness_memories:
        weakness = weakness_memories[0]["content"]
        tasks.append(
            {
                "title": "专项复习薄弱点",
                "description": weakness,
                "task_type": "review",
                "priority": "high",
                "due_date": due_dates[-1],
                "review_prompt": f"请围绕这个薄弱点进行复习问答：{weakness}。先让我解释，再指出遗漏和下一步练习。",
                "recommended_reason": "推荐原因：长期记忆中记录了薄弱点，需要主动复查。",
            }
        )
    tasks.append(
        {
            "title": "完成一次学习复盘",
            "description": "记录本轮完成事项、未完成原因、下一步计划调整。",
            "task_type": "practice",
            "priority": "medium",
            "due_date": due_dates[-1],
            "recommended_reason": "复盘让资料、问答、笔记和计划形成可追踪闭环。",
        }
    )
    return tasks[:8]


def _starter_tasks(goal: str) -> list[dict]:
    today = date.today()
    return [
        {
            "title": "明确学习计划的第一步",
            "description": f"围绕目标“{goal}”写下本周最小可完成行动。",
            "task_type": "study",
            "priority": "high",
            "due_date": (today + timedelta(days=1)).isoformat(),
            "recommended_reason": "手动计划需要先落到一个具体行动。",
        }
    ]


def _insert_task_seeds(conn, space_id: str, plan_id: str, seeds: list[dict], now: str) -> None:
    for index, seed in enumerate(seeds):
        task = _normalize_task_seed(seed, order_index=index)
        _insert_task(conn, space_id, plan_id, str(uuid4()), task, now)


def _insert_task(conn, space_id: str, plan_id: str, task_id: str, task: dict, now: str) -> None:
    source_ids = _validate_source_ids(space_id, task.get("source_ids") or [])
    conn.execute(
        """
        INSERT INTO plan_tasks (
            id, space_id, plan_id, title, description, task_type, status,
            priority, due_date, source_ids_json, review_prompt,
            recommended_reason, order_index, completed_at,
            last_review_message_id, review_result, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', ?, ?)
        """,
        (
            task_id,
            space_id,
            plan_id,
            task["title"],
            task["description"],
            task["task_type"],
            task["status"],
            task["priority"],
            task["due_date"],
            json.dumps(source_ids, ensure_ascii=False),
            task["review_prompt"],
            task["recommended_reason"],
            task["order_index"],
            now,
            now,
        ),
    )


def _normalize_task_seed(seed: dict, *, order_index: int) -> dict:
    task_type = seed.get("task_type") or "study"
    status = seed.get("status") or "todo"
    priority = seed.get("priority") or "medium"
    _validate_choice(task_type, VALID_TASK_TYPES, "Invalid task type.")
    _validate_choice(status, VALID_TASK_STATUSES, "Invalid task status.")
    _validate_choice(priority, VALID_PRIORITIES, "Invalid task priority.")
    due_date = seed.get("due_date")
    _validate_date(due_date, "due_date")
    return {
        "title": _required_compact(seed.get("title") or "", "Task title", 180),
        "description": _compact(seed.get("description") or "", 1200),
        "task_type": task_type,
        "status": status,
        "priority": priority,
        "due_date": due_date,
        "source_ids": seed.get("source_ids") or [],
        "review_prompt": _compact(seed.get("review_prompt") or "", 1200),
        "recommended_reason": _compact(seed.get("recommended_reason") or "", 500),
        "order_index": max(
            0,
            int(seed["order_index"] if seed.get("order_index") is not None else order_index),
        ),
    }


def _get_task(space_id: str, plan_id: str, task_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM plan_tasks
            WHERE id = ? AND plan_id = ? AND space_id = ?
            """,
            (task_id, plan_id, space_id),
        ).fetchone()
    task = row_to_dict(row)
    if not task:
        raise not_found("Plan task not found.")
    return _task_response(task)


def _next_order_index(plan_id: str) -> int:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order
            FROM plan_tasks
            WHERE plan_id = ?
            """,
            (plan_id,),
        ).fetchone()
    return int(row["next_order"] or 0)


def _insert_event(
    conn,
    *,
    space_id: str,
    plan_id: str,
    task_id: str,
    event_type: str,
    note: str,
    metadata: dict,
    created_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO plan_task_events (
            id, space_id, plan_id, task_id, event_type, note,
            metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid4()),
            space_id,
            plan_id,
            task_id,
            event_type,
            _compact(note, 1600),
            json.dumps(metadata, ensure_ascii=False),
            created_at,
        ),
    )


def _touch_plan_and_space(conn, space_id: str, plan_id: str, now: str) -> None:
    conn.execute("UPDATE plans SET updated_at = ? WHERE id = ? AND space_id = ?", (now, plan_id, space_id))
    _touch_space(conn, space_id, now)


def _touch_space(conn, space_id: str, now: str) -> None:
    conn.execute("UPDATE spaces SET updated_at = ? WHERE id = ?", (now, space_id))


def _remember_task_progress(space_id: str, task: dict, state: str, note: str) -> None:
    content = f"{state}：{task['title']}"
    if note:
        content = f"{content}。记录：{_compact(note, 180)}"
    create_memory(
        space_id=space_id,
        layer="plan_progress",
        content=content,
        source_type="plan",
        source_id=task["id"],
        source_title=task["title"],
        source_excerpt=note or task.get("description") or "",
        priority=1,
    )


def _validate_assistant_message(space_id: str, message_id: str) -> None:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT role
            FROM chat_messages
            WHERE id = ? AND space_id = ?
            """,
            (message_id, space_id),
        ).fetchone()
    if not row:
        raise not_found("Review chat message not found.")
    if row["role"] != "assistant":
        raise bad_request("Review result must reference an assistant answer.")


def _validate_source_ids(space_id: str, source_ids: list[str]) -> list[str]:
    deduped: list[str] = []
    for source_id in source_ids:
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
    if len(found) != len(deduped):
        raise bad_request("Selected source does not belong to this learning space.")
    return deduped


def _space(space_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM spaces WHERE id = ?", (space_id,)).fetchone()
    space = row_to_dict(row)
    if not space:
        raise not_found("Learning space not found.")
    return space


def _ready_sources(space_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, title, chunk_count, updated_at
            FROM sources
            WHERE space_id = ? AND status = 'ready' AND enabled = 1
            ORDER BY updated_at DESC
            LIMIT 8
            """,
            (space_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def _recent_notes(space_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, title, status, updated_at
            FROM notes
            WHERE space_id = ?
            ORDER BY updated_at DESC
            LIMIT 5
            """,
            (space_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def _plan_title(goal: str) -> str:
    compact = _compact(goal, 34)
    return f"学习计划：{compact}" if compact else "学习计划"


def _plan_rationale(
    ready_sources: list[dict],
    notes: list[dict],
    weakness_memories: list[dict],
) -> str:
    parts = []
    if ready_sources:
        parts.append(f"基于 {len(ready_sources)} 个已就绪资料安排精读与复习问答。")
    else:
        parts.append("当前没有已就绪资料，因此先安排目标澄清和资料补充。")
    if notes:
        parts.append(f"结合 {len(notes)} 条近期笔记，把笔记转化为复习提纲。")
    if weakness_memories:
        parts.append("长期记忆中存在薄弱点记录，因此加入专项复习。")
    return " ".join(parts)


def _due_dates(start: date, deadline: str | None, count: int) -> list[str]:
    if count <= 0:
        return []
    end = _parse_date(deadline) if deadline else None
    if end and end > start:
        span = max(1, (end - start).days)
        return [
            (start + timedelta(days=min(span, round((index + 1) * span / count)))).isoformat()
            for index in range(count)
        ]
    return [(start + timedelta(days=index + 1)).isoformat() for index in range(count)]


def _validate_choice(value: str, allowed: set[str], message: str) -> None:
    if value not in allowed:
        raise bad_request(message)


def _validate_date(value: str | None, field_name: str) -> None:
    if value in (None, ""):
        return
    if _parse_date(value) is None:
        raise bad_request(f"{field_name} must be an ISO date like 2026-07-09.")


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _required_compact(value: str, label: str, limit: int) -> str:
    compact = _compact(value, limit)
    if not compact:
        raise bad_request(f"{label} cannot be empty.")
    return compact


def _compact(value: object, limit: int = 200) -> str:
    text = " ".join(str(value or "").strip().split())
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _task_type_label(task_type: str) -> str:
    return {
        "study": "学习",
        "review": "复习",
        "practice": "练习",
        "note": "笔记",
    }.get(task_type, task_type)
