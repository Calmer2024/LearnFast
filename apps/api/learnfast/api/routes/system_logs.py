from fastapi import APIRouter, Query

from learnfast.api.routes.spaces import require_space
from learnfast.infrastructure.database import get_db
from learnfast.services.system_logs import log_response

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/logs")
def list_system_logs(
    space_id: str | None = Query(default=None),
    after_id: int | None = Query(default=None, ge=0),
    limit: int = Query(default=120, ge=1, le=300),
) -> list[dict]:
    params: list[object] = []
    filters: list[str] = []
    if space_id:
        require_space(space_id)
        filters.append("(space_id IS NULL OR space_id = ?)")
        params.append(space_id)
    if after_id is not None:
        filters.append("id > ?")
        params.append(after_id)

    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    params.append(limit)
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT *
                FROM system_logs
                {where}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        ]
    rows.reverse()
    return [log_response(row) for row in rows]
