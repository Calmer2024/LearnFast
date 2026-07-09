from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass


MAX_CHUNK_CHARS = 1800


@dataclass(frozen=True)
class MarkdownChunk:
    ordinal: int
    heading_path: list[str]
    locator: str
    text: str
    content_hash: str
    start_line: int
    end_line: int
    char_count: int


@dataclass(frozen=True)
class MarkdownBlock:
    kind: str
    heading_path: list[str]
    start_line: int
    end_line: int
    text: str


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")


def chunk_markdown(markdown: str, max_chars: int = MAX_CHUNK_CHARS) -> list[MarkdownChunk]:
    blocks = _collect_blocks(markdown)
    chunks: list[MarkdownChunk] = []
    current: list[MarkdownBlock] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        text = "\n\n".join(block.text.strip() for block in current if block.text.strip()).strip()
        if not text:
            current = []
            return
        start_line = min(block.start_line for block in current)
        end_line = max(block.end_line for block in current)
        heading_path = _best_heading_path(current)
        chunks.append(
            MarkdownChunk(
                ordinal=len(chunks),
                heading_path=heading_path,
                locator=f"markdown:line={start_line}-{end_line}",
                text=text,
                content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                start_line=start_line,
                end_line=end_line,
                char_count=len(text),
            )
        )
        current = []

    for block in blocks:
        if block.kind == "heading" and current:
            flush()

        next_size = _blocks_size(current) + len(block.text) + (2 if current else 0)
        if current and next_size > max_chars:
            flush()
        current.append(block)

    flush()
    return chunks


def _collect_blocks(markdown: str) -> list[MarkdownBlock]:
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[MarkdownBlock] = []
    heading_stack: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        line_no = index + 1
        stripped = line.strip()

        if not stripped:
            index += 1
            continue

        heading_match = _HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(title)
            blocks.append(
                MarkdownBlock(
                    kind="heading",
                    heading_path=list(heading_stack),
                    start_line=line_no,
                    end_line=line_no,
                    text=line,
                )
            )
            index += 1
            continue

        if stripped.startswith("```") or stripped.startswith("~~~"):
            fence = stripped[:3]
            start = index
            index += 1
            while index < len(lines) and not lines[index].strip().startswith(fence):
                index += 1
            if index < len(lines):
                index += 1
            blocks.append(_block("code", heading_stack, lines, start, index - 1))
            continue

        if stripped.startswith("|"):
            start = index
            while index < len(lines) and lines[index].strip().startswith("|"):
                index += 1
            blocks.append(_block("table", heading_stack, lines, start, index - 1))
            continue

        if stripped.startswith(">"):
            start = index
            while index < len(lines) and lines[index].strip().startswith(">"):
                index += 1
            blocks.append(_block("quote", heading_stack, lines, start, index - 1))
            continue

        if _LIST_RE.match(line):
            start = index
            index += 1
            while index < len(lines):
                candidate = lines[index]
                if not candidate.strip():
                    break
                candidate_stripped = candidate.strip()
                if (
                    _HEADING_RE.match(candidate)
                    or candidate_stripped.startswith("```")
                    or candidate_stripped.startswith("~~~")
                    or candidate_stripped.startswith("|")
                    or candidate_stripped.startswith(">")
                ):
                    break
                index += 1
            blocks.append(_block("list", heading_stack, lines, start, index - 1))
            continue

        start = index
        index += 1
        while index < len(lines):
            candidate = lines[index]
            if not candidate.strip() or _is_special_block_start(candidate):
                break
            index += 1
        blocks.append(_block("paragraph", heading_stack, lines, start, index - 1))

    return blocks


def _block(
    kind: str,
    heading_stack: list[str],
    lines: list[str],
    start: int,
    end: int,
) -> MarkdownBlock:
    return MarkdownBlock(
        kind=kind,
        heading_path=list(heading_stack),
        start_line=start + 1,
        end_line=end + 1,
        text="\n".join(lines[start : end + 1]),
    )


def _is_special_block_start(line: str) -> bool:
    stripped = line.strip()
    return (
        bool(_HEADING_RE.match(line))
        or stripped.startswith("```")
        or stripped.startswith("~~~")
        or stripped.startswith("|")
        or stripped.startswith(">")
        or bool(_LIST_RE.match(line))
    )


def _blocks_size(blocks: list[MarkdownBlock]) -> int:
    return sum(len(block.text) for block in blocks) + max(0, len(blocks) - 1) * 2


def _best_heading_path(blocks: list[MarkdownBlock]) -> list[str]:
    for block in reversed(blocks):
        if block.heading_path:
            return list(block.heading_path)
    return []
