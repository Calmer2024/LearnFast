import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, UploadFile
from pydantic import BaseModel, Field, HttpUrl

from learnfast.api.routes.spaces import require_space
from learnfast.core.errors import bad_request, not_found
from learnfast.core.limits import (
    ALLOWED_FILE_EXTENSIONS,
    MAX_BATCH_UPLOAD_FILES,
    MAX_FILE_SIZE_BYTES,
    MAX_FILE_SIZE_MB,
    MAX_SOURCES_PER_SPACE,
)
from learnfast.infrastructure.database import get_db, row_to_dict, utc_now
from learnfast.infrastructure.storage import (
    markdown_source_dir,
    raw_source_dir,
    remove_paths,
    safe_filename,
)
from learnfast.services.converter import convert_to_markdown, source_type_for_url
from learnfast.services.indexer import index_source_markdown, list_source_chunks
from learnfast.services.system_logs import log_event

router = APIRouter(tags=["sources"])


class UrlImportIn(BaseModel):
    url: HttpUrl
    title: str | None = Field(default=None, max_length=200)


class SourceUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None


def _source_response(row: dict) -> dict:
    return {
        **row,
        "enabled": bool(row["enabled"]),
    }


def _get_source(space_id: str, source_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM sources WHERE id = ? AND space_id = ?",
            (source_id, space_id),
        ).fetchone()
    source = row_to_dict(row)
    if not source:
        raise not_found("Source not found.")
    return source


def _ensure_source_capacity(space_id: str, new_count: int) -> None:
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS count FROM sources WHERE space_id = ?",
            (space_id,),
        ).fetchone()["count"]
    if count + new_count > MAX_SOURCES_PER_SPACE:
        raise bad_request(f"MVP allows at most {MAX_SOURCES_PER_SPACE} sources per space.")


def _create_job(space_id: str, source_id: str, job_type: str) -> str:
    job_id = str(uuid4())
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                id, space_id, source_id, type, status, progress, current_step,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'queued', 0, 'Waiting to process source.', ?, ?)
            """,
            (job_id, space_id, source_id, job_type, now, now),
        )
    return job_id


def _update_job(job_id: str, status: str, progress: int, step: str, error: str | None = None) -> None:
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE jobs
            SET status = ?, progress = ?, current_step = ?, error_message = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, progress, step, error, now, job_id),
        )


def _set_source_status(
    source_id: str,
    status: str,
    markdown_path: str | None = None,
    version_id: str | None = None,
    chunk_count: int | None = None,
    indexed_at: str | None = None,
    error_message: str | None = None,
    error_code: str | None = None,
) -> None:
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE sources
            SET status = ?,
                markdown_path = COALESCE(?, markdown_path),
                version_id = COALESCE(?, version_id),
                chunk_count = COALESCE(?, chunk_count),
                indexed_at = COALESCE(?, indexed_at),
                error_message = ?,
                error_code = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                markdown_path,
                version_id,
                chunk_count,
                indexed_at,
                error_message,
                error_code if error_message else None,
                now,
                source_id,
            ),
        )


def _clear_source_index(source_id: str) -> None:
    now = utc_now()
    with get_db() as conn:
        conn.execute("DELETE FROM source_chunks WHERE source_id = ?", (source_id,))
        conn.execute(
            """
            UPDATE sources
            SET version_id = NULL, chunk_count = 0, indexed_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (now, source_id),
        )


