from datetime import datetime
from pathlib import Path
import os
import tempfile

from fastapi.testclient import TestClient

import sys

ROOT = Path(__file__).resolve().parents[2]
CORE_APP_DIR = ROOT / "ContabilidadMorsa"
FRONTEND_DIST = ROOT / "apps" / "frontend" / "dist" / "index.html"
TEST_APPDATA = Path(tempfile.mkdtemp(prefix="morsa-backend-test-"))
os.environ["MORSA_ALLOW_SQLITE"] = "1"
os.environ["MORSA_RUNTIME_DIR"] = str(TEST_APPDATA)
if str(CORE_APP_DIR) not in sys.path:
    sys.path.insert(0, str(CORE_APP_DIR))

import database  # noqa: E402

database.init_db()

from app.main import app


client = TestClient(app)
status_payload = client.get("/api/auth/status").json()
status_data = status_payload["data"]
if status_data["requires_setup"]:
    bootstrap_payload = {
        "username": "admin",
        "full_name": "Administrador Smoke",
        "password": "Admin12345",
        "password_confirm": "Admin12345",
    }
    session_payload = client.post("/api/auth/bootstrap", json=bootstrap_payload).json()
else:
    session_payload = client.post("/api/auth/login", json={"username": "admin", "password": "Admin12345"}).json()
AUTH_DATA = session_payload["data"]
AUTH_HEADERS = {AUTH_DATA["header"]: f"{AUTH_DATA['scheme']} {AUTH_DATA['token']}"}


def api_get(path, **kwargs):
    headers = {**AUTH_HEADERS, **kwargs.pop("headers", {})}
    return client.get(path, headers=headers, **kwargs)


def api_post(path, **kwargs):
    headers = {**AUTH_HEADERS, **kwargs.pop("headers", {})}
    return client.post(path, headers=headers, **kwargs)


def api_put(path, **kwargs):
    headers = {**AUTH_HEADERS, **kwargs.pop("headers", {})}
    return client.put(path, headers=headers, **kwargs)


def api_delete(path, **kwargs):
    headers = {**AUTH_HEADERS, **kwargs.pop("headers", {})}
    return client.delete(path, headers=headers, **kwargs)


def assert_ok(response, status=200):
    assert response.status_code == status, response.text
    payload = response.json()
    assert payload.get("ok") is True, payload
    return payload["data"]


