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
    return {
        "status": "ok",
        "version": __version__,
        "data_dir": str(data_dir()),
        "database_path": str(database_path()),
        "database_ready": database_path().exists(),
        "counts": {
            "spaces": space_count,
            "sources": source_count,
        },
    }
