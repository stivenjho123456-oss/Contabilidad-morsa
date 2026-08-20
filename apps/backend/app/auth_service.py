from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import unicodedata
import secrets
import threading
import time
from datetime import datetime, timedelta

from database import (
    AppValidationError,
    auth_bootstrap_required,
    cleanup_auth_sessions,
    count_auth_users,
    create_auth_session,
    create_auth_user,
    get_auth_session_by_hash,
    get_auth_user_by_username,
    log_auditoria,
    get_preguntas_usuario,
    revoke_auth_session,
    revoke_auth_sessions_for_user,
    set_auth_last_login,
    set_auth_password,
    set_preguntas_usuario,
    touch_auth_session,
)

logger = logging.getLogger("contabilidad_morsa.auth")


SESSION_HEADER = "Authorization"
SESSION_SCHEME = "Bearer"
PASSWORD_HASH_ITERATIONS = int(os.getenv("MORSA_PASSWORD_ITERATIONS", "390000"))
PASSWORD_PEPPER = os.getenv("MORSA_PASSWORD_PEPPER", "")
SESSION_DURATION_HOURS = float(os.getenv("MORSA_SESSION_HOURS", "12"))
BOOTSTRAP_ADMIN_USERNAME = os.getenv("MORSA_ADMIN_USERNAME", "").strip()
BOOTSTRAP_ADMIN_PASSWORD = os.getenv("MORSA_ADMIN_PASSWORD", "").strip()
BOOTSTRAP_ADMIN_FULL_NAME = os.getenv("MORSA_ADMIN_FULL_NAME", "Administrador General").strip() or "Administrador General"
PASSWORD_RESET_REQUEST = os.getenv("MORSA_PASSWORD_RESET", "").strip()

# ── Caché de sesiones en memoria ──────────────────────────────────────────────
# Evita 2 queries a la BD por cada request autenticado.
# TTL corto (30s) garantiza que revocaciones y cambios de rol se reflejen rápido.
_SESSION_CACHE_TTL = 30.0           # segundos que dura una entrada en caché
_SESSION_TOUCH_INTERVAL = 300.0     # solo actualizar last_seen_at cada 5 minutos

_session_cache: dict[str, tuple[dict, float]] = {}  # token_hash -> (session, monotonic_time)
_session_cache_lock = threading.Lock()


def _get_cached_session(token_hash: str) -> dict | None:
    with _session_cache_lock:
        entry = _session_cache.get(token_hash)
        if entry is None:
            return None
        session_data, cached_at = entry
        if time.monotonic() - cached_at > _SESSION_CACHE_TTL:
            del _session_cache[token_hash]
            return None
        return session_data


def _put_cached_session(token_hash: str, session_data: dict) -> None:
    with _session_cache_lock:
        _session_cache[token_hash] = (session_data, time.monotonic())


def _invalidate_cached_session(token_hash: str) -> None:
    with _session_cache_lock:
        _session_cache.pop(token_hash, None)


def _clear_session_cache() -> None:
    """Vacía la caché completa. Se usa tras un cambio de contraseña, donde importa
    más cerrar sesiones de inmediato que ahorrar queries."""
    with _session_cache_lock:
        _session_cache.clear()


# ── Helpers internos ──────────────────────────────────────────────────────────

def _auth_now():
    return datetime.now()


def _token_hash(token: str):
    secret = os.getenv("MORSA_API_SECRET", "")
    material = f"{secret}:{token}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _require_password_strength(password: str):
    raw = password or ""
    if len(raw) < 10:
        raise AppValidationError("La contraseña debe tener al menos 10 caracteres.")
    if not any(ch.islower() for ch in raw):
        raise AppValidationError("La contraseña debe incluir al menos una letra minúscula.")
    if not any(ch.isupper() for ch in raw):
        raise AppValidationError("La contraseña debe incluir al menos una letra mayúscula.")
    if not any(ch.isdigit() for ch in raw):
        raise AppValidationError("La contraseña debe incluir al menos un número.")


def hash_password(password: str):
    _require_password_strength(password)
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        (password + PASSWORD_PEPPER).encode("utf-8"),
        salt,
        PASSWORD_HASH_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}$"
        f"{base64.b64encode(salt).decode('ascii')}$"
        f"{base64.b64encode(derived).decode('ascii')}"
    )


def verify_password(password: str, password_hash: str):
    try:
        algorithm, iterations_raw, salt_b64, hash_b64 = (password_hash or "").split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected = base64.b64decode(hash_b64.encode("ascii"))
    except Exception:
        return False

    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        (password + PASSWORD_PEPPER).encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate, expected)


