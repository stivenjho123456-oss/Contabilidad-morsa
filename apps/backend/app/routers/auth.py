from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.requests import Request

from auth_service import (
    PREGUNTAS_MINIMAS,
    PREGUNTAS_SUGERIDAS,
    SESSION_HEADER as API_TOKEN_HEADER,
    SESSION_SCHEME as API_TOKEN_SCHEME,
    auth_status as get_auth_status,
    authenticate_user,
    bootstrap_admin_account,
    configurar_preguntas,
    preguntas_publicas,
    recuperar_con_preguntas,
    resolve_session,
    revoke_session,
)
from database import get_preguntas_usuario
from database import get_connection
from routers.utils import api_ok, client_ip, handle_validation

logger = logging.getLogger("contabilidad_morsa.backend")
router = APIRouter(prefix="/api/auth", tags=["auth"])

_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW_MINUTES = 15
_LOGIN_LOCKOUT_MINUTES = 15


def _check_login_rate(ip: str, username: str = ""):
    """Bloquea por IP y tambien por cuenta.

    Limitar solo por IP dejaria a alguien rotando de direccion adivinar sin techo
    las respuestas de una misma cuenta, que es justo el ataque que importa contra
    la recuperacion por preguntas.
    """
    now = datetime.utcnow()
    window_start = (now - timedelta(minutes=_LOGIN_WINDOW_MINUTES)).isoformat()
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM login_attempts WHERE ip_address = ? AND attempted_at > ? AND success = 0",
            (ip, window_start),
        ).fetchone()
        failures = int(row[0]) if row else 0

        if failures < _LOGIN_MAX_ATTEMPTS and username:
            row_user = conn.execute(
                "SELECT COUNT(*) FROM login_attempts WHERE username = ? AND attempted_at > ? AND success = 0",
                (username.strip().lower(), window_start),
            ).fetchone()
            failures = max(failures, int(row_user[0]) if row_user else 0)

        if failures >= _LOGIN_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail=f"Demasiados intentos fallidos. Intenta de nuevo en {_LOGIN_LOCKOUT_MINUTES} minutos.",
            )
    finally:
        conn.close()


def _record_login_attempt(ip: str, *, success: bool, username: str = ""):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO login_attempts (ip_address, attempted_at, success, username) VALUES (?, ?, ?, ?)",
            (ip, now, 1 if success else 0, (username or "").strip().lower() or None),
        )
        # Limpia intentos viejos (> 24h) para no crecer indefinidamente
        cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()
        conn.execute("DELETE FROM login_attempts WHERE attempted_at < ?", (cutoff,))
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        conn.close()
    if not success:
        logger.warning("Login fallido — IP: %s", ip)


def _parse_bearer_token(header_value: str | None) -> str:
    raw = (header_value or "").strip()
    if not raw:
        return ""
    parts = raw.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == API_TOKEN_SCHEME.lower():
        return parts[1].strip()
    return ""


# ── Payloads ──────────────────────────────────────────────────────────────────

class AuthLoginPayload(BaseModel):
    username: str
    password: str


class AuthBootstrapPayload(BaseModel):
    username: str
    full_name: str
    password: str
    password_confirm: str


class PreguntaItem(BaseModel):
    pregunta: str
    respuesta: str


class ConfigurarPreguntasPayload(BaseModel):
    password_actual: str
    preguntas: list[PreguntaItem]


class RespuestaItem(BaseModel):
    orden: int
    respuesta: str


class PreguntasDeUsuarioPayload(BaseModel):
    username: str


class RecuperarPayload(BaseModel):
    username: str
    respuestas: list[RespuestaItem]
    password: str
    password_confirm: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
def auth_status():
    return api_ok(get_auth_status())


@router.post("/bootstrap")
def auth_bootstrap(payload: AuthBootstrapPayload, request: Request):
    if payload.password != payload.password_confirm:
        raise HTTPException(status_code=400, detail="La confirmación de contraseña no coincide.")
    try:
        session = bootstrap_admin_account(
            payload.username,
            payload.full_name,
            payload.password,
            user_agent=request.headers.get("user-agent", ""),
            ip_address=client_ip(request),
        )
        return api_ok(session, message="Cuenta inicial creada correctamente.")
    except Exception as exc:
        handle_validation(exc)


