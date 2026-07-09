import json
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from learnfast.core.errors import bad_request, not_found
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now
from learnfast.infrastructure.secret_store import secret_store
from learnfast.services.model_providers import PROVIDERS, ProviderDefinition
from learnfast.services.system_logs import log_event

router = APIRouter(prefix="/model-providers", tags=["model-providers"])


class ProviderConfigIn(BaseModel):
    api_key: str | None = Field(default=None, min_length=1)
    base_url: str | None = None
    default_chat_model: str | None = None
    default_embedding_model: str | None = None


def _provider_response(provider: ProviderDefinition, row: dict | None) -> dict:
    row = row or {}
    configured = bool(row.get("secret_ref"))
    return {
        "id": provider.id,
        "role": provider.role,
        "display_name": provider.display_name,
        "base_url": row.get("base_url") or provider.base_url,
        "requires_base_url": provider.requires_base_url,
        "chat_models": list(provider.chat_models),
        "embedding_models": list(provider.embedding_models),
        "capabilities": list(provider.capabilities),
        "configured": configured,
        "has_api_key": configured,
        "status": row.get("status") or "not_configured",
        "error": row.get("error"),
        "default_chat_model": row.get("default_chat_model") or (provider.chat_models[0] if provider.chat_models else None),
        "default_embedding_model": row.get("default_embedding_model")
        or (provider.embedding_models[0] if provider.embedding_models else None),
        "last_tested_at": row.get("last_tested_at"),
    }


@router.get("")
def list_providers() -> list[dict]:
    with get_db() as conn:
        rows = {
            row["provider_id"]: dict(row)
            for row in conn.execute("SELECT * FROM model_configs").fetchall()
        }
    return [_provider_response(provider, rows.get(provider.id)) for provider in PROVIDERS.values()]


@router.get("/{provider_id}")
def get_provider(provider_id: str) -> dict:
    provider = PROVIDERS.get(provider_id)
    if not provider:
        raise not_found("Model provider not found.")
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM model_configs WHERE provider_id = ?",
            (provider_id,),
        ).fetchone()
    return _provider_response(provider, row_to_dict(row))


@router.post("/{provider_id}/config")
def save_provider_config(provider_id: str, payload: ProviderConfigIn) -> dict:
    provider = PROVIDERS.get(provider_id)
    if not provider:
        raise not_found("Model provider not found.")
    if provider.requires_base_url and not payload.base_url:
        raise bad_request(f"{provider.display_name} requires a Base URL.")

    secret_ref = None
    with get_db() as conn:
        existing = conn.execute(
            "SELECT secret_ref FROM model_configs WHERE provider_id = ?",
            (provider_id,),
        ).fetchone()
        secret_ref = existing["secret_ref"] if existing else None

    if payload.api_key:
        secret_ref = secret_store.set_api_key(provider_id, payload.api_key)

    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO model_configs (
                provider_id, provider_name, enabled, base_url, default_chat_model,
                default_embedding_model, capabilities_json, secret_ref, status, error, updated_at
            )
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'configured', NULL, ?)
            ON CONFLICT(provider_id) DO UPDATE SET
                provider_name = excluded.provider_name,
                enabled = 1,
                base_url = excluded.base_url,
                default_chat_model = excluded.default_chat_model,
                default_embedding_model = excluded.default_embedding_model,
                capabilities_json = excluded.capabilities_json,
                secret_ref = COALESCE(excluded.secret_ref, model_configs.secret_ref),
                status = 'configured',
                error = NULL,
                updated_at = excluded.updated_at
            """,
            (
                provider.id,
                provider.display_name,
                payload.base_url or provider.base_url,
                payload.default_chat_model or (provider.chat_models[0] if provider.chat_models else None),
                payload.default_embedding_model or (provider.embedding_models[0] if provider.embedding_models else None),
                json.dumps(list(provider.capabilities)),
                secret_ref,
                now,
            ),
        )
    log_event(
        "model",
        "模型 Provider 配置已保存",
        details={
            "provider_id": provider.id,
            "provider_role": provider.role,
            "default_chat_model": payload.default_chat_model,
            "default_embedding_model": payload.default_embedding_model,
            "has_api_key": bool(secret_ref),
        },
    )
    return get_provider(provider_id)


@router.post("/{provider_id}/test")
def test_provider(provider_id: str) -> dict:
    provider = PROVIDERS.get(provider_id)
    if not provider:
        raise not_found("Model provider not found.")

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM model_configs WHERE provider_id = ?",
            (provider_id,),
        ).fetchone()
    config = row_to_dict(row)
    if not config or not config.get("secret_ref"):
        raise bad_request("Provider is not configured.")

    api_key = secret_store.get_api_key(config.get("secret_ref"))
    if not api_key:
        raise bad_request("API key is missing.")

    status = "connected"
    error = None
    if provider.live_test_kind == "openai_models":
        try:
            base_url = (config.get("base_url") or provider.base_url or "").rstrip("/")
            response = httpx.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            response.raise_for_status()
        except Exception as exc:
            status = "failed"
            error = str(exc)
    elif provider.live_test_kind == "openai_embeddings":
        try:
            base_url = (config.get("base_url") or provider.base_url or "").rstrip("/")
            model = config.get("default_embedding_model") or provider.embedding_models[0]
            response = httpx.post(
                f"{base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": model, "input": "LearnFast connection test"},
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
            embedding = payload.get("data", [{}])[0].get("embedding")
            if not isinstance(embedding, list) or not embedding:
                raise ValueError("Embedding response did not contain a vector.")
        except Exception as exc:
            status = "failed"
            error = str(exc)

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE model_configs
            SET status = ?, error = ?, last_tested_at = ?, updated_at = ?
            WHERE provider_id = ?
            """,
            (status, error, now, now, provider_id),
        )
    log_event(
        "model",
        "模型 Provider 连接测试完成",
        level="info" if status == "connected" else "error",
        details={
            "provider_id": provider.id,
            "provider_role": provider.role,
            "status": status,
            "error": error,
        },
    )
    return get_provider(provider_id)
