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

        from learnfast.api.routes.chat import NoteCreateIn, create_note, delete_note
        from learnfast.api.routes.memories import (
            MemoryCandidateConfirmIn,
            MemoryCandidateUpdateIn,
            MemoryCreateIn,
            MemorySettingsIn,
            confirm_candidate,
            delete_memory_item,
            get_memories,
            get_memory_candidates,
            get_memory_layers,
            ignore_candidate,
            patch_memory_candidate,
            patch_memory_settings,
            post_memory,
            read_memory_settings,
        )
        from learnfast.infrastructure.database import get_db, init_db, utc_now
        from learnfast.services.memory_service import (
            active_memory_context,
            extract_memory_candidates_from_chat,
        )

        init_db()
        now = utc_now()
        space_id = "space-memory-test"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'Memory Test', 'Learn Pandas', 'active', ?, ?)
                """,
                (space_id, now, now),
            )

        layers = get_memory_layers()
        assert len(layers) == 7
        assert {layer["id"] for layer in layers} >= {"user_note", "learning_ability"}

        settings = read_memory_settings(space_id)
        assert settings["auto_extract_enabled"] is True

        note = create_note(
            space_id,
            NoteCreateIn(
                title="Merge Confusion",
                markdown="我总是混淆 merge 和 concat，需要更多例题。",
                tags=["Pandas"],
                status="fragment",
            ),
        )
        candidates = get_memory_candidates(space_id)
        assert any(candidate["source_type"] == "note" for candidate in candidates)
        weakness = next(
            candidate
            for candidate in candidates
            if candidate["layer"] == "learning_ability"
        )
        assert weakness["impact"] == "high"
        assert weakness["status"] == "pending"

        rewritten = patch_memory_candidate(
            space_id,
            weakness["id"],
            MemoryCandidateUpdateIn(
                content="用户需要重点复习 Pandas merge 与 concat 的差异。",
                impact="high",
            ),
        )
        assert "merge 与 concat" in rewritten["content"]

        memory = confirm_candidate(
            space_id,
            weakness["id"],
            MemoryCandidateConfirmIn(),
        )
        assert memory["status"] == "active"
        assert memory["layer"] == "learning_ability"
        assert active_memory_context(space_id)[0]["id"] == memory["id"]

        deleted = delete_memory_item(space_id, memory["id"])
        assert deleted["deleted"] is True
        assert all(item["id"] != memory["id"] for item in active_memory_context(space_id))

        manual = post_memory(
            space_id,
            MemoryCreateIn(
                layer="space_profile",
                content="当前空间目标是两周内复习 Pandas 数据清洗。",
                source_type="manual",
                priority=1,
            ),
        )
        assert manual["source_type"] == "manual"
        assert get_memories(space_id)[0]["id"] == manual["id"]

        extra_note = create_note(
            space_id,
            NoteCreateIn(
                title="Preference",
                markdown="希望你以后回答时先给直觉解释，再给代码例子。",
                status="saved",
            ),
        )
        preference = next(
            candidate
            for candidate in get_memory_candidates(space_id)
            if candidate["source_id"] == extra_note["id"] and candidate["layer"] == "preference"
        )
        ignored = ignore_candidate(space_id, preference["id"])
        assert ignored["status"] == "ignored"

        before_count = len(get_memory_candidates(space_id, status="all"))
        updated_settings = patch_memory_settings(
            space_id,
            MemorySettingsIn(auto_extract_enabled=False),
        )
        assert updated_settings["auto_extract_enabled"] is False
        create_note(
            space_id,
            NoteCreateIn(
                title="No Extract",
                markdown="我总是混淆 groupby 和 pivot_table。",
                status="fragment",
            ),
        )
        assert len(get_memory_candidates(space_id, status="all")) == before_count

        patch_memory_settings(space_id, MemorySettingsIn(auto_extract_enabled=True))
        chat_candidates = extract_memory_candidates_from_chat(
            space_id,
            user_message={
                "id": "user-memory-chat",
                "content": "我不懂 SQL join 和 Pandas merge 的对应关系。",
            },
            assistant_message={
                "id": "assistant-memory-chat",
                "content": "可以从 key column 和 join type 对照理解。",
            },
        )
        assert any(candidate["source_type"] == "chat" for candidate in chat_candidates)
        assert any(candidate["layer"] == "learning_ability" for candidate in chat_candidates)

        note_for_deletion = create_note(
            space_id,
            NoteCreateIn(
                title="Delete Memory",
                markdown="我总是混淆 left join 和 inner join。",
                status="fragment",
            ),
        )
        deletion_candidate = next(
            candidate
            for candidate in get_memory_candidates(space_id)
            if candidate["source_id"] == note_for_deletion["id"]
            and candidate["layer"] == "learning_ability"
        )
        deletion_memory = confirm_candidate(
            space_id,
            deletion_candidate["id"],
            MemoryCandidateConfirmIn(),
        )
        assert any(item["id"] == deletion_memory["id"] for item in active_memory_context(space_id))
        delete_note(space_id, note_for_deletion["id"], delete_associated_memories=True)
        assert all(item["id"] != deletion_memory["id"] for item in active_memory_context(space_id))

    print("PASS memories")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
