from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "data"
        outside = Path(tmp) / "outside.txt"
        os.environ["LEARNFAST_DATA_DIR"] = str(root)

        from learnfast.core.config import get_settings
        from learnfast.infrastructure.storage import remove_paths

        get_settings.cache_clear()
        root.mkdir(parents=True)
        outside.write_text("must survive", encoding="utf-8")
        inside = root / "raw" / "source.txt"
        inside.parent.mkdir(parents=True)
        inside.write_text("remove me", encoding="utf-8")

        remove_paths([str(outside), str(inside)])
        assert outside.exists(), "paths outside the data directory must not be removed"
        assert not inside.exists(), "valid data paths should still be removable"

    print("PASS storage safety")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
