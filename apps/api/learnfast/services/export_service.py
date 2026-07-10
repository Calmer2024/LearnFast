from __future__ import annotations

import json

from learnfast.core.errors import not_found
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now


def export_note_markdown(space_id: str, note_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT id, title, markdown
            FROM notes
            WHERE id = ? AND space_id = ?
            """,
            (note_id, space_id),
        ).fetchone()
    note = row_to_dict(row)
    if not note:
        raise not_found("Note not found.")
    return {
        "note_id": note_id,
        "title": note["title"],
        "markdown": note["markdown"].strip() + "\n",
    }


def export_space_markdown(space_id: str) -> dict:
    with get_db() as conn:
        space = row_to_dict(conn.execute("SELECT * FROM spaces WHERE id = ?", (space_id,)).fetchone())
        if not space:
            raise not_found("Learning space not found.")
        sources = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, type, title, origin, status, enabled, chunk_count,
                       indexed_at, created_at, updated_at
                FROM sources
                WHERE space_id = ?
                ORDER BY created_at ASC
                """,
                (space_id,),
            ).fetchall()
        ]
        notes = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, title, tags_json, status, source_type, created_at, updated_at
                FROM notes
                WHERE space_id = ?
                ORDER BY updated_at DESC
                """,
                (space_id,),
            ).fetchall()
        ]
        plans = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, title, goal, status, cadence, target_level, deadline,
                       created_at, updated_at
                FROM plans
                WHERE space_id = ?
                ORDER BY updated_at DESC
                """,
                (space_id,),
            ).fetchall()
        ]
        tasks = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, plan_id, title, task_type, status, priority, due_date,
                       completed_at, review_result, order_index, updated_at
                FROM plan_tasks
                WHERE space_id = ?
                ORDER BY plan_id ASC, order_index ASC
                """,
                (space_id,),
            ).fetchall()
        ]
        reports = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, title, range_start, range_end, status, saved_note_id,
                       created_at, updated_at
                FROM reports
                WHERE space_id = ?
                ORDER BY updated_at DESC
                """,
                (space_id,),
            ).fetchall()
        ]
        memories = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, layer, content, source_type, source_title, priority, updated_at
                FROM memories
                WHERE space_id = ? AND status = 'active'
                ORDER BY priority DESC, updated_at DESC
                """,
                (space_id,),
            ).fetchall()
        ]

    task_map: dict[str, list[dict]] = {}
    for task in tasks:
        task_map.setdefault(task["plan_id"], []).append(task)

    lines = [
        f"# LearnFast 空间导出：{space['name']}",
        "",
        f"- 空间 ID：{space['id']}",
        f"- 状态：{space['status']}",
        f"- 学习目标：{space.get('goal') or '未设置'}",
        f"- 创建时间：{space['created_at']}",
        f"- 更新时间：{space['updated_at']}",
        f"- 导出时间：{utc_now()}",
        "- 隐私：本导出不包含模型密钥、模型 provider 配置或本地文件路径。",
        "",
        "## 资料",
        "",
    ]
    if sources:
        for source in sources:
            enabled = "启用" if source["enabled"] else "停用"
            lines.append(
                f"- {source['title']}（{source['type']}，{source['status']}，{enabled}，{source.get('chunk_count') or 0} 个片段）"
            )
            lines.append(f"  - 来源：{source['origin']}")
            if source.get("indexed_at"):
                lines.append(f"  - 索引时间：{source['indexed_at']}")
    else:
        lines.append("- 暂无资料。")

    lines.extend(["", "## 笔记", ""])
    if notes:
        for note in notes:
            tags = json.loads(note.get("tags_json") or "[]")
            tag_text = f"，标签：{', '.join(tags)}" if tags else ""
            source_text = f"，来源：{note['source_type']}" if note.get("source_type") else ""
            lines.append(f"- {note['title']}（{note['status']}{source_text}{tag_text}，更新：{note['updated_at']}）")
    else:
        lines.append("- 暂无笔记。")

    lines.extend(["", "## 计划", ""])
    if plans:
        for plan in plans:
            lines.append(f"### {plan['title']}")
            lines.append(f"- 状态：{plan['status']}")
            lines.append(f"- 目标：{plan['goal']}")
            if plan.get("cadence"):
                lines.append(f"- 节奏：{plan['cadence']}")
            if plan.get("target_level"):
                lines.append(f"- 目标水平：{plan['target_level']}")
            if plan.get("deadline"):
                lines.append(f"- 截止日期：{plan['deadline']}")
            plan_tasks = task_map.get(plan["id"], [])
            if plan_tasks:
                lines.append("")
                for task in plan_tasks:
                    marker = "x" if task["status"] == "done" else " "
                    due = f"，截止 {task['due_date']}" if task.get("due_date") else ""
                    lines.append(f"- [{marker}] {task['title']}（{task['task_type']} / {task['priority']} / {task['status']}{due}）")
                    if task.get("review_result"):
                        lines.append(f"  - 复习结果：{task['review_result']}")
            lines.append("")
    else:
        lines.append("- 暂无计划。")

    lines.extend(["## 报告", ""])
    if reports:
        for report in reports:
            saved = f"，保存笔记：{report['saved_note_id']}" if report.get("saved_note_id") else ""
            lines.append(
                f"- {report['title']}（{report['range_start']} 至 {report['range_end']}，{report['status']}{saved}）"
            )
    else:
        lines.append("- 暂无报告。")

    lines.extend(["", "## 长期记忆", ""])
    if memories:
        for memory in memories:
            source = f"，来源：{memory['source_type']} / {memory['source_title']}" if memory.get("source_title") else f"，来源：{memory['source_type']}"
            lines.append(f"- [{memory['layer']}] {memory['content']}（优先级 {memory['priority']}{source}）")
    else:
        lines.append("- 暂无长期记忆。")

    markdown = "\n".join(lines).strip() + "\n"
    return {
        "space_id": space_id,
        "title": f"LearnFast 空间导出：{space['name']}",
        "markdown": markdown,
        "metadata": {
            "source_count": len(sources),
            "note_count": len(notes),
            "plan_count": len(plans),
            "task_count": len(tasks),
            "report_count": len(reports),
            "memory_count": len(memories),
        },
    }