def verify_user_password(username: str, password: str) -> bool:
    """Verifica la contraseña de un usuario por su username. Seguro ante timing attacks."""
    user = get_auth_user_by_username(username, include_password=True)
    if not user or not user.get("active"):
        return False
    return verify_password(password, user.get("password_hash", ""))


def _session_response(user: dict, token: str, expires_at: str):
    return {
        "token": token,
        "header": SESSION_HEADER,
        "scheme": SESSION_SCHEME,
        "expires_at": expires_at,
        "user": user,
    }


def bootstrap_admin_env_configured():
    return bool(BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD)


def _issue_session(user: dict, *, user_agent: str = "", ip_address: str = ""):
    cleanup_auth_sessions()
    token = secrets.token_urlsafe(32)
    expires_at = (_auth_now() + timedelta(hours=SESSION_DURATION_HOURS)).isoformat(timespec="seconds")
    create_auth_session(
        user["id"],
        _token_hash(token),
        expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    set_auth_last_login(user["id"])
    user["last_login_at"] = _auth_now().isoformat(timespec="seconds")
    log_auditoria("auth_session", "LOGIN", entidad_id=user["id"], detalle=f"Inicio de sesión de {user['username']}.")
    return _session_response(user, token, expires_at)


def auth_status():
    return {
        "requires_setup": auth_bootstrap_required(),
        "users_count": count_auth_users(),
        "header": SESSION_HEADER,
        "scheme": SESSION_SCHEME,
    }


def bootstrap_admin_account(username: str, full_name: str, password: str, *, user_agent: str = "", ip_address: str = ""):
    if not auth_bootstrap_required():
        raise AppValidationError("La cuenta inicial ya fue configurada.")
    user = create_auth_user(username, full_name, hash_password(password), role="admin", active=True)
    if user is None:
        user = get_auth_user_by_username(username)
    if user is None:
        raise AppValidationError("El usuario fue creado pero no pudo verificarse. Intenta iniciar sesión.")
    return _issue_session(user, user_agent=user_agent, ip_address=ip_address)


def ensure_bootstrap_admin_from_env():
    if not auth_bootstrap_required():
        return None
    if not bootstrap_admin_env_configured():
        return None
    user = create_auth_user(
        BOOTSTRAP_ADMIN_USERNAME,
        BOOTSTRAP_ADMIN_FULL_NAME,
        hash_password(BOOTSTRAP_ADMIN_PASSWORD),
        role="admin",
        active=True,
    )
    log_auditoria("usuarios", "BOOTSTRAP", entidad_id=user["id"], detalle=f"Usuario inicial {user['username']} creado desde entorno.")
    return user


# ── Preguntas de seguridad ────────────────────────────────────────────────────
# Sin servidor de correo no hay "enlace de recuperación", asi que la identidad se
# prueba con algo que solo el usuario sabe. Las respuestas se hashean igual que
# las contraseñas: quien lea la base no puede responder las preguntas.

PREGUNTAS_MINIMAS = 3
RESPUESTA_MINIMA = 3

PREGUNTAS_SUGERIDAS = [
    "¿Cómo se llamaba tu primera mascota?",
    "¿En qué ciudad nació tu madre?",
    "¿Cuál fue tu primer trabajo?",
    "¿Cómo se llamaba tu mejor amigo de la infancia?",
    "¿Cuál es tu plato favorito?",
    "¿En qué colegio estudiaste primaria?",
    "¿Cuál fue la marca de tu primer carro o moto?",
    "¿Cómo se llamaba tu profesor favorito?",
]


def normalizar_respuesta(texto: str) -> str:
    """Deja la respuesta comparable: sin tildes, en minúsculas y sin espacios de más.

    Asi "Bogotá", "bogota" y "  BOGOTA " cuentan como la misma respuesta. Sin esto
    la recuperación fallaria por detalles de tecleo justo cuando mas se necesita.
    """
    limpio = unicodedata.normalize("NFD", (texto or "").strip().lower())
    limpio = "".join(ch for ch in limpio if unicodedata.category(ch) != "Mn")
    return " ".join(limpio.split())


def _hash_respuesta(respuesta: str) -> str:
    """Hashea una respuesta normalizada reusando el mismo PBKDF2 de las contraseñas."""
    normalizada = normalizar_respuesta(respuesta)
    if len(normalizada) < RESPUESTA_MINIMA:
        raise AppValidationError(
            f"Cada respuesta debe tener al menos {RESPUESTA_MINIMA} caracteres."
        )
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        (normalizada + PASSWORD_PEPPER).encode("utf-8"),
        salt,
        PASSWORD_HASH_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}$"
        f"{base64.b64encode(salt).decode('ascii')}$"
        f"{base64.b64encode(derived).decode('ascii')}"
    )


