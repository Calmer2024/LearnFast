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

        from learnfast.api.routes.system_logs import list_system_logs
        from learnfast.infrastructure.database import get_db, init_db, utc_now
        from learnfast.services.system_logs import log_event

        init_db()
        now = utc_now()
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES ('space-console', 'Console Test', '', 'active', ?, ?)
                """,
                (now, now),
            )

        log_event("model", "Global model log", details={"provider_id": "deepseek_chat"})
        log_event(
            "source",
            "Source pipeline log",
            space_id="space-console",
            details={"chunk_count": 3},
        )

        rows = list_system_logs(space_id="space-console", after_id=None, limit=120)
        assert len(rows) == 2
        assert rows[0]["message"] == "Global model log"
        assert rows[1]["message"] == "Source pipeline log"
        assert rows[1]["details"]["chunk_count"] == 3

        after_rows = list_system_logs(space_id="space-console", after_id=rows[0]["id"], limit=120)
        assert len(after_rows) == 1
        assert after_rows[0]["message"] == "Source pipeline log"

    print("PASS system console")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
