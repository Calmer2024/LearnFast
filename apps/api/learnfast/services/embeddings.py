from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass

import httpx

from learnfast.infrastructure.database import get_db, row_to_dict
from learnfast.infrastructure.secret_store import secret_store
from learnfast.services.model_providers import PROVIDERS


LOCAL_EMBEDDING_PROVIDER = "local_hash"
LOCAL_EMBEDDING_MODEL = "local-hash-v1"
LOCAL_EMBEDDING_DIM = 384


class EmbeddingError(Exception):
    pass


@dataclass(frozen=True)
class EmbeddingBatch:
    provider_id: str
    model: str
    vectors: list[list[float]]


@dataclass(frozen=True)
class RemoteEmbeddingConfig:
    provider_id: str
    base_url: str
    model: str
    api_key: str


def embed_texts(
    texts: list[str],
    provider_id: str | None = None,
    model: str | None = None,
) -> EmbeddingBatch:
    if provider_id == LOCAL_EMBEDDING_PROVIDER:
        return _embed_local(texts)

    config = _load_remote_embedding_config(model=model)
    if provider_id and provider_id != config.provider_id:
        return _embed_local(texts)
    if config.api_key and config.base_url:
        return _embed_remote(texts, config)
    return _embed_local(texts)


def _load_remote_embedding_config(model: str | None = None) -> RemoteEmbeddingConfig:
    provider = PROVIDERS["qwen_embedding"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM model_configs WHERE provider_id = ? AND enabled = 1",
            (provider.id,),
        ).fetchone()
    config = row_to_dict(row)
    if not config:
        return RemoteEmbeddingConfig(provider.id, "", model or provider.embedding_models[0], "")

    api_key = secret_store.get_api_key(config.get("secret_ref"))
    return RemoteEmbeddingConfig(
        provider_id=provider.id,
        base_url=(config.get("base_url") or provider.base_url or "").rstrip("/"),
        model=model or config.get("default_embedding_model") or provider.embedding_models[0],
        api_key=api_key or "",
    )


def _embed_remote(texts: list[str], config: RemoteEmbeddingConfig) -> EmbeddingBatch:
    if not texts:
        return EmbeddingBatch(config.provider_id, config.model, [])

    vectors: list[list[float]] = []
    for start in range(0, len(texts), 32):
        batch = texts[start : start + 32]
        try:
            response = httpx.post(
                f"{config.base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": config.model, "input": batch},
                timeout=45,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            raise EmbeddingError(f"Embedding request failed: {exc}") from exc

        data = payload.get("data")
        if not isinstance(data, list) or len(data) != len(batch):
            raise EmbeddingError("Embedding response did not match the requested batch.")
        data = sorted(data, key=lambda item: item.get("index", 0))
        for item in data:
            vector = item.get("embedding")
            if not isinstance(vector, list) or not vector:
                raise EmbeddingError("Embedding response contained an empty vector.")
            vectors.append(_normalize([float(value) for value in vector]))

    return EmbeddingBatch(config.provider_id, config.model, vectors)


def _embed_local(texts: list[str]) -> EmbeddingBatch:
    return EmbeddingBatch(
        provider_id=LOCAL_EMBEDDING_PROVIDER,
        model=LOCAL_EMBEDDING_MODEL,
        vectors=[_local_vector(text) for text in texts],
    )


def _local_vector(text: str) -> list[float]:
    vector = [0.0] * LOCAL_EMBEDDING_DIM
    for token in _tokens(text):
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        value = int.from_bytes(digest, "big")
        index = value % LOCAL_EMBEDDING_DIM
        sign = 1.0 if (value >> 8) & 1 else -1.0
        vector[index] += sign
    return _normalize(vector)


def _tokens(text: str) -> list[str]:
    lowered = text.lower()
    raw_tokens = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]", lowered)
    tokens: list[str] = []
    for token in raw_tokens:
        tokens.append(token)
        if len(token) > 4 and not re.fullmatch(r"[\u4e00-\u9fff]", token):
            for start in range(0, len(token) - 2):
                tokens.append(token[start : start + 3])
    return tokens


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]
