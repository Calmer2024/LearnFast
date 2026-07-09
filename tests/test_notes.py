from __future__ import annotations

import os
import sys
import tempfile
import asyncio
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["LEARNFAST_DATA_DIR"] = tmp

        from learnfast.api.routes.chat import (
            NoteCreateIn,
            NoteUpdateIn,
            create_note,
            delete_note,
            get_note,
            list_notes,
            update_note,
            upload_note_files,
        )
        from fastapi import UploadFile
        from learnfast.infrastructure.database import get_db, init_db, utc_now
        from learnfast.services.indexer import search_chunks

        init_db()
        now = utc_now()
        space_id = "space-notes-test"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'Notes Test', '', 'active', ?, ?)
                """,
                (space_id, now, now),
            )

        note = create_note(
            space_id,
            NoteCreateIn(
                title="Pandas Merge Notes",
                markdown="# Pandas Merge\n\nMerge joins tables by key columns. Concat stacks frames.",
                tags=["Pandas", "Join", "Pandas"],
                status="saved",
            ),
        )
        assert note["tags"] == ["Pandas", "Join"]
        assert note["chunk_count"] > 0

        listed = list_notes(space_id)
        assert listed[0]["id"] == note["id"]
        assert list_notes(space_id, q="merge")[0]["id"] == note["id"]
        assert list_notes(space_id, tag="Pandas")[0]["id"] == note["id"]

        note_results = search_chunks(space_id, "merge concat key columns")
        assert any(result.source_type == "note" and result.source_id == note["id"] for result in note_results)

        uploaded_notes = asyncio.run(
            upload_note_files(
                space_id,
                [
                    UploadFile(
                        filename="lecture.md",
                        file=BytesIO(
                            "# Lecture Notes\n\nGradient descent updates parameters with the loss gradient.".encode(
                                "utf-8"
                            )
                        ),
                    )
                ],
            )
        )
        assert len(uploaded_notes) == 1
        assert uploaded_notes[0]["title"] == "lecture"
        assert uploaded_notes[0]["source_type"] == "upload"
        upload_results = search_chunks(space_id, "gradient descent loss gradient")
        assert any(
            result.source_type == "note" and result.source_id == uploaded_notes[0]["id"]
            for result in upload_results
        )

        updated = update_note(
            space_id,
            note["id"],
            NoteUpdateIn(
                markdown="# Pandas GroupBy\n\nGroupBy splits data into groups before aggregation.",
                tags=["Pandas", "Aggregation"],
                status="draft",
            ),
        )
        assert updated["status"] == "draft"
        assert updated["tags"] == ["Pandas", "Aggregation"]
        assert "GroupBy" in get_note(space_id, note["id"])["markdown"]

        fragment = create_note(
            space_id,
            NoteCreateIn(
                markdown="I always confuse merge and concat.",
                tags=["碎片"],
                status="fragment",
            ),
        )
        assert fragment["status"] == "fragment"
        assert fragment["title"].startswith("碎片笔记")

        deleted = delete_note(space_id, note["id"], delete_associated_memories=True)
        assert deleted["deleted"] is True
        with get_db() as conn:
            remaining_chunks = conn.execute(
                "SELECT COUNT(*) AS count FROM note_chunks WHERE note_id = ?",
                (note["id"],),
            ).fetchone()["count"]
        assert remaining_chunks == 0

    print("PASS notes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
