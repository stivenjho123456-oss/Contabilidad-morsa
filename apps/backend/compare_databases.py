#!/usr/bin/env python3
"""Compara dos bases PostgreSQL tabla por tabla antes de un corte de migracion.

Sirve para responder una sola pregunta con certeza: la base nueva tiene todo lo
que tiene la vieja? Si alguna tabla muestra menos filas en el destino, ahi hay
datos que se perderian al apagar el origen.

Uso:

    ./.venv/bin/python apps/backend/compare_databases.py \\
        --origen "postgresql://...supabase..." \\
        --destino "postgresql://...railway..."

Tambien acepta las variables de entorno ORIGEN_URL y DESTINO_URL para no dejar
las credenciales en el historial del shell.

Salida: una tabla con el conteo de filas de cada lado y la diferencia. Termina
con codigo 1 si el destino tiene menos filas en alguna tabla, para que se pueda
encadenar en un script de corte.
"""
from __future__ import annotations

import argparse
import os
import sys

try:
    import psycopg2
except ImportError:
    print("Falta psycopg2. Instalalo con: pip install -r apps/backend/requirements.txt", file=sys.stderr)
    raise SystemExit(1)


# Tablas de datos del negocio. Se omiten las operativas (auth_sessions,
# login_attempts, schema_migrations) porque no se migran ni importa que difieran.
TABLAS = [
    "proveedores",
    "ingresos",
    "egresos",
    "cuadre_caja",
    "caja_ajustes",
    "caja_apertura",
    "cierres_mensuales",
    "nomina_resumen",
    "nomina_seg_social",
    "nomina_novedades",
    "nomina_asistencia",
    "insumos",
    "inventario_diario",
    "inventario_turno",
    "archivos",
    "usuarios",
    "auditoria",
]

# Columna de fecha/tiempo por tabla, para detectar si el origen recibio
# escrituras despues del dump aunque el conteo parezca igual.
COLUMNA_RECIENTE = {
    "ingresos": "fecha",
    "egresos": "fecha",
    "cuadre_caja": "fecha",
    "caja_ajustes": "fecha",
    "inventario_diario": "fecha",
    "inventario_turno": "fecha",
    "auditoria": "created_at",
    "archivos": "created_at",
}


def existe_tabla(cur, tabla):
    cur.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=%s",
        (tabla,),
    )
    return cur.fetchone() is not None


def inspeccionar(cur, tabla):
    """Devuelve (filas, valor_mas_reciente) o None si la tabla no existe."""
    if not existe_tabla(cur, tabla):
        return None
    cur.execute(f'SELECT COUNT(*) FROM "{tabla}"')
    filas = int(cur.fetchone()[0])

    reciente = None
    columna = COLUMNA_RECIENTE.get(tabla)
    if columna and filas:
        try:
            cur.execute(f'SELECT MAX("{columna}") FROM "{tabla}"')
            reciente = cur.fetchone()[0]
        except Exception:
            cur.connection.rollback()
    return filas, reciente


def main():
    parser = argparse.ArgumentParser(description="Compara dos bases PostgreSQL antes de un corte.")
    parser.add_argument("--origen", default=os.getenv("ORIGEN_URL", ""), help="URL de la base vieja (la que vas a apagar).")
    parser.add_argument("--destino", default=os.getenv("DESTINO_URL", ""), help="URL de la base nueva.")
    args = parser.parse_args()

    if not args.origen or not args.destino:
        parser.error("Faltan --origen y/o --destino (o las variables ORIGEN_URL / DESTINO_URL).")

    try:
        con_origen = psycopg2.connect(args.origen, connect_timeout=20)
        con_destino = psycopg2.connect(args.destino, connect_timeout=20)
    except Exception as exc:
        print(f"No fue posible conectar: {exc}", file=sys.stderr)
        raise SystemExit(1)

    cur_o = con_origen.cursor()
    cur_d = con_destino.cursor()

    print(f"{'TABLA':<22}{'ORIGEN':>10}{'DESTINO':>10}{'DIF':>8}  ESTADO")
    print("-" * 72)

    faltantes = []
    avisos = []
    total_o = total_d = 0

    for tabla in TABLAS:
        info_o = inspeccionar(cur_o, tabla)
        info_d = inspeccionar(cur_d, tabla)

        if info_o is None and info_d is None:
            continue
        if info_o is None:
            print(f"{tabla:<22}{'—':>10}{info_d[0]:>10}{'':>8}  solo en destino")
            continue
        if info_d is None:
            print(f"{tabla:<22}{info_o[0]:>10}{'—':>10}{'':>8}  FALTA LA TABLA EN DESTINO")
            faltantes.append(tabla)
            continue

        filas_o, reciente_o = info_o
        filas_d, reciente_d = info_d
        total_o += filas_o
        total_d += filas_d
        dif = filas_d - filas_o

        if dif < 0:
            estado = f"FALTAN {-dif} FILAS EN DESTINO"
            faltantes.append(tabla)
        elif dif > 0:
            estado = "destino tiene mas (revisar)"
            avisos.append(tabla)
        else:
            estado = "ok"

        if dif == 0 and reciente_o is not None and reciente_d is not None and str(reciente_o) != str(reciente_d):
            estado = f"ok en conteo, pero el dato mas reciente difiere ({reciente_o} vs {reciente_d})"
            avisos.append(tabla)

        print(f"{tabla:<22}{filas_o:>10}{filas_d:>10}{dif:>+8}  {estado}")

    print("-" * 72)
    print(f"{'TOTAL':<22}{total_o:>10}{total_d:>10}{total_d - total_o:>+8}")
    print()

    con_origen.close()
    con_destino.close()

    if faltantes:
        print("NO APAGUES EL ORIGEN TODAVIA.")
        print(f"Estas tablas tienen menos datos en el destino: {', '.join(faltantes)}")
        print("Repite el pg_dump/pg_restore y vuelve a correr esta comparacion.")
        raise SystemExit(1)

    if avisos:
        print("Conteos completos, pero revisa estas tablas antes de apagar:")
        print(f"  {', '.join(avisos)}")
        raise SystemExit(0)

    print("El destino tiene al menos todo lo del origen. Corte seguro por conteo de filas.")


if __name__ == "__main__":
    main()