def _checksum(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def process_source_job(space_id: str, source_id: str, job_id: str) -> None:
    source = _get_source(space_id, source_id)
    error_code = "CONVERSION_ERROR"
    try:
        log_event(
            "source",
            "资料处理开始",
            space_id=space_id,
            details={
                "job_id": job_id,
                "source_id": source_id,
                "title": source["title"],
                "type": source["type"],
            },
        )
        _update_job(job_id, "running", 10, "Preparing source.")
        _clear_source_index(source_id)
        _set_source_status(source_id, "converting")
        _update_job(job_id, "running", 35, "Converting source to Markdown.")
        log_event(
            "source",
            "开始转换资料为 Markdown",
            space_id=space_id,
            details={"job_id": job_id, "source_id": source_id, "title": source["title"]},
        )
        conversion_input = source["raw_path"] if source["raw_path"] else source["origin"]
        markdown = convert_to_markdown(conversion_input)
        markdown_file = markdown_source_dir(space_id, source_id) / "current.md"
        markdown_file.write_text(markdown, encoding="utf-8")
        _update_job(job_id, "running", 55, "Saving Markdown preview.")
        _set_source_status(source_id, "converted", str(markdown_file))
        error_code = "INDEXING_ERROR"
        _update_job(job_id, "running", 70, "Chunking Markdown.")
        _set_source_status(source_id, "chunking")
        _update_job(job_id, "running", 85, "Generating embeddings and writing local index.")
        _set_source_status(source_id, "indexing")
        log_event(
            "source",
            "开始分块、生成向量并写入本地索引",
            space_id=space_id,
            details={
                "job_id": job_id,
                "source_id": source_id,
                "title": source["title"],
                "markdown_chars": len(markdown),
            },
        )
        result = index_source_markdown(space_id, source, markdown)
        _set_source_status(
            source_id,
            "ready",
            str(markdown_file),
            version_id=result.version_id,
            chunk_count=result.chunk_count,
            indexed_at=result.indexed_at,
        )
        _update_job(job_id, "completed", 100, "Source is indexed and ready.")
        log_event(
            "source",
            "资料已完成索引，可用于问答",
            space_id=space_id,
            details={
                "job_id": job_id,
                "source_id": source_id,
                "title": source["title"],
                "version_id": result.version_id,
                "chunk_count": result.chunk_count,
            },
        )
    except Exception as exc:
        message = str(exc)
        _set_source_status(
            source_id,
            "failed",
            error_message=message,
            error_code=error_code,
        )
        _update_job(job_id, "failed", 100, "Source processing failed.", message)
        log_event(
            "source",
            "资料处理失败",
            level="error",
            space_id=space_id,
            details={
                "job_id": job_id,
                "source_id": source_id,
                "title": source["title"],
                "error_code": error_code,
                "error": message,
            },
        )


@router.get("/spaces/{space_id}/sources")
def list_sources(space_id: str) -> list[dict]:
    require_space(space_id)
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT * FROM sources
                WHERE space_id = ?
                ORDER BY created_at DESC
                """,
                (space_id,),
            ).fetchall()
        ]
    return [_source_response(row) for row in rows]


@router.post("/spaces/{space_id}/sources/files")
async def upload_files(
    space_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
) -> list[dict]:
    require_space(space_id)
    if len(files) > MAX_BATCH_UPLOAD_FILES:
        raise bad_request(f"Upload at most {MAX_BATCH_UPLOAD_FILES} files at once.")
    _ensure_source_capacity(space_id, len(files))

    created: list[dict] = []
    for upload in files:
        filename = safe_filename(upload.filename or "source")
        suffix = Path(filename).suffix.lower()
        if suffix not in ALLOWED_FILE_EXTENSIONS:
            raise bad_request(f"Unsupported file type: {suffix or 'unknown'}.")
        content = await upload.read()
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise bad_request(f"{filename} exceeds the {MAX_FILE_SIZE_MB} MB MVP limit.")

        source_id = str(uuid4())
        raw_path = raw_source_dir(space_id, source_id) / filename
        raw_path.write_bytes(content)
        now = utc_now()
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO sources (
                    id, space_id, type, title, origin, status, enabled,
                    raw_path, checksum, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'uploaded', 1, ?, ?, ?, ?)
                """,
                (
                    source_id,
                    space_id,
                    suffix.lstrip("."),
                    filename,
                    filename,
                    str(raw_path),
                    _checksum(content),
                    now,
                    now,
                ),
            )
        job_id = _create_job(space_id, source_id, "source_convert")
        log_event(
            "source",
            "文件资料已上传并加入处理队列",
            space_id=space_id,
            details={
                "job_id": job_id,
                "source_id": source_id,
                "title": filename,
                "type": suffix.lstrip("."),
                "file_size_bytes": len(content),
            },
        )
        background_tasks.add_task(process_source_job, space_id, source_id, job_id)
        source = _get_source(space_id, source_id)
        created.append({**_source_response(source), "job_id": job_id})
    return created


