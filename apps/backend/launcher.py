from __future__ import annotations

import ctypes
import logging
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn


def _bootstrap_import_paths():
    if getattr(sys, "frozen", False):
        bundle_root = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        candidates = [
            bundle_root / "ContabilidadMorsa",
            bundle_root,
        ]
    else:
        root_dir = Path(__file__).resolve().parents[2]
        candidates = [
            root_dir / "ContabilidadMorsa",
            root_dir / "apps" / "backend",
        ]

    for candidate in candidates:
        if candidate.exists() and str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))


_bootstrap_import_paths()

from app_paths import get_log_dir
from app.main import app


HOST = "127.0.0.1"
DEFAULT_PORT = 8010
LOG_FILE = get_log_dir() / "launcher.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("contabilidad_morsa.launcher")


def show_error_dialog(title: str, message: str):
    logger.error("%s: %s", title, message)
    if sys.platform == "win32":
        try:
            ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
            return
        except Exception:
            logger.exception("No se pudo abrir el cuadro de error en Windows.")
    print(f"{title}: {message}", file=sys.stderr)


def find_available_port(host: str = HOST, preferred: int = DEFAULT_PORT, limit: int = 20) -> int:
    for port in range(preferred, preferred + limit):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex((host, port)) != 0:
                return port
    raise RuntimeError("No se encontró un puerto libre para iniciar la aplicación.")


def wait_until_up(url: str, timeout: float = 20.0) -> bool:
    started = time.time()
    while time.time() - started < timeout:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def run_server(port: int):
    config = uvicorn.Config(app, host=HOST, port=port, log_level="info")
    server = uvicorn.Server(config)
    server.run()


def open_browser_when_ready(url: str):
    if wait_until_up(url):
        try:
            webbrowser.open(url)
        except Exception:
            logger.exception("No se pudo abrir el navegador automáticamente.")
    else:
        show_error_dialog(
            "Contabilidad Morsa",
            "La aplicación no respondió a tiempo. Revisa el archivo launcher.log en la carpeta de logs.",
        )


def main():
    try:
        port = find_available_port()
        url = f"http://{HOST}:{port}"
        logger.info("Iniciando Contabilidad Morsa en %s", url)
        browser_thread = threading.Thread(target=open_browser_when_ready, args=(url,), daemon=True)
        browser_thread.start()
        run_server(port)
    except Exception as exc:
        logger.exception("Fallo al iniciar la aplicación.")
        show_error_dialog(
            "Contabilidad Morsa",
            f"No se pudo iniciar la aplicación.\n\nDetalle: {exc}\n\nRevisa launcher.log para más información.",
        )
        raise


if __name__ == "__main__":
    main()
