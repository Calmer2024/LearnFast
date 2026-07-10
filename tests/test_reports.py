from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["LEARNFAST_DATA_DIR"] = tmp

        from learnfast.api.routes.chat import NoteCreateIn, create_note
        from learnfast.api.routes.reports import (
            ReportGenerateIn,
            ReportSaveNoteIn,
            get_report_export,
            get_reports,
            post_generate_report,
            post_save_report_note,
            read_report,
        )
        from learnfast.infrastructure.database import get_db, init_db, utc_now
        from learnfast.services.plans import complete_task, create_plan
        from learnfast.services.indexer import search_chunks

        init_db()
        now = utc_now()
        empty_space_id = "space-report-empty"
        space_id = "space-report-test"
        source_id = "source-report-pandas"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'Empty Report Space', '', 'active', ?, ?)
                """,
                (empty_space_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'Report Test', '掌握 Pandas 数据清洗', 'active', ?, ?)
                """,
                (space_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO sources (
                    id, space_id, type, title, origin, status, enabled,
                    chunk_count, created_at, updated_at
                )
                VALUES (?, ?, 'md', 'Pandas Cleaning Notes', 'pandas.md', 'ready', 1, 3, ?, ?)
                """,
                (source_id, space_id, now, now),
            )

        try:
            post_generate_report(empty_space_id, ReportGenerateIn())
        except HTTPException as exc:
            assert exc.status_code == 400
            assert "学习证据" in exc.detail
        else:
            raise AssertionError("empty report generation should fail")

        plan = create_plan(
            space_id=space_id,
            title="Pandas 清洗计划",
            goal="掌握缺失值、重复值和 merge 的基础用法",
            tasks=[
                {
                    "title": "完成缺失值处理复习",
                    "description": "复习 dropna、fillna 和类型转换。",
                    "task_type": "review",
                    "priority": "high",
                    "source_ids": [source_id],
                },
                {
                    "title": "练习 merge 与 concat 区分",
                    "description": "用两个小表解释 merge 和 concat 的区别。",
                    "task_type": "practice",
                    "priority": "high",
                    "source_ids": [source_id],
                    "recommended_reason": "复习记录显示 merge 还需要练习。",
                },
            ],
        )
        first_task = plan["tasks"][0]
        complete_task(
            space_id,
            plan["id"],
            first_task["id"],
            review_result="已完成缺失值处理复习；merge 与 concat 还需要练习。",
        )
        note = create_note(
            space_id,
            NoteCreateIn(
                title="Pandas 清洗笔记",
                markdown="# Pandas 清洗\n\n缺失值处理包括 dropna、fillna 和类型转换。",
                tags=["Pandas"],
                status="saved",
            ),
        )
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, space_id, role, content, parent_message_id,
                    context_snapshot_json, created_at
                )
                VALUES ('report-user', ?, 'user', 'Pandas 缺失值怎么处理？', NULL, '{}', ?)
                """,
                (space_id, now),
            )
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, space_id, role, content, parent_message_id,
                    context_snapshot_json, created_at
                )
                VALUES (
                    'report-assistant', ?, 'assistant',
                    'Pandas 缺失值处理通常包括删除、填充和类型校验。',
                    'report-user', '{}', ?
                )
                """,
                (space_id, now),
            )
            conn.execute(
                """
                INSERT INTO citations (
                    id, space_id, message_id, chunk_id, source_type, source_id,
                    source_title, version_id, ordinal, heading_path_json, locator,
                    quote_snapshot, score, created_at
                )
                VALUES (
                    'report-citation', ?, 'report-assistant', 'chunk-report', 'source', ?,
                    'Pandas Cleaning Notes', 'v1', 0, '["Pandas 清洗"]', 'L1-L4',
                    '缺失值处理包括 dropna、fillna 和类型转换。', 0.92, ?
                )
                """,
                (space_id, source_id, now),
            )

        report = post_generate_report(
            space_id,
            ReportGenerateIn(source_ids=[source_id]),
        )
        assert report["title"].startswith("学习报告")
        assert report["source_ids"] == [source_id]
        assert report["metadata"]["evidence_count"] >= 4
        assert "## 完成事项" in report["markdown"]
        assert "## 未完成事项" in report["markdown"]
        assert "## 主要知识点" in report["markdown"]
        assert "## 薄弱点" in report["markdown"]
        assert "## 下一步建议" in report["markdown"]
        assert "证据：[E" in report["markdown"]
        assert "merge 与 concat" in report["markdown"]

        listed = get_reports(space_id)
        assert listed[0]["id"] == report["id"]
        assert "markdown" not in listed[0]
        assert read_report(space_id, report["id"])["markdown"] == report["markdown"]
        export = get_report_export(space_id, report["id"])
        assert export["markdown"] == report["markdown"]

        saved = post_save_report_note(
            space_id,
            report["id"],
            ReportSaveNoteIn(title="阶段复盘：Pandas 清洗"),
        )
        assert saved["report"]["status"] == "saved_note"
        assert saved["report"]["saved_note_id"] == saved["note"]["id"]
        assert saved["note"]["source_type"] == "report"
        assert saved["note"]["chunk_count"] > 0
        assert "报告" in saved["note"]["tags"]
        search_results = search_chunks(space_id, "阶段复盘 缺失值 薄弱点 merge")
        assert any(result.source_type == "note" and result.source_id == saved["note"]["id"] for result in search_results)
        assert note["id"] != saved["note"]["id"]

    print("PASS reports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
