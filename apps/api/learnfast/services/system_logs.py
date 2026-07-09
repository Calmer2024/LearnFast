from __future__ import annotations

import json
from typing import Any

from learnfast.infrastructure.database import get_db, utc_now


def log_event(
    category: str,
    message: str,
    *,
    level: str = "info",
    space_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    safe_details = _safe_details(details or {})
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO system_logs (
                space_id, level, category, message, details_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                space_id,
                _safe_level(level),
                category[:60],
                message[:500],
                json.dumps(safe_details, ensure_ascii=False, default=str),
                utc_now(),
            ),
        )


def log_response(row: dict) -> dict:
    return {
        "id": row["id"],
        "space_id": row.get("space_id"),
        "level": row["level"],
        "category": row["category"],
        "message": row["message"],
        "details": json.loads(row.get("details_json") or "{}"),
        "created_at": row["created_at"],
    }


def _safe_level(level: str) -> str:
    return level if level in {"debug", "info", "warn", "error"} else "info"


def _safe_details(details: dict[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in details.items():
        lowered = key.lower()
        if "key" in lowered or "secret" in lowered or "token" in lowered:
            redacted[key] = "[redacted]"
        elif isinstance(value, str):
            redacted[key] = value[:600]
        else:
            redacted[key] = value
    return redacted