@router.post("/login")
def auth_login(payload: AuthLoginPayload, request: Request):
    ip = client_ip(request)
    _check_login_rate(ip, payload.username)
    session = authenticate_user(
        payload.username,
        payload.password,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=ip,
    )
    if not session:
        _record_login_attempt(ip, success=False, username=payload.username)
        raise HTTPException(status_code=401, detail="Credenciales inválidas.")
    _record_login_attempt(ip, success=True, username=payload.username)
    return api_ok(session, message="Sesión iniciada.")


@router.get("/session")
def auth_session(request: Request):
    session = getattr(request.state, "auth_session", None)
    if not session:
        raise HTTPException(status_code=401, detail="Sesión inválida o vencida.")
    return api_ok({
        "header": API_TOKEN_HEADER,
        "scheme": API_TOKEN_SCHEME,
        "expires_at": session["expires_at"],
        "user": session["user"],
    })


@router.post("/logout")
def auth_logout(request: Request):
    revoke_session(_parse_bearer_token(request.headers.get(API_TOKEN_HEADER, "")))
    return api_ok(message="Sesión cerrada correctamente.")


# ── Recuperación por preguntas de seguridad ──────────────────────────────────

@router.get("/preguntas")
def mis_preguntas(request: Request):
    """Devuelve las preguntas que el usuario logueado tiene configuradas."""
    session = getattr(request.state, "auth_session", None)
    if not session:
        raise HTTPException(status_code=401, detail="Sesión inválida o vencida.")
    configuradas = get_preguntas_usuario(session["user"]["id"])
    return api_ok({
        "configuradas": [{"orden": p["orden"], "pregunta": p["pregunta"]} for p in configuradas],
        "sugeridas": PREGUNTAS_SUGERIDAS,
        "minimo": PREGUNTAS_MINIMAS,
    })


@router.post("/preguntas")
def guardar_preguntas(payload: ConfigurarPreguntasPayload, request: Request):
    """Configura o reemplaza las preguntas del usuario logueado."""
    session = getattr(request.state, "auth_session", None)
    if not session:
        raise HTTPException(status_code=401, detail="Sesión inválida o vencida.")
    try:
        resultado = configurar_preguntas(
            session["user"]["id"],
            payload.password_actual,
            session["user"]["username"],
            [p.model_dump() for p in payload.preguntas],
        )
        return api_ok(resultado, message="Preguntas de recuperación guardadas.")
    except Exception as exc:
        handle_validation(exc)


@router.post("/recuperar/preguntas")
def preguntas_para_recuperar(payload: PreguntasDeUsuarioPayload, request: Request):
    """Devuelve las preguntas de un usuario para el formulario de recuperación.

    Responde igual exista o no el usuario, para no convertir esto en una forma de
    averiguar que cuentas hay.
    """
    ip = client_ip(request)
    _check_login_rate(ip, payload.username)
    preguntas = preguntas_publicas(payload.username)
    if not preguntas:
        _record_login_attempt(ip, success=False, username=payload.username)
        raise HTTPException(
            status_code=404,
            detail="No hay preguntas de recuperación configuradas para ese usuario.",
        )
    return api_ok({"preguntas": preguntas})


@router.post("/recuperar")
def recuperar_password(payload: RecuperarPayload, request: Request):
    """Verifica las respuestas y establece la contraseña nueva."""
    ip = client_ip(request)
    _check_login_rate(ip, payload.username)

    if payload.password != payload.password_confirm:
        raise HTTPException(status_code=400, detail="La confirmación de contraseña no coincide.")

    try:
        recuperar_con_preguntas(
            payload.username,
            [r.model_dump() for r in payload.respuestas],
            payload.password,
        )
    except Exception as exc:
        _record_login_attempt(ip, success=False, username=payload.username)
        handle_validation(exc)
        return

    _record_login_attempt(ip, success=True, username=payload.username)
    logger.warning("Contraseña recuperada por preguntas de seguridad: %s", payload.username)
    return api_ok(message="Contraseña actualizada. Ya puedes iniciar sesión.")
