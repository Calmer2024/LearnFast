from pathlib import Path
from shutil import rmtree
from typing import Iterable

from learnfast.core.config import get_settings


def data_dir() -> Path:
    return get_settings().data_dir


def ensure_data_dirs() -> None:
    root = data_dir()
    for child in [
        "raw",
        "markdown",
        "artifacts",
        "indexes",
        "exports",
        "logs",
        "secrets",
    ]:
        (root / child).mkdir(parents=True, exist_ok=True)


def database_path() -> Path:
    ensure_data_dirs()
    return data_dir() / "learnfast.sqlite"


def safe_filename(filename: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in filename)
    cleaned = cleaned.strip().strip(".")
    return cleaned or "source"


def raw_source_dir(space_id: str, source_id: str) -> Path:
    path = data_dir() / "raw" / space_id / source_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def markdown_source_dir(space_id: str, source_id: str) -> Path:
    path = data_dir() / "markdown" / space_id / source_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def remove_paths(paths: Iterable[str | None]) -> None:
    for value in paths:
        if not value:
            continue
        path = Path(value)
        if path.is_file():
            path.unlink(missing_ok=True)
        elif path.is_dir():
            rmtree(path, ignore_errors=True)
