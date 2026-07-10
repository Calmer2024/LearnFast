from __future__ import annotations

from fastapi import APIRouter

from learnfast.api.routes.spaces import require_space
from learnfast.services.export_service import export_note_markdown, export_space_markdown
from learnfast.services.system_logs import log_event

router = APIRouter(tags=["exports"])


@router.get("/spaces/{space_id}/notes/{note_id}/export")
def get_note_export(space_id: str, note_id: str) -> dict:
    require_space(space_id)
    result = export_note_markdown(space_id, note_id)
    log_event(
        "export",
        "笔记已导出为 Markdown",
        space_id=space_id,
        details={"note_id": note_id, "title": result["title"]},
    )
    return result


@router.get("/spaces/{space_id}/export")
def get_space_export(space_id: str) -> dict:
    require_space(space_id)
    result = export_space_markdown(space_id)
    log_event(
        "export",
        "学习空间基础导出已生成",
        space_id=space_id,
        details={"title": result["title"], **result["metadata"]},
    )
    return result
