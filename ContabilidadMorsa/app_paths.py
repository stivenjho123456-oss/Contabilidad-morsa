import os
import sys
from pathlib import Path


APP_NAME = 'Contabilidad Morsa'
MODULE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODULE_DIR.parent


def _user_data_root():
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support'
    if os.name == 'nt':
        base = os.environ.get('APPDATA')
        return Path(base) if base else Path.home() / 'AppData' / 'Roaming'
    base = os.environ.get('XDG_DATA_HOME')
    return Path(base) if base else Path.home() / '.local' / 'share'


def get_app_data_dir():
    path = _user_data_root() / APP_NAME
    try:
        path.mkdir(parents=True, exist_ok=True)
        return path
    except PermissionError:
        fallback = PROJECT_ROOT / '.appdata'
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def get_log_dir():
    path = get_app_data_dir() / 'logs'
    try:
        path.mkdir(parents=True, exist_ok=True)
        return path
    except PermissionError:
        fallback = PROJECT_ROOT / '.appdata' / 'logs'
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def get_supports_dir():
    path = get_app_data_dir() / 'supports'
    try:
        path.mkdir(parents=True, exist_ok=True)
        return path
    except PermissionError:
        fallback = PROJECT_ROOT / '.appdata' / 'supports'
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def get_resource_root():
    if getattr(sys, 'frozen', False):
        return Path(getattr(sys, '_MEIPASS', Path(sys.executable).resolve().parent))
    return PROJECT_ROOT


def bundled_resource_path(filename):
    return get_resource_root() / filename


def user_data_file(filename):
    return get_app_data_dir() / filename


def default_writable_excel_path(filename):
    user_copy = user_data_file(filename)
    if user_copy.exists():
        return user_copy
    bundled = bundled_resource_path(filename)
    if bundled.exists():
        return bundled
    return user_copy
