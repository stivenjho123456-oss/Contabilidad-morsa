from pathlib import Path
import os
import sys

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
CORE_APP_DIR = ROOT / "ContabilidadMorsa"
if str(CORE_APP_DIR) not in sys.path:
    sys.path.insert(0, str(CORE_APP_DIR))


def _has_pg_config():
    if os.getenv("DATABASE_URL", "").strip():
        return True
    return bool(os.getenv("PG_HOST", "").strip() and os.getenv("PG_PASSWORD", "").strip())


if not _has_pg_config():
    raise SystemExit("Define DATABASE_URL o PG_HOST/PG_PASSWORD para ejecutar postgres_smoke_test.py.")


from app.main import app  # noqa: E402


def run():
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200, health.text
        payload = health.json()
        assert payload["status"] == "ok", payload
        assert payload["db_health"]["backend"] == "postgresql", payload
        assert payload["db_health"]["ok"] is True, payload
        assert payload["schema_status"]["ok"] is True, payload

        auth_status = client.get("/api/auth/status")
        assert auth_status.status_code == 200, auth_status.text
        auth_data = auth_status.json()["data"]
        assert auth_data["requires_setup"] is False, auth_data

    print("PostgreSQL cloud smoke test OK")


if __name__ == "__main__":
    run()