def run():
    stamp = datetime.now().strftime("%H%M%S")

    health = client.get("/health")
    assert health.status_code == 200, health.text
    assert health.json()["status"] == "ok"
    assert "db_health" in health.json()

    unauthorized = client.get("/api/system/summary")
    assert unauthorized.status_code == 401, unauthorized.text

    auth_status = assert_ok(client.get("/api/auth/status"))
    assert "requires_setup" in auth_status

    session = assert_ok(api_get("/api/auth/session"))
    assert session["user"]["username"] == "admin"

    root_html = client.get("/", headers={"accept": "text/html"})
    if FRONTEND_DIST.exists():
        assert root_html.status_code == 200, root_html.text
    else:
        assert root_html.status_code == 404, root_html.text

    system = assert_ok(api_get("/api/system/summary"))
    assert "counts" in system

    caja_hoy = assert_ok(api_get("/api/caja/hoy"))
    assert {"fecha", "movimientos", "saldo_inicial_operativo", "saldo_actual", "detalle_movimientos", "apertura"} <= set(caja_hoy.keys())
    assert {"entradas", "salidas", "resumen"} <= set(caja_hoy["detalle_movimientos"].keys())
    assert "message" in caja_hoy["apertura"]

    ajustes = assert_ok(api_get("/api/caja/ajustes?mes=3&ano=2026"))
    assert isinstance(ajustes, list)

    providers = assert_ok(api_get("/api/proveedores"))
    assert isinstance(providers, list)

    created_provider = api_post("/api/proveedores", json={
        "razon_social": f"Proveedor Smoke {stamp}",
        "nit": f"SMK-{stamp}",
        "correo": f"smoke{stamp}@test.local",
    })
    assert created_provider.status_code == 200, created_provider.text
    providers_after = assert_ok(api_get("/api/proveedores?search=Smoke"))
    provider = next(p for p in providers_after if p["razon_social"] == f"Proveedor Smoke {stamp}")

    provider_detail = assert_ok(api_get(f"/api/proveedores/{provider['id']}"))
    assert provider_detail["nit"] == f"SMK-{stamp}"

    ingresos = assert_ok(api_get("/api/ingresos?mes=3&ano=2026"))
    assert isinstance(ingresos, list)

    ingreso_date = f"2026-03-{min(int(stamp[-2:]) % 28 + 1, 28):02d}"
    created_ingreso = api_post("/api/ingresos", json={
        "fecha": ingreso_date,
        "caja": 12345,
        "bancos": 6789,
        "tarjeta_cr": 111,
    })
    assert created_ingreso.status_code in {200, 400}, created_ingreso.text
    ingreso_created_id = None
    if created_ingreso.status_code == 200:
        current_ingresos = assert_ok(api_get(f"/api/ingresos?mes=3&ano=2026"))
        match = next((i for i in current_ingresos if i["fecha"] == ingreso_date and i["caja"] == 12345), None)
        ingreso_created_id = match["id"] if match else None

    created_ajuste = api_post("/api/caja/ajustes", json={
        "fecha": "2026-03-28",
        "tipo": "SALIDA",
        "valor": 2500,
        "motivo": "Ajuste por pérdida no explicada",
        "observaciones": "Smoke test ajuste manual",
    })
    assert created_ajuste.status_code == 200, created_ajuste.text
    ajustes_after = assert_ok(api_get("/api/caja/ajustes?mes=3&ano=2026"))
    assert any(a["motivo"] == "Ajuste por pérdida no explicada" for a in ajustes_after)

    egresos_meta = assert_ok(api_get("/api/egresos-meta"))
    assert "tipos_gasto" in egresos_meta

    created_egreso = api_post("/api/egresos", json={
        "fecha": "2026-03-28",
        "no_documento": f"SMK-{stamp}",
        "razon_social": provider["razon_social"],
        "nit": provider["nit"],
        "valor": 9999,
        "tipo_gasto": "GASTO",
        "factura_electronica": "NO",
        "observaciones": "Smoke test egreso",
    })
    assert created_egreso.status_code == 200, created_egreso.text
    egresos_after = assert_ok(api_get("/api/egresos?mes=3&ano=2026&search=Smoke"))
    smoke_egreso = next(e for e in egresos_after if e["observaciones"] == "Smoke test egreso")
    egreso_detail = assert_ok(api_get(f"/api/egresos/{smoke_egreso['id']}"))
    assert egreso_detail["valor"] == 9999
    upload_support = api_post(
        f"/api/egresos/{smoke_egreso['id']}/soporte",
        files={"file": ("soporte.pdf", b"%PDF-1.4 smoke support", "application/pdf")},
    )
    assert upload_support.status_code == 200, upload_support.text

    nomina = assert_ok(api_get("/api/nomina"))
    assert {"periodos", "stats", "workflow", "resumen", "asistencia", "asistencia_resumen", "seg_social", "novedades"} <= set(nomina.keys())

    periodo = nomina["periodos"][0] if nomina["periodos"] else "FEBRERO 2026"
    created_asistencia = api_post("/api/nomina/asistencia", json={
        "periodo": periodo,
        "empleado": "Smoke Tester",
        "cedula": f"{stamp}",
        "dia": 14,
        "quincena": "Q1",
        "estado": "LABORADO",
    })
    assert created_asistencia.status_code == 200, created_asistencia.text

    created_novedad = api_post("/api/nomina/novedades", json={
        "periodo": periodo,
        "fecha": "2026-02-20",
        "empleado": "Smoke Tester",
        "cedula": f"{stamp}",
        "quincena": "Q2",
        "naturaleza": "DEVENGADO",
        "tipo_novedad": "BONIFICACION",
        "valor": 1000,
        "observaciones": "Smoke test novedad",
    })
    assert created_novedad.status_code == 200, created_novedad.text
    nomina_after = assert_ok(api_get(f"/api/nomina?periodo={periodo}&search=Smoke"))
    asistencia = next(a for a in nomina_after["asistencia"] if a["empleado"] == "Smoke Tester" and int(a["dia"]) == 14)
    novedad = next(n for n in nomina_after["novedades"] if n["observaciones"] == "Smoke test novedad")
    workflow = nomina_after["workflow"]
    assert workflow["total_steps"] >= 5

    sync = api_post("/api/nomina/sync", json={"periodo": periodo})
    assert sync.status_code == 200, sync.text

    cierre = assert_ok(api_get("/api/reportes/cierre?mes=3&ano=2026"))
    assert {"cierre", "ingresos", "egresos", "nomina", "novedades", "seg_social"} <= set(cierre.keys())
    cierre_liviano = assert_ok(api_get("/api/reportes/cierre?mes=3&ano=2026&include_details=false"))
    assert set(cierre_liviano.keys()) == {"cierre"}

    cierre_mes = api_post("/api/cierres/cerrar", json={"mes": 3, "ano": 2026, "observacion": "smoke"})
    assert cierre_mes.status_code == 200, cierre_mes.text
    reabrir_mes = api_post("/api/cierres/reabrir", json={"mes": 3, "ano": 2026, "observacion": "smoke"})
    assert reabrir_mes.status_code == 200, reabrir_mes.text
    auditoria = assert_ok(api_get("/api/auditoria?limit=20"))
    assert isinstance(auditoria, list)

    export_ingresos = api_get("/api/export/ingresos?mes=3&ano=2026")
    assert export_ingresos.status_code == 200, export_ingresos.text

    export_egresos = api_get("/api/export/egresos?mes=3&ano=2026")
    assert export_egresos.status_code == 200, export_egresos.text

    export_proveedores = api_get("/api/export/proveedores")
    assert export_proveedores.status_code == 200, export_proveedores.text

    # Cleanup smoke rows
    cleanup_egreso = api_delete(f"/api/egresos/{smoke_egreso['id']}")
    assert cleanup_egreso.status_code == 200, cleanup_egreso.text
    cleanup_asistencia = api_delete(f"/api/nomina/asistencia/{asistencia['id']}")
    assert cleanup_asistencia.status_code == 200, cleanup_asistencia.text
    cleanup_novedad = api_delete(f"/api/nomina/novedades/{novedad['id']}")
    assert cleanup_novedad.status_code == 200, cleanup_novedad.text
    if ingreso_created_id:
        cleanup_ingreso = api_delete(f"/api/ingresos/{ingreso_created_id}")
        assert cleanup_ingreso.status_code == 200, cleanup_ingreso.text
    cleanup_provider = api_delete(f"/api/proveedores/{provider['id']}")
    assert cleanup_provider.status_code == 200, cleanup_provider.text

    bad_month = api_get("/api/ingresos?mes=15&ano=2026")
    assert bad_month.status_code == 400, bad_month.text

    missing = api_get("/api/proveedores/999999999")
    assert missing.status_code == 404, missing.text

    logout = api_post("/api/auth/logout")
    assert logout.status_code == 200, logout.text

    expired_session = client.get("/api/auth/session", headers=AUTH_HEADERS)
    assert expired_session.status_code == 401, expired_session.text

    relogin = client.post("/api/auth/login", json={"username": "admin", "password": "Admin12345"})
    assert relogin.status_code == 200, relogin.text

    print("Backend smoke test OK")


if __name__ == "__main__":
    run()