def _verificar_respuesta(respuesta: str, respuesta_hash: str) -> bool:
    return verify_password(normalizar_respuesta(respuesta), respuesta_hash)


def configurar_preguntas(user_id: int, password_actual: str, username: str, preguntas: list):
    """Guarda las preguntas de un usuario. Exige su contraseña actual.

    Pedir la contraseña evita que una sesión abierta y olvidada en un equipo
    ajeno pueda cambiar las preguntas y con eso quedarse la cuenta.
    """
    if not verify_user_password(username, password_actual):
        raise AppValidationError("La contraseña actual no es correcta.")

    if len(preguntas) < PREGUNTAS_MINIMAS:
        raise AppValidationError(
            f"Debes configurar al menos {PREGUNTAS_MINIMAS} preguntas."
        )

    textos = [normalizar_respuesta(p.get("pregunta", "")) for p in preguntas]
    if len(set(textos)) != len(textos):
        raise AppValidationError("Las preguntas no pueden repetirse.")

    respuestas = [normalizar_respuesta(p.get("respuesta", "")) for p in preguntas]
    if len(set(respuestas)) != len(respuestas):
        raise AppValidationError(
            "Las respuestas no pueden ser todas iguales. Usa una distinta por pregunta."
        )

    preparadas = [
        {"pregunta": p.get("pregunta", ""), "respuesta_hash": _hash_respuesta(p.get("respuesta", ""))}
        for p in preguntas
    ]
    total = set_preguntas_usuario(user_id, preparadas)
    logger.info("Preguntas de recuperación configuradas para user_id=%s (%s).", user_id, total)
    return {"preguntas": total}


def preguntas_publicas(username: str):
    """Devuelve solo los textos de las preguntas de un usuario, sin respuestas.

    Devuelve None si el usuario no existe o no tiene preguntas configuradas: el
    endpoint responde igual en ambos casos para no revelar que usuarios existen.
    """
    user = get_auth_user_by_username(username)
    if not user or not user.get("active"):
        return None
    preguntas = get_preguntas_usuario(user["id"])
    if not preguntas:
        return None
    return [{"orden": p["orden"], "pregunta": p["pregunta"]} for p in preguntas]


def recuperar_con_preguntas(username: str, respuestas: list, nueva_password: str):
    """Verifica las respuestas y, si todas son correctas, cambia la contraseña.

    Exige acertar TODAS las preguntas. Si falla una sola, no dice cual: decirlo
    convertiria el formulario en una guia para adivinar de a una.
    """
    user = get_auth_user_by_username(username)
    if not user or not user.get("active"):
        raise AppValidationError("No se pudo verificar la identidad.")

    configuradas = get_preguntas_usuario(user["id"], include_hash=True)
    if not configuradas:
        raise AppValidationError("Este usuario no tiene preguntas de recuperación configuradas.")

    if len(respuestas) != len(configuradas):
        raise AppValidationError("Debes responder todas las preguntas.")

    por_orden = {r.get("orden"): r.get("respuesta", "") for r in respuestas}
    todas_bien = True
    for pregunta in configuradas:
        entregada = por_orden.get(pregunta["orden"])
        if entregada is None or not _verificar_respuesta(entregada, pregunta["respuesta_hash"]):
            todas_bien = False  # se siguen verificando todas para no filtrar cual fallo por el tiempo

    if not todas_bien:
        log_auditoria("usuarios", "RECUPERACION_FALLIDA", entidad_id=user["id"],
                      detalle=f"Respuestas incorrectas para {user['username']}.")
        raise AppValidationError("Las respuestas no coinciden.")

    resultado = reset_user_password(username, nueva_password, origen="preguntas de seguridad")
    return resultado


# ── Recuperación de contraseña ────────────────────────────────────────────────
# No hay servidor de correo en este proyecto, asi que no existe el flujo de
# "enviar link de recuperación". La identidad se prueba con algo equivalente:
# tener acceso a las variables de entorno del servicio o a la base de datos.
# Cualquiera de las dos cosas ya implica control total del despliegue.

