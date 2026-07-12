from pydantic import BaseModel, Field
from fastapi import APIRouter

from learnfast.api.routes.spaces import require_space
from learnfast.infrastructure.database import get_db, utc_now

router = APIRouter(tags=["learning-preferences"])


class LearningPreferencesIn(BaseModel):
    onboarding_completed: bool = False
    tone: str = Field(default="友好、直接", max_length=80)
    explanation_depth: str = Field(default="循序渐进", max_length=80)
    teaching_approach: str = Field(default="先理解再练习", max_length=120)
    interaction_style: str = Field(default="启发式追问", max_length=80)
    learner_level: str = Field(default="", max_length=120)
    custom_instructions: str = Field(default="", max_length=1000)


def get_learning_preferences(space_id: str) -> dict:
    require_space(space_id)
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM learning_preferences WHERE space_id = ?", (space_id,)
        ).fetchone()
    if row:
        result = dict(row)
        result["onboarding_completed"] = bool(result["onboarding_completed"])
        return result
    now = utc_now()
    return {
        "space_id": space_id,
        "onboarding_completed": False,
        "tone": "友好、直接",
        "explanation_depth": "循序渐进",
        "teaching_approach": "先理解再练习",
        "interaction_style": "启发式追问",
        "learner_level": "",
        "custom_instructions": "",
        "created_at": now,
        "updated_at": now,
    }


@router.get("/spaces/{space_id}/learning-preferences")
def read_learning_preferences(space_id: str) -> dict:
    return get_learning_preferences(space_id)


@router.put("/spaces/{space_id}/learning-preferences")
def put_learning_preferences(space_id: str, payload: LearningPreferencesIn) -> dict:
    require_space(space_id)
    now = utc_now()
    values = payload.model_dump()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO learning_preferences (
                space_id, onboarding_completed, tone, explanation_depth,
                teaching_approach, interaction_style, learner_level,
                custom_instructions, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(space_id) DO UPDATE SET
                onboarding_completed=excluded.onboarding_completed,
                tone=excluded.tone, explanation_depth=excluded.explanation_depth,
                teaching_approach=excluded.teaching_approach,
                interaction_style=excluded.interaction_style,
                learner_level=excluded.learner_level,
                custom_instructions=excluded.custom_instructions,
                updated_at=excluded.updated_at
            """,
            (
                space_id, int(values["onboarding_completed"]), values["tone"],
                values["explanation_depth"], values["teaching_approach"],
                values["interaction_style"], values["learner_level"],
                values["custom_instructions"], now, now,
            ),
        )
    return get_learning_preferences(space_id)
