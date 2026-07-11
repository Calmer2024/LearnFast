from __future__ import annotations

import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def main() -> int:
    from learnfast.services import embeddings
    from learnfast.services.embeddings import (
        EmbeddingError,
        RemoteEmbeddingConfig,
        _embed_remote,
    )

    config = RemoteEmbeddingConfig(
        provider_id="qwen_embedding",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        model="text-embedding-v4",
        api_key="test-key",
    )
    original_post = embeddings.httpx.post

    batch_sizes: list[int] = []

    def fake_post(url: str, headers: dict, json: dict, timeout: int) -> httpx.Response:
        batch = json["input"]
        assert url.endswith("/embeddings")
        assert headers["Authorization"] == "Bearer test-key"
        assert isinstance(batch, list)
        assert json["encoding_format"] == "float"
        assert len(batch) <= embeddings._remote_batch_size(json["model"])
        batch_sizes.append(len(batch))
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "data": [
                    {"index": index, "embedding": [float(index + 1), 1.0]}
                    for index, _ in enumerate(batch)
                ]
            },
        )

    try:
        embeddings.httpx.post = fake_post
        result = _embed_remote([f"chunk {index}" for index in range(23)], config)
        assert len(result.vectors) == 23
        assert batch_sizes == [10, 10, 3]

        legacy_config = RemoteEmbeddingConfig(
            provider_id="qwen_embedding",
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            model="text-embedding-v2",
            api_key="test-key",
        )
        batch_sizes.clear()
        _embed_remote([f"legacy chunk {index}" for index in range(26)], legacy_config)
        assert batch_sizes == [25, 1]

        def fake_bad_post(url: str, headers: dict, json: dict, timeout: int) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "code": "InvalidParameter",
                    "message": "too many input rows",
                },
                request=httpx.Request("POST", url),
            )

        embeddings.httpx.post = fake_bad_post
        try:
            _embed_remote(["one"], config)
            raise AssertionError("expected EmbeddingError")
        except EmbeddingError as exc:
            message = str(exc)
            assert "Provider response" in message
            assert "InvalidParameter" in message
            assert "too many input rows" in message
    finally:
        embeddings.httpx.post = original_post

    print("PASS embeddings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
