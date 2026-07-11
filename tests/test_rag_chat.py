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
        from learnfast.api.routes.chat import (
            FeedbackIn,
            SaveNoteIn,
            list_chat_messages,
            save_chat_answer_as_note,
            submit_chat_feedback,
        )
        from learnfast.services.indexer import index_source_markdown, search_chunks
        from learnfast.services.memory_service import (
            active_memory_context,
            create_memory,
            delete_memory,
        )
        from learnfast.services.rag_chat import citation_response, retrieve_for_question, stream_answer

        init_db()
        now = utc_now()
        space_id = "space-rag-test"
        pandas_source = "source-pandas"
        sql_source = "source-sql"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO spaces (id, name, goal, status, created_at, updated_at)
                VALUES (?, 'RAG Test', '', 'active', ?, ?)
                """,
                (space_id, now, now),
            )
            for source_id, title in [
                (pandas_source, "Pandas Notes"),
                (sql_source, "SQL Notes"),
            ]:
                conn.execute(
                    """
                    INSERT INTO sources (
                        id, space_id, type, title, origin, status, enabled,
                        created_at, updated_at
                    )
                    VALUES (?, ?, 'md', ?, ?, 'indexing', 1, ?, ?)
                    """,
                    (source_id, space_id, title, f"{source_id}.md", now, now),
                )

        pandas_index = index_source_markdown(
            space_id,
            {"id": pandas_source},
            """
# Pandas Cleaning

Pandas cleaning includes missing value handling, type conversion, duplicate removal, and outlier checks.
""",
        )
        sql_index = index_source_markdown(
            space_id,
            {"id": sql_source},
            """
# SQL Joins

SQL joins combine rows across tables with matching keys.
""",
        )
        with get_db() as conn:
            conn.execute(
                """
                UPDATE sources
                SET status = 'ready', version_id = ?, chunk_count = ?, indexed_at = ?
                WHERE id = ?
                """,
                (pandas_index.version_id, pandas_index.chunk_count, pandas_index.indexed_at, pandas_source),
            )
            conn.execute(
                """
                UPDATE sources
                SET status = 'ready', version_id = ?, chunk_count = ?, indexed_at = ?
                WHERE id = ?
                """,
                (sql_index.version_id, sql_index.chunk_count, sql_index.indexed_at, sql_source),
            )

        empty_scope_results = search_chunks(space_id, "pandas cleaning", source_ids=[])
        assert empty_scope_results == [], "empty source scope must not search all sources"

        citations, trace = retrieve_for_question(
            space_id,
            "What are pandas cleaning steps?",
            source_ids=[pandas_source],
            use_mqe=True,
            use_hyde=True,
        )
        assert citations, "expected RAG citations"
        assert trace.mqe_used
        assert trace.hyde_used
        assert trace.hyde_document
        assert all(citation.source_id == pandas_source for citation in citations)
        assert all("假设学习资料" not in citation.quote_snapshot for citation in citations)
        citation_payload = citation_response(citations[0])
        assert citation_payload["text"] == citations[0].text
        assert "Pandas cleaning includes" in citation_payload["text"]
        assert citation_payload["quote_snapshot"]

        answer = "".join(stream_answer("What are pandas cleaning steps?", citations, trace))
        assert "Pandas Notes" in answer
        assert "[1]" in answer
        memory = create_memory(
            space_id=space_id,
            layer="learning_ability",
            content="用户需要重点复习 merge 与 concat 的差异。",
            source_type="manual",
            source_title="手动记忆",
            priority=2,
        )
        personalized = "".join(
            stream_answer(
                "What are pandas cleaning steps?",
                citations,
                trace,
                active_memory_context(space_id),
            )
        )
        assert "merge 与 concat" in personalized
        delete_memory(space_id, memory["id"])
        forgotten = "".join(
            stream_answer(
                "What are pandas cleaning steps?",
                citations,
                trace,
                active_memory_context(space_id),
            )
        )
        assert "merge 与 concat" not in forgotten

        user_message_id = "chat-user"
        assistant_message_id = "chat-assistant"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, space_id, role, content, parent_message_id,
                    context_snapshot_json, created_at
                )
                VALUES (?, ?, 'user', 'What are pandas cleaning steps?', NULL, '{}', ?)
                """,
                (user_message_id, space_id, now),
            )
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, space_id, role, content, parent_message_id,
                    context_snapshot_json, created_at
                )
                VALUES (?, ?, 'assistant', ?, ?, '{}', ?)
                """,
                (assistant_message_id, space_id, answer, user_message_id, now),
            )
            first = citations[0]
            conn.execute(
                """
                INSERT INTO citations (
                    id, space_id, message_id, chunk_id, source_id, source_title,
                    version_id, ordinal, heading_path_json, locator,
                    quote_snapshot, score, created_at
                )
                VALUES (
                    'citation-test', ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?
                )
                """,
                (
                    space_id,
                    assistant_message_id,
                    first.chunk_id,
                    first.source_id,
                    first.source_title,
                    first.version_id,
                    first.ordinal,
                    first.locator,
                    first.quote_snapshot,
                    first.score,
                    now,
                ),
            )

        note = save_chat_answer_as_note(space_id, assistant_message_id, SaveNoteIn())
        assert "原问题" in note["markdown"]
        assert "引用" in note["markdown"]
        note_search_results = search_chunks(space_id, "pandas cleaning original question")
        assert any(
            result.source_type == "note" and result.source_id == note["id"]
            for result in note_search_results
        ), "saved chat answer note should be searchable"
        feedback = submit_chat_feedback(
            space_id,
            assistant_message_id,
            FeedbackIn(rating="up"),
        )
        assert feedback["rating"] == "up"
        messages = list_chat_messages(space_id)
        assert messages[-1]["citations"], "assistant message should include citations"

    print("PASS rag chat")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
