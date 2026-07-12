from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["LEARNFAST_DATA_DIR"] = tmp

        from learnfast.api.routes.plans import (
            PlanGenerateIn,
            PlanTaskIn,
            PlanTaskUpdateIn,
            ReviewResultIn,
            TaskCompleteIn,
            delete_plan_task,
            get_plan_export,
            patch_task,
            post_complete_task,
            post_generate_plan,
            post_review_result,
            post_task,
            read_current_plan,
        )
        from learnfast.api.routes.spaces import get_space
        from learnfast.infrastructure.database import get_db, init_db, utc_now
        from learnfast.services.memory_service import list_memories

        init_db()
        now = utc_now()
        space_id = "space-plan-test"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'Plan Test', 'Learn Pandas data cleaning', 'active', ?, ?)
                """,
                (space_id, now, now),
            )

        initial = post_generate_plan(
            space_id,
            PlanGenerateIn(
                goal="两周内掌握 Pandas 数据清洗",
                deadline="2030-01-15",
            ),
        )
        assert initial["assumptions"]["source_count"] == 0
        assert initial["summary"]["total_tasks"] >= 3
        assert any(task["task_type"] == "review" for task in initial["tasks"])
        assert read_current_plan(space_id)["id"] == initial["id"]

        first_task = initial["tasks"][0]
        edited = patch_task(
            space_id,
            initial["id"],
            first_task["id"],
            PlanTaskUpdateIn(
                title="校准 Pandas 学习目标",
                priority="high",
                due_date="2030-01-02",
            ),
        )
        assert edited["tasks"][0]["title"] == "校准 Pandas 学习目标"

        completed = post_complete_task(
            space_id,
            initial["id"],
            first_task["id"],
            TaskCompleteIn(review_result="已明确本周目标和验收标准。"),
        )
        assert completed["summary"]["done_tasks"] == 1
        assert completed["tasks"][0]["status"] == "done"
        space = get_space(space_id)
        assert space["counts"]["plan"]["progress_percent"] > 0

        manual_task_plan = post_task(
            space_id,
            initial["id"],
            PlanTaskIn(
                title="补充一个手动复习任务",
                task_type="review",
                priority="medium",
                review_prompt="请围绕 Pandas 缺失值处理进行复习问答。",
            ),
        )
        created_task = manual_task_plan["tasks"][-1]
        removed_task_plan = delete_plan_task(space_id, initial["id"], created_task["id"])
        assert all(task["id"] != created_task["id"] for task in removed_task_plan["tasks"])

        export = get_plan_export(space_id, initial["id"])
        assert "## 任务列表" in export["markdown"]
        assert "校准 Pandas 学习目标" in export["markdown"]

        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO sources (
                    id, space_id, type, title, origin, status, enabled,
                    chunk_count, created_at, updated_at
                )
                VALUES (
                    'source-cleaning', ?, 'md', 'Pandas Cleaning Notes',
                    'cleaning.md', 'ready', 1, 4, ?, ?
                )
                """,
                (space_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, space_id, role, content, parent_message_id,
                    context_snapshot_json, created_at
                )
                VALUES (
                    'assistant-review-plan', ?, 'assistant',
                    '复习结果：缺失值处理掌握较好，merge 还需要练习。',
                    NULL, '{}', ?
                )
                """,
                (space_id, now),
            )
            conn.execute(
                """
                INSERT INTO source_chunks (
                    id, space_id, source_id, version_id, ordinal,
                    heading_path_json, locator, text, content_hash, char_count,
                    embedding_provider, embedding_model, embedding_dim,
                    embedding_json, created_at
                ) VALUES (
                    'chunk-cleaning-missing', ?, 'source-cleaning', 'v1', 0,
                    '["缺失值处理与插补策略"]', 'section:missing-values',
                    '比较 dropna、fillna 与统计插补的适用条件。', 'hash-plan-topic', 30,
                    'local', 'hash', 3, '[0,0,0]', ?
                )
                """,
                (space_id, now),
            )

        source_based = post_generate_plan(space_id, PlanGenerateIn())
        assert source_based["id"] != initial["id"]
        assert source_based["assumptions"]["source_count"] == 1
        assert source_based["assumptions"]["generation_mode"] == "adaptive_local_content_v1"
        assert any("缺失值处理与插补策略" in task["title"] for task in source_based["tasks"])
        assert any(task["source_ids"] == ["source-cleaning"] for task in source_based["tasks"])
        review_task = next(task for task in source_based["tasks"] if task["task_type"] == "review")
        reviewed = post_review_result(
            space_id,
            source_based["id"],
            review_task["id"],
            ReviewResultIn(
                result="复习问答已完成：merge 与缺失值处理仍需加强。",
                message_id="assistant-review-plan",
            ),
        )
        refreshed_review = next(task for task in reviewed["tasks"] if task["id"] == review_task["id"])
        assert refreshed_review["status"] == "done"
        assert refreshed_review["last_review_message_id"] == "assistant-review-plan"
        assert "merge" in refreshed_review["review_result"]
        assert list_memories(space_id, layer="plan_progress")

    print("PASS plans")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
