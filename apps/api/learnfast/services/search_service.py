from __future__ import annotations

import json
import re

from learnfast.infrastructure.database import get_db
from learnfast.services.indexer import search_chunks


def search_space_items(
    space_id: str,
    query: str,
    *,
    limit: int = 30,
    source_ids: list[str] | None = None,
) -> list[dict]:
    clean_query = " ".join(query.strip().split())
    if not clean_query:
        return []
    if source_ids is not None and not source_ids:
        return []
    max_results = max(1, min(limit, 50))
    results: list[dict] = []
    results.extend(_source_title_results(space_id, clean_query, source_ids))
    results.extend(_chunk_results(space_id, clean_query, max_results, source_ids))
    if source_ids is None:
        results.extend(_note_title_results(space_id, clean_query))
        results.extend(_memory_results(space_id, clean_query, None))
    else:
        results.extend(_memory_results(space_id, clean_query, source_ids))
    results.extend(_plan_task_results(space_id, clean_query, source_ids))

    deduped: dict[tuple[str, str], dict] = {}
    for result in results:
        key = (result["result_type"], result["source_id"])
        current = deduped.get(key)
        if not current or result["score"] > current["score"]:
            deduped[key] = result
    ordered = sorted(
        deduped.values(),
        key=lambda item: (item["score"], item["updated_at"] or item["created_at"] or ""),
        reverse=True,
    )
    return ordered[:max_results]


def _chunk_results(
    space_id: str,
    query: str,
    limit: int,
    source_ids: list[str] | None,
) -> list[dict]:
    chunks = search_chunks(space_id, query, limit=limit, source_ids=source_ids)
    results: list[dict] = []
    for chunk in chunks:
        result_type = "note_chunk" if chunk.source_type == "note" else "source_chunk"
        results.append(
            {
                "id": chunk.id,
                "chunk_id": chunk.id,
                "result_type": result_type,
                "source_type": chunk.source_type,
                "source_id": chunk.source_id,
                "source_title": chunk.source_title,
                "title": chunk.source_title,
                "version_id": chunk.version_id,
                "ordinal": chunk.ordinal,
                "heading_path": chunk.heading_path,
                "locator": chunk.locator,
                "quote_snapshot": _quote(chunk.text),
                "score": round(chunk.score, 6),
                "created_at": "",
                "updated_at": "",
                "metadata": {},
            }
        )
    return results


def _source_title_results(
    space_id: str,
    query: str,
    source_ids: list[str] | None,
) -> list[dict]:
    params: list[object] = [space_id]
    clause = ""
    if source_ids is not None:
        placeholders = ", ".join("?" for _ in source_ids)
        clause = f" AND id IN ({placeholders})"
        params.extend(source_ids)
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT id, title, origin, type, status, enabled, chunk_count,
                       version_id, indexed_at, created_at, updated_at
                FROM sources
                WHERE space_id = ? {clause}
                """,
                tuple(params),
            ).fetchall()
        ]
    results = []
    for row in rows:
        score = _text_score(query, f"{row['title']} {row['origin']} {row['type']} {row['status']}")
        if score <= 0:
            continue
        results.append(
            {
                "id": f"source-title:{row['id']}",
                "chunk_id": f"source-title:{row['id']}",
                "result_type": "source_title",
                "source_type": "source",
                "source_id": row["id"],
                "source_title": row["title"],
                "title": row["title"],
                "version_id": row.get("version_id") or "",
                "ordinal": 0,
                "heading_path": [],
                "locator": "source:title",
                "quote_snapshot": row["origin"],
                "score": score,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "metadata": {
                    "type": row["type"],
                    "status": row["status"],
                    "enabled": bool(row["enabled"]),
                    "chunk_count": row.get("chunk_count") or 0,
                    "indexed_at": row.get("indexed_at"),
                },
            }
        )
    return results


def _note_title_results(space_id: str, query: str) -> list[dict]:
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, title, markdown, tags_json, status, created_at, updated_at
                FROM notes
                WHERE space_id = ?
                """,
                (space_id,),
            ).fetchall()
        ]
    results = []
    for row in rows:
        tags = json.loads(row.get("tags_json") or "[]")
        score = _text_score(query, f"{row['title']} {' '.join(tags)} {row['markdown'][:500]}")
        if score <= 0:
            continue
        results.append(
            {
                "id": f"note:{row['id']}",
                "chunk_id": f"note:{row['id']}",
                "result_type": "note",
                "source_type": "note",
                "source_id": row["id"],
                "source_title": row["title"],
                "title": row["title"],
                "version_id": "",
                "ordinal": 0,
                "heading_path": [],
                "locator": "note:title",
                "quote_snapshot": _quote(_plain_text(row["markdown"]), 220),
                "score": score,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "metadata": {"status": row["status"], "tags": tags},
            }
        )
    return results


