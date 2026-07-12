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
        from learnfast.api.routes.preferences import LearningPreferencesIn, put_learning_preferences
        from learnfast.api.routes.sources import (
            FolderIn,
            SourceUpdateIn,
            create_source_folder,
            list_source_folders,
            update_source,
        )
        from learnfast.infrastructure.database import get_db, init_db, utc_now

        init_db()
        now, space_id = utc_now(), "space-organize"
        with get_db() as conn:
            conn.execute(
                "INSERT INTO spaces (id, name, goal, status, created_at, updated_at) VALUES (?, 'Organize', '', 'active', ?, ?)",
                (space_id, now, now),
            )
            conn.execute(
                """INSERT INTO sources (id, space_id, type, title, origin, status, enabled, created_at, updated_at)
                   VALUES ('source-one', ?, 'md', 'One', 'one.md', 'ready', 1, ?, ?)""",
                (space_id, now, now),
            )

        parent = create_source_folder(space_id, FolderIn(name="课程"))
        child = create_source_folder(space_id, FolderIn(name="第一章", parent_id=parent["id"]))
        moved = update_source(space_id, "source-one", SourceUpdateIn(folder_id=child["id"]))
        assert moved["folder_id"] == child["id"]
        assert len(list_source_folders(space_id)) == 2

        preferences = put_learning_preferences(
            space_id,
            LearningPreferencesIn(
                onboarding_completed=True,
                tone="简洁严谨",
                teaching_approach="多用反例",
                learner_level="初学者",
            ),
        )
        assert preferences["onboarding_completed"] is True
        assert preferences["teaching_approach"] == "多用反例"

    print("PASS source folders and preferences")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
