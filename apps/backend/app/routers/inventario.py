from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel
from starlette.requests import Request

from database import get_insumos, get_inventario_diario, save_inventario_diario
from routers.utils import api_ok, handle_validation

router = APIRouter(prefix="/api", tags=["inventario"])


class InventarioItemPayload(BaseModel):
    insumo_id: int | None = None
    nombre_extra: str | None = None
    estado: str
    cantidad: float | None = None
    notas: str | None = None


class InventarioGuardarPayload(BaseModel):
    fecha: str
    items: list[InventarioItemPayload]
    observaciones: str | None = None


@router.get("/insumos")
def get_insumos_list():
    return api_ok(get_insumos())


@router.get("/inventario")
def get_inventario(fecha: str = Query(...)):
    return api_ok(get_inventario_diario(fecha))


@router.post("/inventario")
def save_inventario(payload: InventarioGuardarPayload, request: Request):
    try:
        usuario_id = request.state.current_user.get("id") if hasattr(request.state, "current_user") else None
        save_inventario_diario(
            payload.fecha,
            [i.model_dump() for i in payload.items],
            usuario_id=usuario_id,
            observaciones=payload.observaciones,
        )
        return api_ok(message="Inventario guardado correctamente.")
    except Exception as exc:
        handle_validation(exc)
