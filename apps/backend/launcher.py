from __future__ import annotations

import ctypes
import json
import logging
import os
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
PORT_SCAN_LIMIT = 20
IDLE_TIMEOUT_SECONDS = float(os.getenv("MORSA_DESKTOP_IDLE_TIMEOUT", "45"))
WINDOW_CLOSE_GRACE_SECONDS = float(os.getenv("MORSA_DESKTOP_CLOSE_GRACE", "4"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("contabilidad_morsa.launcher")


class DesktopLifecycleController:
    def __init__(self, idle_timeout_seconds: float, close_grace_seconds: float):
        self.idle_timeout_seconds = max(idle_timeout_seconds, 0)
        self.close_grace_seconds = max(close_grace_seconds, 0)
        self._last_activity_at = time.monotonic()
        self._has_client_activity = False
        self._shutdown_deadline = None
        self._lock = threading.Lock()
        self.ready = threading.Event()

    def mark_ready(self):
        self.ready.set()

    def touch_activity(self, source: str = "request"):
        with self._lock:
            self._last_activity_at = time.monotonic()
            if source != "launcher-health":
                self._has_client_activity = True
            self._shutdown_deadline = None

    def schedule_shutdown(self, reason: str = "window-closed", delay_seconds: float | None = None):
        with self._lock:
            delay = self.close_grace_seconds if delay_seconds is None else max(delay_seconds, 0)
            self._shutdown_deadline = (time.monotonic() + delay, reason)

    def shutdown_reason(self):
        with self._lock:
            now = time.monotonic()
            if self._shutdown_deadline and now >= self._shutdown_deadline[0]:
                return self._shutdown_deadline[1]
            if self.ready.is_set() and self._has_client_activity and self.idle_timeout_seconds:
                idle_for = now - self._last_activity_at
                if idle_for >= self.idle_timeout_seconds:
                    return f"inactividad ({int(idle_for)}s)"
        return None


def show_error_dialog(title: str, message: str):
    logger.error("%s: %s", title, message)
    if sys.platform == "win32":
        try:
            ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
            return
        except Exception:
            logger.exception("No se pudo abrir el cuadro de error en Windows.")
    print(f"{title}: {message}", file=sys.stderr)


def find_available_port(host: str = HOST, preferred: int = DEFAULT_PORT, limit: int = PORT_SCAN_LIMIT) -> int:
    for port in range(preferred, preferred + limit):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex((host, port)) != 0:
                return port
    raise RuntimeError("No se encontró un puerto libre para iniciar la aplicación.")


def _health_payload(url: str, timeout: float = 1.0):
    with urllib.request.urlopen(f"{url}/health", timeout=timeout) as response:
        if response.status != 200:
            return None
        payload = json.loads(response.read().decode("utf-8"))
        if payload.get("service") != "contabilidad-morsa-api" or payload.get("status") != "ok":
            return None
        return payload


def find_running_instance(host: str = HOST, preferred: int = DEFAULT_PORT, limit: int = PORT_SCAN_LIMIT) -> int | None:
    for port in range(preferred, preferred + limit):
        try:
            payload = _health_payload(f"http://{host}:{port}", timeout=0.5)
        except Exception:
            continue
        if payload:
            return port
    return None


def wait_until_up(url: str, timeout: float = 20.0, controller: DesktopLifecycleController | None = None) -> bool:
    started = time.time()
    while time.time() - started < timeout:
        try:
            payload = _health_payload(url, timeout=1)
            if payload:
                if controller:
                    controller.mark_ready()
                    controller.touch_activity("launcher-health")
                return True
        except Exception:
            time.sleep(0.25)
    return False


def monitor_server_lifecycle(server: uvicorn.Server, controller: DesktopLifecycleController):
    controller.ready.wait(timeout=30)
    while not server.should_exit:
        reason = controller.shutdown_reason()
        if reason:
            logger.info("Cerrando aplicación por %s", reason)
            server.should_exit = True
            return
        time.sleep(1)


def run_server(port: int, controller: DesktopLifecycleController):
    config = uvicorn.Config(app, host=HOST, port=port, log_level="info")
    server = uvicorn.Server(config)
    watcher = threading.Thread(target=monitor_server_lifecycle, args=(server, controller), daemon=True)
    watcher.start()
    server.run()


def open_browser_when_ready(url: str, controller: DesktopLifecycleController):
    if wait_until_up(url, controller=controller):
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
        running_port = find_running_instance()
        if running_port is not None:
            url = f"http://{HOST}:{running_port}"
            logger.info("Instancia existente detectada en %s. Reabriendo navegador.", url)
            webbrowser.open(url)
            return

        controller = DesktopLifecycleController(
            idle_timeout_seconds=IDLE_TIMEOUT_SECONDS,
            close_grace_seconds=WINDOW_CLOSE_GRACE_SECONDS,
        )
        app.state.desktop_controller = controller
        port = find_available_port()
        url = f"http://{HOST}:{port}"
        logger.info("Iniciando Contabilidad Morsa en %s", url)
        browser_thread = threading.Thread(target=open_browser_when_ready, args=(url, controller), daemon=True)
        browser_thread.start()
        run_server(port, controller)
    except Exception as exc:
        logger.exception("Fallo al iniciar la aplicación.")
        show_error_dialog(
            "Contabilidad Morsa",
            f"No se pudo iniciar la aplicación.\n\nDetalle: {exc}\n\nRevisa launcher.log para más información.",
        )
        raise


if __name__ == "__main__":
    main()