def reset_user_password(username: str, new_password: str, *, origen: str = "manual"):
    """Reemplaza la contraseña de un usuario y cierra todas sus sesiones.

    No pide la contraseña anterior: quien llega aquí ya demostró control del
    despliegue. Devuelve el usuario público actualizado.
    """
    user = get_auth_user_by_username(username, include_password=True)
    if not user:
        raise AppValidationError(f"No existe el usuario '{username}'.")

    password_hash = hash_password(new_password)  # valida fortaleza antes de tocar la BD
    set_auth_password(user["id"], password_hash)
    revoked = revoke_auth_sessions_for_user(user["id"])
    _clear_session_cache()

    log_auditoria(
        "usuarios",
        "PASSWORD_RESET",
        entidad_id=user["id"],
        detalle=f"Contraseña de {user['username']} restablecida ({origen}). Sesiones cerradas: {revoked}.",
    )
    logger.warning(
        "Contraseña restablecida para '%s' (origen=%s). Sesiones cerradas: %s.",
        user["username"],
        origen,
        revoked,
    )
    return {"username": user["username"], "sesiones_cerradas": revoked}


def apply_env_password_reset():
    """Aplica MORSA_PASSWORD_RESET='usuario:ContraseñaNueva' si está definida.

    Pensada para el caso "olvidé la contraseña y no puedo entrar": se define la
    variable en el panel del hosting, se reinicia el servicio y se entra con la
    contraseña nueva. Es idempotente — si la contraseña ya es la pedida no vuelve
    a cerrar sesiones — y nunca tumba el arranque: los errores solo se registran.
    """
    if not PASSWORD_RESET_REQUEST:
        return None

    if ":" not in PASSWORD_RESET_REQUEST:
        logger.error("MORSA_PASSWORD_RESET ignorada: el formato debe ser 'usuario:ContraseñaNueva'.")
        return None

    username, _, new_password = PASSWORD_RESET_REQUEST.partition(":")
    username = username.strip()
    if not username or not new_password:
        logger.error("MORSA_PASSWORD_RESET ignorada: usuario o contraseña vacíos.")
        return None

    try:
        user = get_auth_user_by_username(username, include_password=True)
        if not user:
            logger.error("MORSA_PASSWORD_RESET ignorada: no existe el usuario '%s'.", username)
            return None

        if verify_password(new_password, user.get("password_hash", "")):
            logger.info(
                "MORSA_PASSWORD_RESET ya estaba aplicada para '%s'. "
                "Elimina la variable del entorno para no dejarla activa.",
                user["username"],
            )
            return None

        result = reset_user_password(username, new_password, origen="variable de entorno")
        logger.warning(
            "MORSA_PASSWORD_RESET aplicada para '%s'. "
            "ELIMINA esa variable del entorno ahora: mientras siga definida, "
            "la contraseña vuelve a este valor en cada reinicio.",
            result["username"],
        )
        return result
    except Exception:
        logger.exception("MORSA_PASSWORD_RESET falló. El arranque continúa sin aplicarla.")
        return None


def authenticate_user(username: str, password: str, *, user_agent: str = "", ip_address: str = ""):
    user = get_auth_user_by_username(username, include_password=True)
    if not user or not user.get("active"):
        return None
    if not verify_password(password, user.get("password_hash", "")):
        return None
    public_user = {key: value for key, value in user.items() if key != "password_hash"}
    public_user["active"] = bool(public_user.get("active", 1))
    return _issue_session(public_user, user_agent=user_agent, ip_address=ip_address)


def resolve_session(token: str):
    if not token:
        return None

    token_hash = _token_hash(token)

    # Cache hit — sin tocar la BD
    cached = _get_cached_session(token_hash)
    if cached is not None:
        return cached

    # Cache miss — consultar BD
    session = get_auth_session_by_hash(token_hash)
    if not session:
        return None

    # Solo actualizar last_seen_at si pasaron más de 5 minutos
    last_seen_str = session.get("last_seen_at", "")
    try:
        last_seen_dt = datetime.fromisoformat(last_seen_str)
        needs_touch = (_auth_now() - last_seen_dt).total_seconds() > _SESSION_TOUCH_INTERVAL
    except Exception:
        needs_touch = True

    if needs_touch:
        touch_auth_session(session["id"])

    result = {
        "header": SESSION_HEADER,
        "scheme": SESSION_SCHEME,
        "expires_at": session["expires_at"],
        "user": session["user"],
        "session_id": session["id"],
    }

    _put_cached_session(token_hash, result)
    return result


def revoke_session(token: str):
    if not token:
        return
    token_hash = _token_hash(token)
    # Obtener datos para auditoría antes de revocar
    session = get_auth_session_by_hash(token_hash)
    # Revocar en BD e invalidar caché inmediatamente
    revoke_auth_session(token_hash)
    _invalidate_cached_session(token_hash)
    if session:
        log_auditoria("auth_session", "LOGOUT", entidad_id=session["user"]["id"], detalle=f"Cierre de sesión de {session['user']['username']}.")
