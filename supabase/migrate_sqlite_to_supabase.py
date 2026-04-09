#!/usr/bin/env python3
"""
migrate_sqlite_to_supabase.py
Exporta todos los datos desde la base SQLite local y los importa a Supabase (PostgreSQL).

Uso:
    pip install psycopg2-binary
    python supabase/migrate_sqlite_to_supabase.py

Variables de entorno requeridas:
    DATABASE_URL  — Connection string de Supabase (Transaction Pooler)
                   Ej: postgresql://postgres.[ref]:[pass]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
    SQLITE_PATH   — Ruta al archivo .db (por defecto: Library/Application Support/Contabilidad Morsa/contabilidad.db)
"""
import os
import sys
import sqlite3
import psycopg2
import psycopg2.extras
from pathlib import Path
from datetime import datetime

# ── Configuración ─────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
# Soporte alternativo: parámetros individuales (evita problemas con contraseñas con caracteres especiales)
PG_HOST     = os.getenv("PG_HOST", "").strip()
PG_USER     = os.getenv("PG_USER", "postgres").strip()
PG_PASSWORD = os.getenv("PG_PASSWORD", "").strip()
PG_DBNAME   = os.getenv("PG_DBNAME", "postgres").strip()
PG_PORT     = int(os.getenv("PG_PORT", "5432"))

USE_PARAMS = bool(PG_HOST and PG_PASSWORD)

if not DATABASE_URL and not USE_PARAMS:
    print("ERROR: Define DATABASE_URL o las variables PG_HOST + PG_PASSWORD.")
    sys.exit(1)

_default_sqlite = Path.home() / "Library" / "Application Support" / "Contabilidad Morsa" / "contabilidad.db"
SQLITE_PATH = Path(os.getenv("SQLITE_PATH", str(_default_sqlite)))
if not SQLITE_PATH.exists():
    print(f"ERROR: No se encontró el archivo SQLite en: {SQLITE_PATH}")
    sys.exit(1)

# ── Tablas y su orden de migración (respetando FKs) ───────────────────────────

TABLES = [
    "proveedores",
    "egresos",
    "ingresos",
    "nomina_resumen",
    "nomina_seg_social",
    "nomina_novedades",
    "nomina_asistencia",
    "cierres_mensuales",
    "auditoria",
    "cuadre_caja",
    "caja_ajustes",
    "usuarios",
    "auth_sessions",
]

# Columnas que son SERIAL en PostgreSQL y se omiten en INSERT (se resetean las secuencias al final)
SERIAL_COLS = {"id"}


def sqlite_to_pg_value(v):
    """Convierte valores SQLite a tipos compatibles con PostgreSQL."""
    if isinstance(v, (int, float, str, type(None))):
        return v
    return str(v)


def get_columns(sqlite_conn, table):
    """Devuelve lista de nombres de columnas de una tabla SQLite."""
    cur = sqlite_conn.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cur.fetchall()]


def migrate_table(sqlite_conn, pg_conn, table: str) -> int:
    """Migra una tabla completa. Devuelve el número de filas insertadas."""
    sqlite_conn.row_factory = sqlite3.Row
    rows = sqlite_conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
    if not rows:
        return 0

    columns = get_columns(sqlite_conn, table)
    placeholders = ", ".join(["%s"] * len(columns))
    cols_sql = ", ".join(columns)
    sql = f"INSERT INTO {table} ({cols_sql}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"

    pg_cur = pg_conn.cursor()
    count = 0
    for row in rows:
        values = tuple(sqlite_to_pg_value(row[col]) for col in columns)
        pg_cur.execute(sql, values)
        count += 1

    pg_conn.commit()
    pg_cur.close()
    return count


def reset_sequences(pg_conn):
    """Resetea las secuencias SERIAL para que el próximo INSERT use el id correcto."""
    pg_cur = pg_conn.cursor()
    for table in TABLES:
        try:
            pg_cur.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM {table}"
            )
        except Exception as exc:
            print(f"  AVISO: No se pudo resetear secuencia de {table}: {exc}")
    pg_conn.commit()
    pg_cur.close()


def check_table_exists(pg_conn, table: str) -> bool:
    pg_cur = pg_conn.cursor()
    pg_cur.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = %s)",
        (table,)
    )
    exists = pg_cur.fetchone()[0]
    pg_cur.close()
    return exists


def main():
    print("=" * 60)
    print("  Migración SQLite → Supabase (PostgreSQL)")
    print(f"  Fuente:  {SQLITE_PATH}")
    print(f"  Destino: {DATABASE_URL[:40]}...")
    print("=" * 60)
    print()

    # Conectar
    print("Conectando a SQLite...")
    sqlite_conn = sqlite3.connect(str(SQLITE_PATH))

    print("Conectando a Supabase...")
    if USE_PARAMS:
        pg_conn = psycopg2.connect(
            host=PG_HOST,
            user=PG_USER,
            password=PG_PASSWORD,
            dbname=PG_DBNAME,
            port=PG_PORT,
            sslmode="require",
        )
    else:
        if "sslmode" not in DATABASE_URL:
            url = DATABASE_URL.rstrip("/") + "?sslmode=require"
        else:
            url = DATABASE_URL
        pg_conn = psycopg2.connect(url)
    pg_conn.autocommit = False
    print("  Conexión exitosa.")
    print()

    total_migrated = 0

    for table in TABLES:
        # Verificar que la tabla existe en PG (el schema debe haberse ejecutado antes)
        if not check_table_exists(pg_conn, table):
            print(f"  OMITIDO — {table}: la tabla no existe en PostgreSQL.")
            print(f"           Ejecuta supabase/schema.sql primero en el SQL Editor de Supabase.")
            continue

        try:
            count = migrate_table(sqlite_conn, pg_conn, table)
            print(f"  OK  {table:30s} → {count:>5} filas")
            total_migrated += count
        except Exception as exc:
            pg_conn.rollback()
            print(f"  ERROR  {table}: {exc}")

    print()
    print("Reseteando secuencias de IDs...")
    reset_sequences(pg_conn)
    print("  OK")

    sqlite_conn.close()
    pg_conn.close()

    print()
    print("=" * 60)
    print(f"  Migración completa: {total_migrated} filas en total")
    print(f"  Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)


if __name__ == "__main__":
    main()
