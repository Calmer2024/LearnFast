from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["LEARNFAST_DATA_DIR"] = tmp

        from learnfast.infrastructure.database import get_db, init_db, utc_now
        from learnfast.services.indexer import (
            index_source_markdown,
            list_source_chunks,
            search_chunks,
        )

        init_db()
        now = utc_now()
        space_id = "space-index-test"
        source_id = "source-index-test"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'Index Test', '', 'active', ?, ?)
                """,
                (space_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO sources (
                    id, space_id, type, title, origin, status, enabled,
                    created_at, updated_at
                )
                VALUES (?, ?, 'md', 'Retrieval Notes', 'fixture.md', 'indexing', 1, ?, ?)
                """,
                (source_id, space_id, now, now),
            )

        markdown = """# Retrieval

LearnFast uses Markdown chunking and local embeddings for searchable learning sources.

## Citations

Citations point back to exact source chunks with a heading path and a markdown line locator.

## Storage

The local vector index is persisted in SQLite so it survives app restarts.
"""
        result = index_source_markdown(space_id, {"id": source_id}, markdown)
        with get_db() as conn:
            conn.execute(
                """
                UPDATE sources
                SET status = 'ready', version_id = ?, chunk_count = ?, indexed_at = ?
                WHERE id = ?
                """,
                (result.version_id, result.chunk_count, result.indexed_at, source_id),
            )

        chunks = list_source_chunks(space_id, source_id)
        assert result.chunk_count == len(chunks)
        assert chunks[0]["heading_path"] == ["Retrieval"]
        assert chunks[0]["locator"].startswith("markdown:line=")
        assert chunks[0]["version_id"] == result.version_id

        citation_results = search_chunks(space_id, "exact source chunks heading locator")
        assert citation_results, "expected citation search result"
        assert citation_results[0].source_id == source_id
        assert "markdown:line=" in citation_results[0].locator

        newer = index_source_markdown(
            space_id,
            {"id": source_id},
            "# Updated\n\nA newer version discusses embeddings and indexing only.",
        )
        new_chunks = list_source_chunks(space_id, source_id)
        assert newer.version_id != result.version_id
        assert len(new_chunks) == newer.chunk_count
        assert all(chunk["version_id"] == newer.version_id for chunk in new_chunks)

        with get_db() as conn:
            conn.execute("UPDATE sources SET status = 'ready', enabled = 0 WHERE id = ?", (source_id,))
        assert search_chunks(space_id, "embeddings indexing") == []

        with get_db() as conn:
            conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
            remaining = conn.execute(
                "SELECT COUNT(*) AS count FROM source_chunks WHERE source_id = ?",
                (source_id,),
            ).fetchone()["count"]
        assert remaining == 0

    print("PASS indexing pipeline")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