@router.post("/spaces/{space_id}/sources/url")
def import_url(space_id: str, payload: UrlImportIn, background_tasks: BackgroundTasks) -> dict:
    require_space(space_id)
    _ensure_source_capacity(space_id, 1)
    url = str(payload.url)
    source_id = str(uuid4())
    source_type = source_type_for_url(url)
    title = payload.title or url
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO sources (
                id, space_id, type, title, origin, status, enabled,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 'imported', 1, ?, ?)
            """,
            (source_id, space_id, source_type, title, url, now, now),
        )
    job_id = _create_job(space_id, source_id, "source_import")
    log_event(
        "source",
        "链接资料已加入处理队列",
        space_id=space_id,
        details={
            "job_id": job_id,
            "source_id": source_id,
            "title": title,
            "type": source_type,
            "url": url,
        },
    )
    background_tasks.add_task(process_source_job, space_id, source_id, job_id)
    return {**_source_response(_get_source(space_id, source_id)), "job_id": job_id}


@router.get("/spaces/{space_id}/sources/{source_id}")
def get_source(space_id: str, source_id: str) -> dict:
    require_space(space_id)
    return _source_response(_get_source(space_id, source_id))


@router.get("/spaces/{space_id}/sources/{source_id}/markdown")
def get_source_markdown(space_id: str, source_id: str) -> dict:
    require_space(space_id)
    source = _get_source(space_id, source_id)
    markdown_path = source.get("markdown_path")
    if not markdown_path:
        raise bad_request("Markdown is not ready for this source.")
    path = Path(markdown_path)
    if not path.exists():
        raise not_found("Markdown file not found.")
    return {
        "source_id": source_id,
        "title": source["title"],
        "markdown": path.read_text(encoding="utf-8", errors="replace"),
    }


@router.get("/spaces/{space_id}/sources/{source_id}/chunks")
def get_source_chunks(space_id: str, source_id: str) -> list[dict]:
    require_space(space_id)
    _get_source(space_id, source_id)
    return list_source_chunks(space_id, source_id)


@router.patch("/spaces/{space_id}/sources/{source_id}")
def update_source(space_id: str, source_id: str, payload: SourceUpdateIn) -> dict:
    require_space(space_id)
    _get_source(space_id, source_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise bad_request("No fields to update.")
    fields: list[str] = []
    params: list[object] = []
    if "title" in values and values["title"] is not None:
        fields.append("title = ?")
        params.append(values["title"].strip())
    if "enabled" in values and values["enabled"] is not None:
        fields.append("enabled = ?")
        params.append(1 if values["enabled"] else 0)
    fields.append("updated_at = ?")
    params.append(utc_now())
    params.extend([source_id, space_id])
    with get_db() as conn:
        conn.execute(
            f"UPDATE sources SET {', '.join(fields)} WHERE id = ? AND space_id = ?",
            tuple(params),
        )
    log_event(
        "source",
        "资料设置已更新",
        space_id=space_id,
        details={"source_id": source_id, "changes": values},
    )
    return _source_response(_get_source(space_id, source_id))


@router.post("/spaces/{space_id}/sources/{source_id}/retry")
def retry_source(space_id: str, source_id: str, background_tasks: BackgroundTasks) -> dict:
    require_space(space_id)
    _get_source(space_id, source_id)
    _clear_source_index(source_id)
    _set_source_status(source_id, "queued", error_message=None)
    job_id = _create_job(space_id, source_id, "source_convert")
    log_event(
        "source",
        "资料已重新加入处理队列",
        space_id=space_id,
        details={"job_id": job_id, "source_id": source_id},
    )
    background_tasks.add_task(process_source_job, space_id, source_id, job_id)
    return {**_source_response(_get_source(space_id, source_id)), "job_id": job_id}


@router.delete("/spaces/{space_id}/sources/{source_id}")
def delete_source(space_id: str, source_id: str) -> dict:
    require_space(space_id)
    source = _get_source(space_id, source_id)
    with get_db() as conn:
        conn.execute("DELETE FROM sources WHERE id = ? AND space_id = ?", (source_id, space_id))
    remove_paths([source.get("raw_path"), source.get("markdown_path")])
    log_event(
        "source",
        "资料已删除，相关索引不再参与新检索",
        level="warn",
        space_id=space_id,
        details={"source_id": source_id, "title": source["title"]},
    )
    return {"deleted": True, "id": source_id}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    job = row_to_dict(row)
    if not job:
        raise not_found("Job not found.")
    return job
