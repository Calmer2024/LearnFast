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

        from learnfast.api.routes.chat import NoteCreateIn, create_note
        from learnfast.api.routes.exports import get_note_export, get_space_export
        from learnfast.api.routes.search import search_space
        from learnfast.infrastructure.database import get_db, init_db, utc_now
        from learnfast.services.indexer import index_source_markdown
        from learnfast.services.memory_service import create_memory
        from learnfast.services.plans import create_plan

        init_db()
        now = utc_now()
        space_id = "space-search-export-test"
        source_id = "source-search-export"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'Search Export Test', '掌握 Pandas 清洗闭环', 'active', ?, ?)
                """,
                (space_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO sources (
                    id, space_id, type, title, origin, status, enabled,
                    created_at, updated_at
                )
                VALUES (?, ?, 'md', 'Pandas Cleaning Notes', 'pandas-cleaning.md', 'indexing', 1, ?, ?)
                """,
                (source_id, space_id, now, now),
            )

        source_index = index_source_markdown(
            space_id,
            {"id": source_id},
            """
# Pandas Cleaning Notes

dropna and fillna handle missing values. merge combines rows by key columns.
""",
        )
        with get_db() as conn:
            conn.execute(
                """
                UPDATE sources
                SET status = 'ready', version_id = ?, chunk_count = ?, indexed_at = ?
                WHERE id = ?
                """,
                (source_index.version_id, source_index.chunk_count, source_index.indexed_at, source_id),
            )

        note = create_note(
            space_id,
            NoteCreateIn(
                title="Merge 与 Concat 笔记",
                markdown="# Merge 与 Concat\n\nmerge 按键连接，concat 按轴拼接。",
                tags=["Pandas", "Join"],
                status="saved",
            ),
        )
        create_memory(
            space_id=space_id,
            layer="learning_ability",
            content="用户需要重点复习 merge 与 concat 的差异。",
            source_type="source",
            source_id=source_id,
            source_title="Pandas Cleaning Notes",
            priority=2,
        )
        plan = create_plan(
            space_id=space_id,
            title="Pandas 复习计划",
            goal="掌握 Pandas 清洗和连接操作",
            tasks=[
                {
                    "title": "练习 merge 与 concat 区分",
                    "description": "用两个小表解释 merge 和 concat 的区别。",
                    "task_type": "practice",
                    "priority": "high",
                    "source_ids": [source_id],
                }
            ],
        )

        source_search = search_space(space_id, q="Pandas Cleaning", limit=20)
        source_types = {result["result_type"] for result in source_search["results"]}
        assert "source_title" in source_types
        assert "source_chunk" in source_types

        unified = search_space(space_id, q="merge concat", limit=30)
        result_types = {result["result_type"] for result in unified["results"]}
        assert result_types >= {"note", "note_chunk", "memory", "plan_task"}
        assert all(result["source_title"] for result in unified["results"])

        scoped = search_space(space_id, q="merge", limit=30, source_id=[source_id])
        scoped_types = {result["result_type"] for result in scoped["results"]}
        assert "plan_task" in scoped_types
        assert "memory" in scoped_types
        assert "note" not in scoped_types
        assert "note_chunk" not in scoped_types

        note_export = get_note_export(space_id, note["id"])
        assert note_export["title"] == "Merge 与 Concat 笔记"
        assert "merge 按键连接" in note_export["markdown"]

        space_export = get_space_export(space_id)
        markdown = space_export["markdown"]
        assert "Pandas Cleaning Notes" in markdown
        assert "Merge 与 Concat 笔记" in markdown
        assert "Pandas 复习计划" in markdown
        assert plan["tasks"][0]["title"] in markdown
        assert "模型密钥" in markdown
        forbidden = ["secret_ref", "api_key", "model_configs", "raw_path", "markdown_path"]
        assert not any(token in markdown for token in forbidden)

    print("PASS search exports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
