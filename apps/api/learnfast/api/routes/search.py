from fastapi import APIRouter, Query

from learnfast.api.routes.spaces import require_space
from learnfast.services.search_service import search_space_items
from learnfast.services.system_logs import log_event

router = APIRouter(tags=["search"])


@router.get("/spaces/{space_id}/search")
def search_space(
    space_id: str,
    q: str = Query(..., min_length=1),
    limit: int = Query(default=30, ge=1, le=50),
    source_id: list[str] | None = Query(default=None),
) -> dict:
    require_space(space_id)
    source_scope = source_id if isinstance(source_id, list) else None
    results = search_space_items(space_id, q, limit=limit, source_ids=source_scope)
    log_event(
        "search",
        "空间内统一搜索完成",
        space_id=space_id,
        details={
            "query_preview": q[:160],
            "limit": limit,
            "source_scope": source_scope or "all_space_items",
            "result_count": len(results),
            "result_types": sorted({result["result_type"] for result in results}),
        },
    )
    return {
        "query": q,
        "results": results,
    }
