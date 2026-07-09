from fastapi import APIRouter, Query

from learnfast.api.routes.spaces import require_space
from learnfast.core.limits import MAX_CONTEXT_CHUNKS
from learnfast.services.indexer import search_chunks, search_result_response
from learnfast.services.system_logs import log_event

router = APIRouter(tags=["search"])


@router.get("/spaces/{space_id}/search")
def search_space(
    space_id: str,
    q: str = Query(..., min_length=1),
    limit: int = Query(default=MAX_CONTEXT_CHUNKS, ge=1, le=MAX_CONTEXT_CHUNKS),
    source_id: list[str] | None = Query(default=None),
) -> dict:
    require_space(space_id)
    results = search_chunks(space_id, q, limit=limit, source_ids=source_id)
    log_event(
        "search",
        "空间内检索完成",
        space_id=space_id,
        details={
            "query_preview": q[:160],
            "limit": limit,
            "source_scope": source_id or "all_ready_sources",
            "result_count": len(results),
        },
    )
    return {
        "query": q,
        "results": [search_result_response(result) for result in results],
    }
