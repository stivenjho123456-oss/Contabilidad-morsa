"""
db_adapter.py — Capa de compatibilidad SQLite ↔ PostgreSQL

Si la variable de entorno DATABASE_URL está definida, usa PostgreSQL (Supabase).
Si no, usa SQLite local (desarrollo / desktop).

Exporta get_connection() con la misma interfaz que usa database.py.
"""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Any

_DATABASE_URL: str | None = os.getenv("DATABASE_URL")
USE_POSTGRES: bool = bool(_DATABASE_URL)


# ── Adaptación de SQL ─────────────────────────────────────────────────────────

def _adapt_sql(sql: str) -> str:
    """Convierte SQL de estilo SQLite a PostgreSQL."""
    # Placeholders ? → %s
    sql = sql.replace("?", "%s")

    # strftime SQLite → TO_CHAR / EXTRACT PostgreSQL
    sql = re.sub(
        r"strftime\('%m',\s*([^)]+)\)",
        r"LPAD(EXTRACT(MONTH FROM \1::date)::text, 2, '0')",
        sql,
    )
    sql = re.sub(
        r"strftime\('%Y',\s*([^)]+)\)",
        r"EXTRACT(YEAR FROM \1::date)::text",
        sql,
    )
    sql = re.sub(
        r"strftime\('%Y-%m',\s*([^)]+)\)",
        r"TO_CHAR(\1::date, 'YYYY-MM')",
        sql,
    )

    # last_insert_rowid() — eliminado; se usa RETURNING id en su lugar
    sql = re.sub(r"SELECT\s+last_insert_rowid\(\)", "SELECT 0", sql, flags=re.IGNORECASE)

    return sql


# ── Cursor wrapper ────────────────────────────────────────────────────────────

class _PgCursorWrapper:
    """Envuelve un cursor psycopg2 para imitar sqlite3.Cursor."""

    def __init__(self, pg_cursor):
        self._cur = pg_cursor
        self._rows: list | None = None

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        # RealDictRow ya se comporta como dict; lo envolvemos para acceso por índice
        return _RowProxy(row)

    def fetchall(self):
        return [_RowProxy(r) for r in self._cur.fetchall()]

    @property
    def lastrowid(self):
        return getattr(self._cur, "lastrowid", None)

    def __iter__(self):
        for row in self._cur:
            yield _RowProxy(row)


class _RowProxy:
    """Proxy que permite acceso dict-like y por índice, como sqlite3.Row."""

    def __init__(self, row):
        # row es un dict (RealDictRow de psycopg2)
        self._row = dict(row) if row is not None else {}
        self._keys = list(self._row.keys())

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._row[self._keys[key]]
        return self._row[key]

    def __contains__(self, key):
        return key in self._row

    def keys(self):
        return self._keys

    def get(self, key, default=None):
        return self._row.get(key, default)

    def items(self):
        return self._row.items()

    def __iter__(self):
        return iter(self._keys)

    def __repr__(self):
        return f"<Row {self._row}>"


# ── Conexión PostgreSQL wrapper ───────────────────────────────────────────────

class _PgConnectionWrapper:
    """
    Imita la interfaz de sqlite3.Connection para que database.py funcione
    sin cambios con PostgreSQL.
    """

    def __init__(self, pg_conn):
        import psycopg2.extras  # importación diferida
        self._conn = pg_conn
        self._cur = pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        self._last_id: int | None = None
        self.row_factory = None  # ignorado; usamos RealDictCursor

    # ------------------------------------------------------------------
    def execute(self, sql: str, params=None):
        stripped = sql.strip()

        # PRAGMA → ignorar silenciosamente y devolver cursor vacío
        if stripped.upper().startswith("PRAGMA"):
            return _EmptyCursor()

        # executescript / múltiples sentencias: delegar
        if ";" in stripped and stripped.upper().startswith("CREATE"):
            for stmt in stripped.split(";"):
                stmt = stmt.strip()
                if stmt:
                    self._exec_single(stmt, None)
            return _EmptyCursor()

        return self._exec_single(stripped, params)

    def _exec_single(self, sql: str, params):
        # Detectar INSERT para agregar RETURNING id automáticamente
        is_insert = sql.strip().upper().startswith("INSERT")
        adapted = _adapt_sql(sql)

        if is_insert and "RETURNING" not in adapted.upper():
            adapted = adapted.rstrip().rstrip(";") + " RETURNING id"

        self._cur.execute(adapted, params or ())

        if is_insert:
            row = self._cur.fetchone()
            if row and "id" in row:
                self._last_id = row["id"]
                return _ScalarCursor(self._last_id)

        return _PgCursorWrapper(self._cur)

    def executescript(self, script: str):
        """Ejecuta múltiples sentencias DDL (para init_db)."""
        # Adaptar tipos SQLite → PostgreSQL en DDL
        script = script.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
        script = script.replace("REAL ", "DOUBLE PRECISION ")

        for stmt in script.split(";"):
            stmt = stmt.strip()
            if stmt and not stmt.upper().startswith("--"):
                try:
                    self._cur.execute(stmt)
                except Exception:
                    pass  # IF NOT EXISTS protege contra re-ejecución
        self._conn.commit()

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        try:
            self._cur.close()
        except Exception:
            pass
        try:
            self._conn.close()
        except Exception:
            pass


class _EmptyCursor:
    """Cursor vacío para PRAGMA y sentencias sin resultado."""

    def fetchone(self):
        return None

    def fetchall(self):
        return []

    def __iter__(self):
        return iter([])


class _ScalarCursor:
    """Cursor que devuelve un único valor escalar (para last_insert_rowid)."""

    def __init__(self, value):
        self._value = value

    def fetchone(self):
        return _RowProxy({"id": self._value, 0: self._value})

    def fetchall(self):
        return [self.fetchone()]

    def __iter__(self):
        return iter([self.fetchone()])


# ── Fábrica de conexión pública ───────────────────────────────────────────────

def get_pg_connection():
    """Devuelve una conexión PostgreSQL envuelta en la interfaz compatible."""
    import psycopg2

    # Supabase requiere sslmode=require — ya viene en el connection string
    # pero lo reforzamos por si acaso
    url = _DATABASE_URL
    if "sslmode" not in (url or ""):
        url = (url or "").rstrip("/") + "?sslmode=require"

    pg_conn = psycopg2.connect(url)
    pg_conn.autocommit = False
    return _PgConnectionWrapper(pg_conn)


def get_sqlite_connection(db_path: str):
    """Devuelve una conexión SQLite estándar."""
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn
