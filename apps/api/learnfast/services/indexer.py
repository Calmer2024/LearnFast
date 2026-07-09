from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass

from learnfast.core.limits import MAX_CHUNKS_PER_SOURCE, MAX_CONTEXT_CHUNKS
from learnfast.infrastructure.database import get_db, utc_now
from learnfast.services.chunking import MarkdownChunk, chunk_markdown
from learnfast.services.embeddings import embed_texts


class IndexingError(Exception):
    pass


@dataclass(frozen=True)
class IndexResult:
    version_id: str
    chunk_count: int
    indexed_at: str


@dataclass(frozen=True)
class ChunkSearchResult:
    id: str
    source_type: str
    source_id: str
    source_title: str
    version_id: str
    ordinal: int
    heading_path: list[str]
    locator: str
    text: str
    score: float


def index_source_markdown(space_id: str, source: dict, markdown: str) -> IndexResult:
    chunks = chunk_markdown(markdown)
    if not chunks:
        raise IndexingError("Markdown is empty; no chunks can be indexed.")
    if len(chunks) > MAX_CHUNKS_PER_SOURCE:
        raise IndexingError(f"Source produced {len(chunks)} chunks; MVP limit is {MAX_CHUNKS_PER_SOURCE}.")

    texts = [chunk.text for chunk in chunks]
    embedding_batch = embed_texts(texts)
    if len(embedding_batch.vectors) != len(chunks):
        raise IndexingError("Embedding count did not match chunk count.")

    source_id = source["id"]
    markdown_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    version_id = f"md-{markdown_hash[:16]}"
    indexed_at = utc_now()

    chunk_ids = [
        _chunk_id(source_id, version_id, chunk)
        for chunk in chunks
    ]

    with get_db() as conn:
        conn.execute("DELETE FROM source_chunks WHERE source_id = ?", (source_id,))
        for index, chunk in enumerate(chunks):
            vector = embedding_batch.vectors[index]
            conn.execute(
                """
                INSERT INTO source_chunks (
                    id, space_id, source_id, version_id, ordinal,
                    heading_path_json, locator, text, content_hash, char_count,
                    prev_chunk_id, next_chunk_id, embedding_provider, embedding_model,
                    embedding_dim, embedding_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_ids[index],
                    space_id,
                    source_id,
                    version_id,
                    chunk.ordinal,
                    json.dumps(chunk.heading_path, ensure_ascii=False),
                    chunk.locator,
                    chunk.text,
                    chunk.content_hash,
                    chunk.char_count,
                    chunk_ids[index - 1] if index > 0 else None,
                    chunk_ids[index + 1] if index < len(chunks) - 1 else None,
                    embedding_batch.provider_id,
                    embedding_batch.model,
                    len(vector),
                    json.dumps(vector, separators=(",", ":")),
                    indexed_at,
                ),
            )

    return IndexResult(version_id=version_id, chunk_count=len(chunks), indexed_at=indexed_at)


def index_note_markdown(space_id: str, note: dict, markdown: str) -> IndexResult:
    indexed_markdown = _note_index_markdown(note, markdown)
    chunks = chunk_markdown(indexed_markdown)
    if not chunks:
        raise IndexingError("Note markdown is empty; no chunks can be indexed.")
    if len(chunks) > MAX_CHUNKS_PER_SOURCE:
        raise IndexingError(f"Note produced {len(chunks)} chunks; MVP limit is {MAX_CHUNKS_PER_SOURCE}.")

    texts = [chunk.text for chunk in chunks]
    embedding_batch = embed_texts(texts)
    if len(embedding_batch.vectors) != len(chunks):
        raise IndexingError("Embedding count did not match chunk count.")

    note_id = note["id"]
    markdown_hash = hashlib.sha256(indexed_markdown.encode("utf-8")).hexdigest()
    version_id = f"note-{markdown_hash[:16]}"
    indexed_at = utc_now()
    chunk_ids = [_chunk_id(note_id, version_id, chunk) for chunk in chunks]

    with get_db() as conn:
        conn.execute("DELETE FROM note_chunks WHERE note_id = ?", (note_id,))
        for index, chunk in enumerate(chunks):
            vector = embedding_batch.vectors[index]
            conn.execute(
                """
                INSERT INTO note_chunks (
                    id, space_id, note_id, version_id, ordinal,
                    heading_path_json, locator, text, content_hash, char_count,
                    prev_chunk_id, next_chunk_id, embedding_provider, embedding_model,
                    embedding_dim, embedding_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_ids[index],
                    space_id,
                    note_id,
                    version_id,
                    chunk.ordinal,
                    json.dumps(chunk.heading_path, ensure_ascii=False),
                    chunk.locator,
                    chunk.text,
                    chunk.content_hash,
                    chunk.char_count,
                    chunk_ids[index - 1] if index > 0 else None,
                    chunk_ids[index + 1] if index < len(chunks) - 1 else None,
                    embedding_batch.provider_id,
                    embedding_batch.model,
                    len(vector),
                    json.dumps(vector, separators=(",", ":")),
                    indexed_at,
                ),
            )

    return IndexResult(version_id=version_id, chunk_count=len(chunks), indexed_at=indexed_at)


