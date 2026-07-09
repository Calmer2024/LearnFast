import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from learnfast.infrastructure.storage import database_path, ensure_data_dirs


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    ensure_data_dirs()
    conn = sqlite3.connect(database_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS spaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                goal TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS model_configs (
                provider_id TEXT PRIMARY KEY,
                provider_name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                base_url TEXT,
                default_chat_model TEXT,
                default_embedding_model TEXT,
                capabilities_json TEXT NOT NULL DEFAULT '[]',
                secret_ref TEXT,
                status TEXT NOT NULL DEFAULT 'not_configured',
                error TEXT,
                last_tested_at TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                origin TEXT NOT NULL,
                status TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                raw_path TEXT,
                markdown_path TEXT,
                checksum TEXT,
                version_id TEXT,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                indexed_at TEXT,
                error_code TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                source_id TEXT,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                current_step TEXT NOT NULL DEFAULT '',
                error_code TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS source_chunks (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                version_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                heading_path_json TEXT NOT NULL DEFAULT '[]',
                locator TEXT NOT NULL,
                text TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                char_count INTEGER NOT NULL,
                prev_chunk_id TEXT,
                next_chunk_id TEXT,
                embedding_provider TEXT NOT NULL,
                embedding_model TEXT NOT NULL,
                embedding_dim INTEGER NOT NULL,
                embedding_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_source_chunks_space
                ON source_chunks(space_id);
            CREATE INDEX IF NOT EXISTS idx_source_chunks_source
                ON source_chunks(source_id);
            CREATE INDEX IF NOT EXISTS idx_source_chunks_version
                ON source_chunks(source_id, version_id);

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                parent_message_id TEXT,
                context_snapshot_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(parent_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chat_messages_space_created
                ON chat_messages(space_id, created_at);

            CREATE TABLE IF NOT EXISTS citations (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                chunk_id TEXT NOT NULL,
                source_type TEXT NOT NULL DEFAULT 'source',
                source_id TEXT NOT NULL,
                source_title TEXT NOT NULL,
                version_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                heading_path_json TEXT NOT NULL DEFAULT '[]',
                locator TEXT NOT NULL,
                quote_snapshot TEXT NOT NULL,
                score REAL NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_citations_message
                ON citations(message_id);

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                title TEXT NOT NULL,
                markdown TEXT NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'draft',
                source_type TEXT,
                source_message_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(source_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_notes_space_updated
                ON notes(space_id, updated_at);

            CREATE TABLE IF NOT EXISTS note_chunks (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                note_id TEXT NOT NULL,
                version_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                heading_path_json TEXT NOT NULL DEFAULT '[]',
                locator TEXT NOT NULL,
                text TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                char_count INTEGER NOT NULL,
                prev_chunk_id TEXT,
                next_chunk_id TEXT,
                embedding_provider TEXT NOT NULL,
                embedding_model TEXT NOT NULL,
                embedding_dim INTEGER NOT NULL,
                embedding_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_note_chunks_space
                ON note_chunks(space_id);
            CREATE INDEX IF NOT EXISTS idx_note_chunks_note
                ON note_chunks(note_id);
            CREATE INDEX IF NOT EXISTS idx_note_chunks_version
                ON note_chunks(note_id, version_id);

            CREATE TABLE IF NOT EXISTS memory_settings (
                space_id TEXT PRIMARY KEY,
                auto_extract_enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS memory_candidates (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                layer TEXT NOT NULL,
                content TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_id TEXT,
                source_title TEXT NOT NULL DEFAULT '',
                source_excerpt TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0,
                impact TEXT NOT NULL DEFAULT 'medium',
                status TEXT NOT NULL DEFAULT 'pending',
                content_hash TEXT NOT NULL,
                accepted_memory_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(accepted_memory_id) REFERENCES memories(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_memory_candidates_space_status
                ON memory_candidates(space_id, status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_memory_candidates_source
                ON memory_candidates(space_id, source_type, source_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_candidates_dedupe
                ON memory_candidates(space_id, source_type, IFNULL(source_id, ''), content_hash);

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                layer TEXT NOT NULL,
                content TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_id TEXT,
                source_title TEXT NOT NULL DEFAULT '',
                source_excerpt TEXT NOT NULL DEFAULT '',
                priority INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                candidate_id TEXT,
                content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(candidate_id) REFERENCES memory_candidates(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_memories_space_status
                ON memories(space_id, status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_memories_source
                ON memories(space_id, source_type, source_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_dedupe
                ON memories(space_id, source_type, IFNULL(source_id, ''), content_hash);

            CREATE TABLE IF NOT EXISTS chat_feedback (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                rating TEXT NOT NULL,
                issue_type TEXT,
                note TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
                FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chat_feedback_message
                ON chat_feedback(message_id);

            CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                space_id TEXT,
                level TEXT NOT NULL DEFAULT 'info',
                category TEXT NOT NULL,
                message TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_system_logs_created
                ON system_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_system_logs_space_id
                ON system_logs(space_id, id);
            """
        )
        _ensure_column(conn, "sources", "version_id", "TEXT")
        _ensure_column(conn, "sources", "chunk_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "sources", "indexed_at", "TEXT")
        _ensure_column(conn, "citations", "source_type", "TEXT NOT NULL DEFAULT 'source'")


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return dict(row)


def _ensure_column(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    definition: str,
) -> None:
    columns = {
        row["name"]
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
