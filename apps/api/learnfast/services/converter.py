from pathlib import Path
from urllib.parse import urlparse

import httpx


class ConversionError(Exception):
    pass


def is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return "youtube.com" in host or "youtu.be" in host


def source_type_for_url(url: str) -> str:
    return "youtube" if is_youtube_url(url) else "webpage"


def convert_to_markdown(source: str | Path) -> str:
    try:
        from markitdown import MarkItDown

        result = MarkItDown().convert(str(source))
        text = getattr(result, "text_content", None)
        if text:
            return text
        return str(result)
    except Exception as exc:
        fallback = _fallback_convert(source)
        if fallback:
            return fallback
        raise ConversionError(str(exc)) from exc


def _fallback_convert(source: str | Path) -> str | None:
    value = str(source)
    if value.startswith("http://") or value.startswith("https://"):
        response = httpx.get(value, timeout=20, follow_redirects=True)
        response.raise_for_status()
        return f"# {value}\n\n```html\n{response.text[:200000]}\n```\n"

    path = Path(value)
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".markdown", ".csv"}:
        return path.read_text(encoding="utf-8", errors="replace")
    return None