def _memory_results(
    space_id: str,
    query: str,
    source_ids: list[str] | None,
) -> list[dict]:
    params: list[object] = [space_id]
    clause = ""
    if source_ids is not None:
        placeholders = ", ".join("?" for _ in source_ids)
        clause = f" AND source_type = 'source' AND source_id IN ({placeholders})"
        params.extend(source_ids)
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT id, layer, content, source_type, source_id, source_title,
                       source_excerpt, priority, created_at, updated_at
                FROM memories
                WHERE space_id = ? AND status = 'active' {clause}
                """,
                tuple(params),
            ).fetchall()
        ]
    results = []
    for row in rows:
        score = _text_score(query, f"{row['layer']} {row['content']} {row['source_title']} {row['source_excerpt']}")
        if score <= 0:
            continue
        results.append(
            {
                "id": f"memory:{row['id']}",
                "chunk_id": f"memory:{row['id']}",
                "result_type": "memory",
                "source_type": "memory",
                "source_id": row["id"],
                "source_title": row["source_title"] or "长期记忆",
                "title": row["source_title"] or "长期记忆",
                "version_id": "",
                "ordinal": 0,
                "heading_path": [row["layer"]],
                "locator": "memory:active",
                "quote_snapshot": row["content"],
                "score": min(1.0, score + row.get("priority", 0) * 0.01),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "metadata": {
                    "layer": row["layer"],
                    "source_type": row["source_type"],
                    "linked_source_id": row.get("source_id"),
                    "priority": row.get("priority") or 0,
                },
            }
        )
    return results


def _plan_task_results(
    space_id: str,
    query: str,
    source_ids: list[str] | None,
) -> list[dict]:
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT plan_tasks.*, plans.title AS plan_title, plans.status AS plan_status
                FROM plan_tasks
                JOIN plans ON plans.id = plan_tasks.plan_id
                WHERE plan_tasks.space_id = ?
                """,
                (space_id,),
            ).fetchall()
        ]
    selected = set(source_ids or [])
    results = []
    for row in rows:
        task_source_ids = json.loads(row.get("source_ids_json") or "[]")
        if source_ids is not None and not selected.intersection(task_source_ids):
            continue
        text = " ".join(
            [
                row["plan_title"],
                row["title"],
                row.get("description") or "",
                row.get("review_prompt") or "",
                row.get("recommended_reason") or "",
                row.get("review_result") or "",
                row.get("task_type") or "",
                row.get("status") or "",
            ]
        )
        score = _text_score(query, text)
        if score <= 0:
            continue
        results.append(
            {
                "id": f"plan-task:{row['id']}",
                "chunk_id": f"plan-task:{row['id']}",
                "result_type": "plan_task",
                "source_type": "plan_task",
                "source_id": row["id"],
                "source_title": row["plan_title"],
                "title": row["title"],
                "version_id": row["plan_id"],
                "ordinal": row.get("order_index") or 0,
                "heading_path": [row["plan_title"]],
                "locator": f"plan:{row['plan_id']}:task:{row['id']}",
                "quote_snapshot": _quote(row.get("description") or row.get("review_result") or row["title"], 260),
                "score": score,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "metadata": {
                    "plan_id": row["plan_id"],
                    "plan_status": row["plan_status"],
                    "task_type": row.get("task_type") or "study",
                    "status": row.get("status") or "todo",
                    "priority": row.get("priority") or "medium",
                    "due_date": row.get("due_date"),
                    "source_ids": task_source_ids,
                },
            }
        )
    return results


def _text_score(query: str, text: str) -> float:
    haystack = (text or "").lower()
    needle = query.lower()
    if not haystack.strip():
        return 0
    if needle in haystack:
        return 0.96 if haystack.startswith(needle) else 0.88
    tokens = [token for token in re.split(r"\s+", needle) if token]
    if not tokens:
        return 0
    matches = sum(1 for token in tokens if token in haystack)
    if matches == 0:
        return 0
    return round(0.42 + 0.36 * (matches / len(tokens)), 6)


def _plain_text(markdown: str) -> str:
    text = re.sub(r"```.*?```", " ", markdown or "", flags=re.S)
    text = re.sub(r"[#>*_`\-\[\]\(\)]", " ", text)
    return " ".join(text.split())


def _quote(text: str, limit: int = 360) -> str:
    compact = " ".join((text or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."
