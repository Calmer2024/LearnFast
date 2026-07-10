from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from learnfast.api.routes.spaces import require_space
from learnfast.services.plans import (
    complete_task,
    create_plan,
    create_task,
    delete_task,
    export_plan_markdown,
    generate_plan,
    get_current_plan,
    record_review_result,
    update_plan,
    update_task,
)

router = APIRouter(tags=["plans"])


class PlanTaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=1200)
    task_type: str = Field(default="study", pattern="^(study|review|practice|note)$")
    status: str = Field(default="todo", pattern="^(todo|in_progress|done|skipped)$")
    priority: str = Field(default="medium", pattern="^(low|medium|high)$")
    due_date: str | None = None
    source_ids: list[str] = Field(default_factory=list)
    review_prompt: str = Field(default="", max_length=1200)
    recommended_reason: str = Field(default="", max_length=500)
    order_index: int | None = Field(default=None, ge=0)


class PlanCreateIn(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    goal: str = Field(min_length=1, max_length=1000)
    cadence: str = Field(default="", max_length=120)
    target_level: str = Field(default="", max_length=160)
    deadline: str | None = None
    assumptions: dict = Field(default_factory=dict)
    rationale: str = Field(default="", max_length=1200)
    tasks: list[PlanTaskIn] = Field(default_factory=list)
    replace_current: bool = True


class PlanGenerateIn(BaseModel):
    goal: str | None = Field(default=None, max_length=1000)
    cadence: str = Field(default="每周 4 次，每次 45 分钟", max_length=120)
    target_level: str = Field(default="能独立复述核心概念，并完成基础练习", max_length=160)
    deadline: str | None = None
    replace_current: bool = True


class PlanUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    goal: str | None = Field(default=None, min_length=1, max_length=1000)
    status: str | None = Field(default=None, pattern="^(active|archived)$")
    cadence: str | None = Field(default=None, max_length=120)
    target_level: str | None = Field(default=None, max_length=160)
    deadline: str | None = None


class PlanTaskUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1200)
    task_type: str | None = Field(default=None, pattern="^(study|review|practice|note)$")
    status: str | None = Field(default=None, pattern="^(todo|in_progress|done|skipped)$")
    priority: str | None = Field(default=None, pattern="^(low|medium|high)$")
    due_date: str | None = None
    source_ids: list[str] | None = None
    review_prompt: str | None = Field(default=None, max_length=1200)
    recommended_reason: str | None = Field(default=None, max_length=500)
    order_index: int | None = Field(default=None, ge=0)


class TaskCompleteIn(BaseModel):
    review_result: str | None = Field(default=None, max_length=1600)
    message_id: str | None = Field(default=None, max_length=160)


class ReviewResultIn(BaseModel):
    result: str = Field(min_length=1, max_length=1600)
    message_id: str | None = Field(default=None, max_length=160)
    mark_completed: bool = True


@router.get("/spaces/{space_id}/plans/current")
def read_current_plan(space_id: str) -> dict | None:
    require_space(space_id)
    return get_current_plan(space_id)


@router.post("/spaces/{space_id}/plans")
def post_plan(space_id: str, payload: PlanCreateIn) -> dict:
    require_space(space_id)
    return create_plan(
        space_id=space_id,
        title=payload.title,
        goal=payload.goal,
        cadence=payload.cadence,
        target_level=payload.target_level,
        deadline=payload.deadline,
        assumptions=payload.assumptions,
        rationale=payload.rationale,
        tasks=[task.model_dump() for task in payload.tasks],
        replace_current=payload.replace_current,
    )


@router.post("/spaces/{space_id}/plans/generate")
def post_generate_plan(space_id: str, payload: PlanGenerateIn) -> dict:
    require_space(space_id)
    return generate_plan(
        space_id=space_id,
        goal=payload.goal,
        cadence=payload.cadence,
        target_level=payload.target_level,
        deadline=payload.deadline,
        replace_current=payload.replace_current,
    )


@router.patch("/spaces/{space_id}/plans/{plan_id}")
def patch_plan(space_id: str, plan_id: str, payload: PlanUpdateIn) -> dict:
    require_space(space_id)
    values = payload.model_dump(exclude_unset=True)
    return update_plan(space_id, plan_id, **values)


@router.post("/spaces/{space_id}/plans/{plan_id}/tasks")
def post_task(space_id: str, plan_id: str, payload: PlanTaskIn) -> dict:
    require_space(space_id)
    return create_task(space_id, plan_id, payload.model_dump())


@router.patch("/spaces/{space_id}/plans/{plan_id}/tasks/{task_id}")
def patch_task(
    space_id: str,
    plan_id: str,
    task_id: str,
    payload: PlanTaskUpdateIn,
) -> dict:
    require_space(space_id)
    values = payload.model_dump(exclude_unset=True)
    return update_task(space_id, plan_id, task_id, **values)


@router.post("/spaces/{space_id}/plans/{plan_id}/tasks/{task_id}/complete")
def post_complete_task(
    space_id: str,
    plan_id: str,
    task_id: str,
    payload: TaskCompleteIn | None = None,
) -> dict:
    require_space(space_id)
    payload = payload or TaskCompleteIn()
    return complete_task(
        space_id,
        plan_id,
        task_id,
        review_result=payload.review_result,
        message_id=payload.message_id,
    )


@router.post("/spaces/{space_id}/plans/{plan_id}/tasks/{task_id}/review-result")
def post_review_result(
    space_id: str,
    plan_id: str,
    task_id: str,
    payload: ReviewResultIn,
) -> dict:
    require_space(space_id)
    return record_review_result(
        space_id,
        plan_id,
        task_id,
        result=payload.result,
        message_id=payload.message_id,
        mark_completed=payload.mark_completed,
    )


@router.delete("/spaces/{space_id}/plans/{plan_id}/tasks/{task_id}")
def delete_plan_task(space_id: str, plan_id: str, task_id: str) -> dict:
    require_space(space_id)
    return delete_task(space_id, plan_id, task_id)


@router.get("/spaces/{space_id}/plans/{plan_id}/export")
def get_plan_export(space_id: str, plan_id: str) -> dict:
    require_space(space_id)
    return export_plan_markdown(space_id, plan_id)
