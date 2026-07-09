from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from learnfast.api.routes.spaces import require_space
from learnfast.services.memory_service import (
    confirm_memory_candidate,
    create_memory,
    delete_memory,
    get_memory_settings,
    ignore_memory_candidate,
    list_memories,
    list_memory_candidates,
    list_memory_layers,
    update_memory,
    update_memory_candidate,
    update_memory_settings,
)

router = APIRouter(tags=["memories"])


class MemorySettingsIn(BaseModel):
    auto_extract_enabled: bool


class MemoryCandidateUpdateIn(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=1200)
    layer: str | None = None
    impact: str | None = Field(default=None, pattern="^(low|medium|high)$")


class MemoryCandidateConfirmIn(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=1200)
    layer: str | None = None


class MemoryCreateIn(BaseModel):
    layer: str
    content: str = Field(min_length=1, max_length=1200)
    source_type: str = Field(default="manual", pattern="^(chat|note|source|plan|manual)$")
    source_id: str | None = Field(default=None, max_length=160)
    source_title: str = Field(default="手动记忆", max_length=200)
    source_excerpt: str = Field(default="", max_length=500)
    priority: int = Field(default=0, ge=-5, le=5)


class MemoryUpdateIn(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=1200)
    layer: str | None = None
    priority: int | None = Field(default=None, ge=-5, le=5)


@router.get("/memory-layers")
def get_memory_layers() -> list[dict]:
    return list_memory_layers()


@router.get("/spaces/{space_id}/memory-settings")
def read_memory_settings(space_id: str) -> dict:
    require_space(space_id)
    return get_memory_settings(space_id)


@router.patch("/spaces/{space_id}/memory-settings")
def patch_memory_settings(space_id: str, payload: MemorySettingsIn) -> dict:
    require_space(space_id)
    return update_memory_settings(space_id, payload.auto_extract_enabled)


@router.get("/spaces/{space_id}/memory-candidates")
def get_memory_candidates(
    space_id: str,
    status: Annotated[str, Query(pattern="^(pending|accepted|ignored|all)$")] = "pending",
    layer: Annotated[str | None, Query()] = None,
) -> list[dict]:
    require_space(space_id)
    return list_memory_candidates(
        space_id,
        status=None if status == "all" else status,
        layer=layer,
    )


@router.patch("/spaces/{space_id}/memory-candidates/{candidate_id}")
def patch_memory_candidate(
    space_id: str,
    candidate_id: str,
    payload: MemoryCandidateUpdateIn,
) -> dict:
    require_space(space_id)
    return update_memory_candidate(
        space_id,
        candidate_id,
        content=payload.content,
        layer=payload.layer,
        impact=payload.impact,
    )


@router.post("/spaces/{space_id}/memory-candidates/{candidate_id}/confirm")
def confirm_candidate(
    space_id: str,
    candidate_id: str,
    payload: MemoryCandidateConfirmIn | None = None,
) -> dict:
    require_space(space_id)
    payload = payload or MemoryCandidateConfirmIn()
    return confirm_memory_candidate(
        space_id,
        candidate_id,
        content=payload.content,
        layer=payload.layer,
    )


@router.post("/spaces/{space_id}/memory-candidates/{candidate_id}/ignore")
def ignore_candidate(space_id: str, candidate_id: str) -> dict:
    require_space(space_id)
    return ignore_memory_candidate(space_id, candidate_id)


@router.get("/spaces/{space_id}/memories")
def get_memories(
    space_id: str,
    layer: Annotated[str | None, Query()] = None,
    include_deleted: Annotated[bool, Query()] = False,
) -> list[dict]:
    require_space(space_id)
    return list_memories(space_id, layer=layer, include_deleted=include_deleted)


@router.post("/spaces/{space_id}/memories")
def post_memory(space_id: str, payload: MemoryCreateIn) -> dict:
    require_space(space_id)
    return create_memory(
        space_id=space_id,
        layer=payload.layer,
        content=payload.content,
        source_type=payload.source_type,
        source_id=payload.source_id,
        source_title=payload.source_title,
        source_excerpt=payload.source_excerpt,
        priority=payload.priority,
    )


@router.patch("/spaces/{space_id}/memories/{memory_id}")
def patch_memory(space_id: str, memory_id: str, payload: MemoryUpdateIn) -> dict:
    require_space(space_id)
    return update_memory(
        space_id,
        memory_id,
        content=payload.content,
        layer=payload.layer,
        priority=payload.priority,
    )


@router.delete("/spaces/{space_id}/memories/{memory_id}")
def delete_memory_item(space_id: str, memory_id: str) -> dict:
    require_space(space_id)
    return delete_memory(space_id, memory_id)
