from fastapi import APIRouter

from learnfast import __version__
from learnfast.infrastructure.database import get_db
from learnfast.infrastructure.storage import data_dir, database_path

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    with get_db() as conn:
        space_count = conn.execute("SELECT COUNT(*) AS count FROM spaces").fetchone()["count"]
        source_count = conn.execute("SELECT COUNT(*) AS count FROM sources").fetchone()["count"]
        note_count = conn.execute("SELECT COUNT(*) AS count FROM notes").fetchone()["count"]
        plan_count = conn.execute("SELECT COUNT(*) AS count FROM plans").fetchone()["count"]
        plan_task_count = conn.execute("SELECT COUNT(*) AS count FROM plan_tasks").fetchone()["count"]
        report_count = conn.execute("SELECT COUNT(*) AS count FROM reports").fetchone()["count"]
    return {
        "status": "ok",
        "version": __version__,
        "data_dir": str(data_dir()),
        "database_path": str(database_path()),
        "database_ready": database_path().exists(),
        "counts": {
            "spaces": space_count,
            "sources": source_count,
            "notes": note_count,
            "plans": plan_count,
            "plan_tasks": plan_task_count,
            "reports": report_count,
        },
    }