def delete_note_index(note_id: str) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM note_chunks WHERE note_id = ?", (note_id,))


def list_note_chunks(space_id: str, note_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, note_id, version_id, ordinal, heading_path_json, locator,
                   text, content_hash, char_count, prev_chunk_id, next_chunk_id,
                   embedding_provider, embedding_model, embedding_dim, created_at
            FROM note_chunks
            WHERE space_id = ? AND note_id = ?
            ORDER BY ordinal ASC
            """,
            (space_id, note_id),
        ).fetchall()
    return [_chunk_response(dict(row)) for row in rows]


def list_source_chunks(space_id: str, source_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, source_id, version_id, ordinal, heading_path_json, locator,
                   text, content_hash, char_count, prev_chunk_id, next_chunk_id,
                   embedding_provider, embedding_model, embedding_dim, created_at
            FROM source_chunks
            WHERE space_id = ? AND source_id = ?
            ORDER BY ordinal ASC
            """,
            (space_id, source_id),
        ).fetchall()
    return [_chunk_response(dict(row)) for row in rows]


def search_chunks(
    space_id: str,
    query: str,
    limit: int = MAX_CONTEXT_CHUNKS,
    source_ids: list[str] | None = None,
) -> list[ChunkSearchResult]:
    query = query.strip()
    if not query:
        return []
    if source_ids is not None and not source_ids:
        return []

    params: list[object] = [space_id]
    source_filter = ""
    if source_ids is not None:
        placeholders = ", ".join("?" for _ in source_ids)
        source_filter = f"AND chunks.source_id IN ({placeholders})"
        params.extend(source_ids)

    with get_db() as conn:
        source_rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT
                    chunks.*,
                    'source' AS source_type,
                    chunks.source_id AS item_id,
                    sources.title AS source_title
                FROM source_chunks AS chunks
                JOIN sources ON sources.id = chunks.source_id
                WHERE chunks.space_id = ?
                  AND sources.enabled = 1
                  AND sources.status = 'ready'
                  {source_filter}
                """,
                tuple(params),
            ).fetchall()
        ]
        note_rows: list[dict] = []
        if source_ids is None:
            note_rows = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT
                        chunks.*,
                        'note' AS source_type,
                        chunks.note_id AS item_id,
                        notes.title AS source_title
                    FROM note_chunks AS chunks
                    JOIN notes ON notes.id = chunks.note_id
                    WHERE chunks.space_id = ?
                    """,
                    (space_id,),
                ).fetchall()
            ]
    rows = [*source_rows, *note_rows]

    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        key = (row["embedding_provider"], row["embedding_model"])
        grouped.setdefault(key, []).append(row)

    scored: list[ChunkSearchResult] = []
    for (provider_id, model), candidates in grouped.items():
        query_embedding = embed_texts([query], provider_id=provider_id, model=model).vectors[0]
        for row in candidates:
            vector = json.loads(row["embedding_json"])
            if len(vector) != len(query_embedding):
                continue
            score = _dot(query_embedding, vector)
            if score <= 0:
                continue
            scored.append(
                ChunkSearchResult(
                    id=row["id"],
                    source_type=row["source_type"],
                    source_id=row["item_id"],
                    source_title=row["source_title"],
                    version_id=row["version_id"],
                    ordinal=row["ordinal"],
                    heading_path=json.loads(row["heading_path_json"]),
                    locator=row["locator"],
                    text=row["text"],
                    score=score,
                )
            )

    scored.sort(key=lambda item: item.score, reverse=True)
    return scored[: max(1, min(limit, MAX_CONTEXT_CHUNKS))]


def search_result_response(result: ChunkSearchResult) -> dict:
    return {
        "chunk_id": result.id,
        "source_type": result.source_type,
        "source_id": result.source_id,
        "source_title": result.source_title,
        "version_id": result.version_id,
        "ordinal": result.ordinal,
        "heading_path": result.heading_path,
        "locator": result.locator,
        "quote_snapshot": _quote(result.text),
        "score": round(result.score, 6),
    }


def _chunk_response(row: dict) -> dict:
    heading_path = json.loads(row.pop("heading_path_json"))
    return {
        **row,
        "heading_path": heading_path,
    }


def _note_index_markdown(note: dict, markdown: str) -> str:
    title = (note.get("title") or "未命名笔记").strip()
    tags = note.get("tags")
    if tags is None:
        try:
            tags = json.loads(note.get("tags_json") or "[]")
        except json.JSONDecodeError:
            tags = []
    tag_line = f"标签：{', '.join(tags)}" if tags else "标签：无"
    body = markdown.strip()
    if body.startswith("# "):
        return f"{body}\n\n{tag_line}\n"
    return f"# {title}\n\n{tag_line}\n\n{body}\n"


def _chunk_id(source_id: str, version_id: str, chunk: MarkdownChunk) -> str:
    digest = hashlib.sha256(
        f"{source_id}:{version_id}:{chunk.ordinal}:{chunk.content_hash}".encode("utf-8")
    ).hexdigest()
    return f"chunk-{digest[:24]}"


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right)) / (
        _norm(left) * _norm(right) or 1.0
    )


def _norm(vector: list[float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def _quote(text: str, limit: int = 360) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."
