from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel, Field

from learnfast.core.errors import bad_request, conflict, not_found
from learnfast.core.limits import MAX_SPACES
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now
from learnfast.infrastructure.storage import data_dir, remove_paths
from learnfast.services.plans import active_plan_summaries, active_plan_summary
from learnfast.services.system_logs import log_event

router = APIRouter(prefix="/spaces", tags=["spaces"])


class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    goal: str = Field(default="", max_length=1000)


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    goal: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, pattern="^(active|archived)$")


def _space_payload(row: dict, counts: dict | None = None) -> dict:
    return {
        **row,
        "counts": counts
        or {
            "sources": 0,
            "notes": 0,
            "plan": {
                "plan_id": None,
                "total_tasks": 0,
                "done_tasks": 0,
                "progress_percent": 0,
                "overdue_tasks": 0,
            },
        },
    }


def require_space(space_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM spaces WHERE id = ?", (space_id,)).fetchone()
    space = row_to_dict(row)
    if not space:
        raise not_found("Learning space not found.")
    return space


@router.get("")
def list_spaces(include_archived: bool = False) -> list[dict]:
    query = "SELECT * FROM spaces"
    params: tuple = ()
    if not include_archived:
        query += " WHERE status = ?"
        params = ("active",)
    query += " ORDER BY updated_at DESC"
    with get_db() as conn:
        rows = [dict(row) for row in conn.execute(query, params).fetchall()]
        counts = {
            row["space_id"]: row["count"]
            for row in conn.execute(
                "SELECT space_id, COUNT(*) AS count FROM sources GROUP BY space_id"
            ).fetchall()
        }
        note_counts = {
            row["space_id"]: row["count"]
            for row in conn.execute(
                "SELECT space_id, COUNT(*) AS count FROM notes GROUP BY space_id"
            ).fetchall()
        }
    plan_counts = active_plan_summaries([row["id"] for row in rows])
    return [
        _space_payload(
            row,
            {
                "sources": counts.get(row["id"], 0),
                "notes": note_counts.get(row["id"], 0),
                "plan": plan_counts.get(row["id"])
                or {
                    "plan_id": None,
                    "total_tasks": 0,
                    "done_tasks": 0,
                    "progress_percent": 0,
                    "overdue_tasks": 0,
                },
            },
        )
        for row in rows
    ]


@router.post("")
def create_space(payload: SpaceCreate) -> dict:
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) AS count FROM spaces").fetchone()["count"]
        if count >= MAX_SPACES:
            raise conflict(f"MVP allows at most {MAX_SPACES} learning spaces.")
        now = utc_now()
        space_id = str(uuid4())
        conn.execute(
            """
            INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
            VALUES (?, ?, ?, 'active', ?, ?)
            """,
            (space_id, payload.name.strip(), payload.goal.strip(), now, now),
        )
    log_event(
        "space",
        "学习空间已创建",
        space_id=space_id,
        details={"space_id": space_id, "name": payload.name.strip()},
    )
    return get_space(space_id)


@router.get("/{space_id}")
def get_space(space_id: str) -> dict:
    space = require_space(space_id)
    with get_db() as conn:
        source_count = conn.execute(
            "SELECT COUNT(*) AS count FROM sources WHERE space_id = ?",
            (space_id,),
        ).fetchone()["count"]
        note_count = conn.execute(
            "SELECT COUNT(*) AS count FROM notes WHERE space_id = ?",
            (space_id,),
        ).fetchone()["count"]
    return _space_payload(
        space,
        {
            "sources": source_count,
            "notes": note_count,
            "plan": active_plan_summary(space_id),
        },
    )


@router.patch("/{space_id}")
def update_space(space_id: str, payload: SpaceUpdate) -> dict:
    require_space(space_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise bad_request("No fields to update.")
    fields = []
    params: list[str] = []
    for key, value in values.items():
        if value is not None:
            fields.append(f"{key} = ?")
            params.append(value.strip() if isinstance(value, str) else value)
    fields.append("updated_at = ?")
    params.append(utc_now())
    params.append(space_id)
    with get_db() as conn:
        conn.execute(
            f"UPDATE spaces SET {', '.join(fields)} WHERE id = ?",
            tuple(params),
        )
    log_event(
        "space",
        "学习空间设置已更新",
        space_id=space_id,
        details={"space_id": space_id, "changes": values},
    )
    return get_space(space_id)


@router.delete("/{space_id}")
def delete_space(space_id: str) -> dict:
    space = require_space(space_id)
    root = data_dir()
    with get_db() as conn:
        raw_paths = [
            str(root / "raw" / space_id),
            str(root / "markdown" / space_id),
            str(root / "artifacts" / space_id),
            str(root / "exports" / space_id),
        ]
        conn.execute("DELETE FROM spaces WHERE id = ?", (space_id,))
    log_event(
        "space",
        "学习空间已删除",
        level="warn",
        details={"space_id": space_id, "name": space["name"]},
    )
    remove_paths(raw_paths)
    return {"deleted": True, "id": space_id}
