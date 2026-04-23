from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException
from starlette.requests import Request

from database import AppValidationError


def api_ok(data: Any = None, message: str | None = None):
    return {"ok": True, "message": message, "data": data}


def handle_validation(exc: Exception):
    if isinstance(exc, AppValidationError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else ""


def sanitize_filename(value: str) -> str:
    raw = Path(value or "soporte").name
    cleaned = "".join(ch if ch.isalnum() or ch in {".", "-", "_"} else "_" for ch in raw)
    return cleaned or "soporte"
