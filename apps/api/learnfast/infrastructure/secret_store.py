import json
from pathlib import Path

from learnfast.infrastructure.storage import data_dir, ensure_data_dirs

SERVICE_NAME = "learnfast"


class SecretStore:
    def __init__(self) -> None:
        ensure_data_dirs()
        self.fallback_path = data_dir() / "secrets" / "model-providers.json"

    def set_api_key(self, provider_id: str, api_key: str) -> str:
        secret_ref = f"provider:{provider_id}:api_key"
        try:
            import keyring

            keyring.set_password(SERVICE_NAME, secret_ref, api_key)
            return secret_ref
        except Exception:
            values = self._read_fallback()
            values[secret_ref] = api_key
            self._write_fallback(values)
            return secret_ref

    def get_api_key(self, secret_ref: str | None) -> str | None:
        if not secret_ref:
            return None
        try:
            import keyring

            value = keyring.get_password(SERVICE_NAME, secret_ref)
            if value:
                return value
        except Exception:
            pass
        return self._read_fallback().get(secret_ref)

    def delete_api_key(self, secret_ref: str | None) -> None:
        if not secret_ref:
            return
        try:
            import keyring

            keyring.delete_password(SERVICE_NAME, secret_ref)
        except Exception:
            values = self._read_fallback()
            if secret_ref in values:
                del values[secret_ref]
                self._write_fallback(values)

    def _read_fallback(self) -> dict[str, str]:
        if not self.fallback_path.exists():
            return {}
        try:
            return json.loads(self.fallback_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def _write_fallback(self, values: dict[str, str]) -> None:
        self.fallback_path.parent.mkdir(parents=True, exist_ok=True)
        self.fallback_path.write_text(
            json.dumps(values, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


secret_store = SecretStore()
