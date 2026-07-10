from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from learnfast.api.routes.spaces import require_space
from learnfast.services.report_service import (
    export_report_markdown,
    generate_report,
    get_report,
    list_reports,
    save_report_as_note,
)

router = APIRouter(tags=["reports"])


class ReportGenerateIn(BaseModel):
    range_start: str | None = Field(default=None, max_length=10)
    range_end: str | None = Field(default=None, max_length=10)
    source_ids: list[str] = Field(default_factory=list)
    include_notes: bool = True
    include_memories: bool = True
    title: str | None = Field(default=None, max_length=160)


class ReportSaveNoteIn(BaseModel):
    title: str | None = Field(default=None, max_length=160)


@router.get("/spaces/{space_id}/reports")
def get_reports(
    space_id: str,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[dict]:
    require_space(space_id)
    return list_reports(space_id, limit=limit)


@router.post("/spaces/{space_id}/reports/generate")
def post_generate_report(space_id: str, payload: ReportGenerateIn) -> dict:
    require_space(space_id)
    return generate_report(
        space_id=space_id,
        range_start=payload.range_start,
        range_end=payload.range_end,
        source_ids=payload.source_ids,
        include_notes=payload.include_notes,
        include_memories=payload.include_memories,
        title=payload.title,
    )


@router.get("/spaces/{space_id}/reports/{report_id}")
def read_report(space_id: str, report_id: str) -> dict:
    require_space(space_id)
    return get_report(space_id, report_id)


@router.post("/spaces/{space_id}/reports/{report_id}/save-note")
def post_save_report_note(
    space_id: str,
    report_id: str,
    payload: ReportSaveNoteIn | None = None,
) -> dict:
    require_space(space_id)
    payload = payload or ReportSaveNoteIn()
    return save_report_as_note(
        space_id=space_id,
        report_id=report_id,
        title=payload.title,
    )


@router.get("/spaces/{space_id}/reports/{report_id}/export")
def get_report_export(space_id: str, report_id: str) -> dict:
    require_space(space_id)
    return export_report_markdown(space_id, report_id)
