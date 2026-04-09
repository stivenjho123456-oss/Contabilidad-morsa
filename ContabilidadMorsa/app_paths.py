import os
import tempfile
from pathlib import Path


APP_NAME = "contabilidad-morsa"
MODULE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODULE_DIR.parent


def _runtime_root():
    configured = os.getenv("MORSA_RUNTIME_DIR", "").strip()
    base = Path(configured) if configured else Path(tempfile.gettempdir()) / APP_NAME
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_app_data_dir():
    return _runtime_root()


def get_log_dir():
    path = get_app_data_dir() / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_supports_dir():
    path = get_app_data_dir() / "supports"
    path.mkdir(parents=True, exist_ok=True)
    return path
