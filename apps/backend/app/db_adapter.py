"""
db_adapter.py — Capa de acceso a base de datos para despliegue cloud-first.

El producto soportado es PostgreSQL (Supabase / Render). SQLite queda permitido
solo como respaldo explícito para pruebas automatizadas cuando MORSA_ALLOW_SQLITE=1.
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3

_DATABASE_URL: str | None = os.getenv("DATABASE_URL")
# Soporte alternativo con variables individuales (evita problemas con contraseñas con caracteres especiales)
_PG_HOST     = os.getenv("PG_HOST", "").strip()
_PG_USER     = os.getenv("PG_USER", "").strip()
_PG_PASSWORD = os.getenv("PG_PASSWORD", "").strip()
_PG_DBNAME   = os.getenv("PG_DBNAME", "postgres").strip()
_PG_PORT     = int(os.getenv("PG_PORT", "5432"))
_USE_PG_PARAMS = bool(_PG_HOST and _PG_PASSWORD)
ALLOW_SQLITE_FALLBACK = os.getenv("MORSA_ALLOW_SQLITE", "0").strip() == "1"

USE_POSTGRES: bool = _USE_PG_PARAMS or bool(_DATABASE_URL)


class DatabaseSchemaError(RuntimeError):
    """Señala que el esquema PostgreSQL no cumple el contrato esperado por la app."""


REQUIRED_PG_SCHEMA: dict[str, tuple[str, ...]] = {
    "proveedores": (
        "id", "razon_social", "nit", "primer_nombre", "segundo_nombre",
        "primer_apellido", "segundo_apellido", "direccion", "telefono", "correo", "tipo",
    ),
    "archivos": (
        "id", "scope", "file_name", "content_type", "size_bytes", "content", "created_at",
    ),
    "egresos": (
        "id", "fecha", "no_documento", "consecutivo", "proveedor_id", "razon_social", "nit",
        "valor", "tipo_gasto", "canal_pago", "factura_electronica", "observaciones",
        "soporte_path", "soporte_name", "support_file_id", "source_module", "source_ref", "source_period",
    ),
    "ingresos": ("id", "fecha", "caja", "bancos", "tarjeta_cr"),
    "nomina_resumen": (
        "id", "periodo", "empleado", "cedula", "valor_dia", "q1_dias", "q1_devengado",
        "q1_aux_transporte", "q1_salud", "q1_pension", "q1_neto", "q2_dias", "q2_devengado",
        "q2_aux_transporte", "q2_salud", "q2_pension", "q2_neto", "total_deduccion",
        "total_incapacidad", "total_descuento", "total_mes", "origen_archivo",
    ),
    "nomina_seg_social": (
        "id", "periodo", "grupo", "concepto", "valor", "observaciones", "origen_archivo",
    ),
    "nomina_novedades": (
        "id", "periodo", "fecha", "empleado", "cedula", "quincena", "naturaleza",
        "tipo_novedad", "valor", "observaciones", "origen_archivo",
    ),
    "nomina_asistencia": (
        "id", "periodo", "empleado", "cedula", "dia", "quincena", "estado", "origen_archivo",
    ),
    "cierres_mensuales": ("id", "mes", "ano", "periodo", "cerrado", "cerrado_at", "observacion"),
    "auditoria": ("id", "created_at", "entidad", "entidad_id", "accion", "periodo", "detalle", "snapshot"),
    "cuadre_caja": (
        "id", "fecha", "saldo_inicial", "ingresos_caja", "egresos_caja",
        "saldo_esperado", "saldo_real", "diferencia", "observaciones", "cerrado", "created_at",
    ),
    "caja_ajustes": ("id", "fecha", "tipo", "valor", "motivo", "observaciones", "created_at"),
    "usuarios": (
        "id", "username", "full_name", "password_hash", "role", "active",
        "created_at", "updated_at", "last_login_at",
    ),
    "auth_sessions": (
        "id", "user_id", "token_hash", "created_at", "expires_at", "last_seen_at",
        "revoked_at", "user_agent", "ip_address",
    ),
    "insumos": (
        "id", "nombre", "categoria", "unidad", "activo", "orden", "created_at",
    ),
    "inventario_diario": (
        "id", "fecha", "turno", "insumo_id", "nombre_extra", "estado", "cantidad", "notas",
        "usuario_id", "created_at", "deleted_at",
    ),
    "inventario_turno": (
        "id", "fecha", "turno", "observaciones", "usuario_id", "created_at", "deleted_at",
    ),
    "schema_migrations": ("version", "name", "applied_at"),
    "login_attempts": (
        "id", "ip_address", "attempted_at", "success",
    ),
}


def get_pg_schema_report():
    report = {
        "backend": "postgresql",
        "ok": True,
        "tables_checked": len(REQUIRED_PG_SCHEMA),
        "missing_tables": [],
        "missing_columns": {},
        "error": None,
    }
    conn = None
    try:
        conn = get_pg_connection()
        rows = conn.execute("""
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
        """).fetchall()
    except Exception as exc:
        report["ok"] = False
        report["error"] = str(exc)
        return report
    finally:
        if conn is not None:
            conn.close()

    existing: dict[str, set[str]] = {}
    for row in rows:
        table_name = row[0]
        column_name = row[1]
        existing.setdefault(table_name, set()).add(column_name)

    for table_name, required_columns in REQUIRED_PG_SCHEMA.items():
        present_columns = existing.get(table_name)
        if not present_columns:
            report["missing_tables"].append(table_name)
            continue
        missing_columns = [column for column in required_columns if column not in present_columns]
        if missing_columns:
            report["missing_columns"][table_name] = missing_columns

    report["ok"] = not report["missing_tables"] and not report["missing_columns"] and not report["error"]
    return report


def require_pg_schema():
    report = get_pg_schema_report()
    if report["ok"]:
        return report

    details: list[str] = []
    if report["error"]:
        details.append(f"no fue posible inspeccionar el esquema: {report['error']}")
    if report["missing_tables"]:
        details.append(f"tablas faltantes: {', '.join(report['missing_tables'])}")
    if report["missing_columns"]:
        missing_parts = [
            f"{table}({', '.join(columns)})"
            for table, columns in sorted(report["missing_columns"].items())
        ]
        details.append(f"columnas faltantes: {'; '.join(missing_parts)}")

    detail_text = ". ".join(details) if details else "desfase de esquema no especificado"
    raise DatabaseSchemaError(
        "El esquema PostgreSQL no coincide con la versión de la aplicación. "
        "Ejecuta supabase/schema.sql o la migración correspondiente. "
        f"Detalle: {detail_text}."
    )


# ── Adaptación de SQL ─────────────────────────────────────────────────────────

def _adapt_sql(sql: str) -> str:
    """Convierte SQL de estilo SQLite a PostgreSQL."""
    # Placeholders ? → %s
    sql = sql.replace("?", "%s")

    # Strings con comillas dobles → comillas simples
    # SQLite permite "valor" como string literal; PostgreSQL solo acepta 'valor'
    # (en PostgreSQL las comillas dobles son para identificadores, no strings)
    sql = re.sub(r'"([^"]*)"', r"'\1'", sql)

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

    # BEGIN IMMEDIATE (SQLite) → BEGIN (PostgreSQL no tiene IMMEDIATE)
    sql = re.sub(r"\bBEGIN\s+IMMEDIATE\b", "BEGIN", sql, flags=re.IGNORECASE)

    # last_insert_rowid() — eliminado; se usa RETURNING id en su lugar
    sql = re.sub(r"SELECT\s+last_insert_rowid\(\)", "SELECT 0", sql, flags=re.IGNORECASE)

    return sql


# ── Row proxy ─────────────────────────────────────────────────────────────────

class _RowProxy:
    """
    Proxy que permite acceso por índice (row[0]) Y por nombre (row["col"]),
    como sqlite3.Row.

    Usa cursor.description para mapear nombres → posición, lo que permite
    manejar correctamente columnas con el mismo nombre (ej: múltiples COALESCE).
    """

    def __init__(self, row_tuple, description):
        self._values = list(row_tuple)
        # Construir mapeo nombre → primer índice (el primero gana en caso de duplicado)
        self._key_map: dict[str, int] = {}
        self._keys: list[str] = []
        if description:
            for i, desc in enumerate(description):
                col_name = desc[0]
                self._keys.append(col_name)
                if col_name not in self._key_map:
                    self._key_map[col_name] = i

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return self._values[self._key_map[key]]

    def __contains__(self, key):
        return key in self._key_map

    def keys(self):
        return self._keys

    def get(self, key, default=None):
        if key in self._key_map:
            return self._values[self._key_map[key]]
        return default

    def items(self):
        return [(self._keys[i], self._values[i]) for i in range(len(self._values))]

    def __iter__(self):
        return iter(self._keys)

    def __repr__(self):
        return f"<Row {dict(zip(self._keys, self._values))}>"


# ── Cursor wrapper ────────────────────────────────────────────────────────────

class _PgCursorWrapper:
    """Envuelve un cursor psycopg2 para imitar sqlite3.Cursor."""

    def __init__(self, pg_cursor):
        self._cur = pg_cursor

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        return _RowProxy(row, self._cur.description)

    def fetchall(self):
        desc = self._cur.description
        return [_RowProxy(r, desc) for r in self._cur.fetchall()]

    @property
    def lastrowid(self):
        return getattr(self._cur, "lastrowid", None)

    def __iter__(self):
        desc = self._cur.description
        for row in self._cur:
            yield _RowProxy(row, desc)


# ── Conexión PostgreSQL wrapper ───────────────────────────────────────────────

class _PgConnectionWrapper:
    """
    Imita la interfaz de sqlite3.Connection para que database.py funcione
    sin cambios con PostgreSQL.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn
        self._cur = pg_conn.cursor()  # cursor estándar (tuplas), NO RealDictCursor
        self._last_id: int | None = None
        self.row_factory = None
        self._broken = False  # se marca True si hay error de conexión

    # ------------------------------------------------------------------
    def execute(self, sql: str, params=None):
        stripped = sql.strip()

        # PRAGMA table_info(tabla) → consultar information_schema de PostgreSQL
        # _ensure_column usa: [row[1] for row in conn.execute('PRAGMA table_info(t)').fetchall()]
        pragma_match = re.match(r"PRAGMA\s+table_info\((\w+)\)", stripped, re.IGNORECASE)
        if pragma_match:
            table_name = pragma_match.group(1)
            self._cur.execute(
                "SELECT ordinal_position, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position",
                (table_name,)
            )
            return _PgCursorWrapper(self._cur)

        # Otros PRAGMA → ignorar silenciosamente y devolver cursor vacío
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
        sql_upper = sql.strip().upper()
        is_insert = sql_upper.startswith("INSERT")
        adapted = _adapt_sql(sql)

        if is_insert and "RETURNING" not in adapted.upper():
            adapted = adapted.rstrip().rstrip(";") + " RETURNING id"

        try:
            self._cur.execute(adapted, params or ())
        except Exception as exc:
            import psycopg2
            if isinstance(exc, psycopg2.OperationalError):
                # Error de red/SSL — marcar conexión como rota para que el pool la descarte
                self._broken = True
            raise

        if is_insert:
            row = self._cur.fetchone()
            if row is not None:
                inserted_id = row[0]
                if inserted_id is not None:
                    self._last_id = int(inserted_id)
                    return _ScalarCursor(self._last_id)

        return _PgCursorWrapper(self._cur)

    def executescript(self, script: str):
        raise DatabaseSchemaError(
            "El runtime PostgreSQL no permite ejecutar DDL dinámico. "
            "Aplica supabase/schema.sql o migraciones formales antes de iniciar la API."
        )

    def commit(self):
        try:
            self._conn.commit()
        except Exception:
            # Con autocommit=True cada sentencia ya fue confirmada; commit() no tiene efecto
            pass

    def rollback(self):
        try:
            self._conn.rollback()
        except Exception:
            # Con autocommit=True no hay transacción activa; rollback() no tiene efecto
            pass

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

    @property
    def lastrowid(self):
        return self._value

    def fetchone(self):
        return _RowProxy((self._value,), [("id", None, None, None, None, None, None)])

    def fetchall(self):
        return [self.fetchone()]

    def __iter__(self):
        return iter([self.fetchone()])


# ── Pool de conexiones ────────────────────────────────────────────────────────

_pool = None  # psycopg2.pool.ThreadedConnectionPool, inicializado en _get_pool()

def _get_pool():
    """Devuelve el pool de conexiones, creándolo si no existe."""
    global _pool
    if _pool is not None:
        return _pool

    import psycopg2
    import psycopg2.pool

    kwargs: dict = {"connect_timeout": 8, "sslmode": "require"}

    if _USE_PG_PARAMS:
        kwargs.update(
            host=_PG_HOST,
            user=_PG_USER or "postgres",
            password=_PG_PASSWORD,
            dbname=_PG_DBNAME,
            port=_PG_PORT,
        )
    elif _DATABASE_URL:
        url = _DATABASE_URL
        if "sslmode" not in url:
            url = url.rstrip("/") + "?sslmode=require"
        # Con URL usamos dsn; los kwargs extra no aplican
        _pool = psycopg2.pool.ThreadedConnectionPool(2, 20, dsn=url)
        return _pool
    else:
        raise RuntimeError("No se encontró configuración de base de datos.")

    _pool = psycopg2.pool.ThreadedConnectionPool(2, 20, **kwargs)
    return _pool


def get_pg_database_health():
    status = {
        "backend": "postgresql",
        "exists": True,
        "ok": True,
        "connected": False,
        "database": None,
        "server_version": None,
        "error": None,
    }
    conn = None
    try:
        conn = get_pg_connection()
        row = conn.execute("SELECT current_database(), version()").fetchone()
        status["connected"] = True
        if row is not None:
            status["database"] = row[0]
            status["server_version"] = row[1]
    except Exception as exc:
        status["ok"] = False
        status["error"] = str(exc)
    finally:
        if conn is not None:
            conn.close()
    return status


# ── Fábrica de conexión pública ───────────────────────────────────────────────

def get_pg_connection():
    """Saca una conexión del pool y la devuelve envuelta en la interfaz compatible.

    Si el pool está temporalmente agotado (todas las conexiones en uso), reintenta
    hasta 5 segundos antes de fallar. Esto evita errores en ráfagas de peticiones
    simultáneas al cargar la página.
    """
    import time
    import psycopg2.pool as _pg_pool

    pool = _get_pool()
    deadline = time.monotonic() + 5.0  # esperar hasta 5 segundos
    delay = 0.1

    while True:
        try:
            pg_conn = pool.getconn()
            pg_conn.autocommit = True  # Evita BEGIN implícito — compatible con Session Pooler
            return _PooledPgConnectionWrapper(pg_conn, pool)
        except _pg_pool.PoolError:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise
            time.sleep(min(delay, remaining))
            delay = min(delay * 2, 1.0)  # backoff exponencial, máximo 1s


class _PooledPgConnectionWrapper(_PgConnectionWrapper):
    """Igual que _PgConnectionWrapper pero devuelve la conexión al pool al cerrar."""

    def __init__(self, pg_conn, pool):
        super().__init__(pg_conn)
        self._pool = pool
        self._returned = False

    def close(self):
        if self._returned:
            return
        self._returned = True
        try:
            self._cur.close()
        except Exception:
            pass
        try:
            # Si la conexión está rota, se le indica al pool que la descarte
            self._pool.putconn(self._conn, close=self._broken)
        except Exception:
            pass

    def __del__(self):
        # Garantiza que la conexión vuelva al pool aunque close() nunca se llame
        # (ej: cuando database.py lanza excepción antes de conn.close())
        self.close()


def get_sqlite_connection(db_path: str):
    """Devuelve una conexión SQLite estándar."""
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


# ── Sistema de migraciones ────────────────────────────────────────────────────

_MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "migrations")
_migrations_logger = logging.getLogger("contabilidad_morsa.migrations")


def run_pending_migrations() -> list[str]:
    """Ejecuta todas las migraciones SQL pendientes en orden.

    - Crea la tabla schema_migrations si no existe.
    - Lee archivos NNNN_descripcion.sql del directorio migrations/.
    - Ejecuta solo los que no han sido aplicados todavía.
    - Registra cada migración aplicada en schema_migrations.
    - Lanza RuntimeError si alguna migración falla (bloquea el startup).
    """
    conn = get_pg_connection()
    applied_versions: list[str] = []
    try:
        # Garantiza que la tabla de control exista antes de cualquier consulta
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                applied_at TEXT NOT NULL
            )
        """)

        rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
        applied = {int(r[0]) for r in rows}

        migrations_dir = os.path.abspath(_MIGRATIONS_DIR)
        if not os.path.isdir(migrations_dir):
            _migrations_logger.warning("Directorio de migraciones no encontrado: %s", migrations_dir)
            return applied_versions

        files = sorted(
            f for f in os.listdir(migrations_dir) if f.endswith(".sql")
        )

        pending = []
        for filename in files:
            try:
                version = int(filename.split("_")[0])
            except (ValueError, IndexError):
                _migrations_logger.warning("Nombre de migración inválido (se ignora): %s", filename)
                continue
            if version not in applied:
                pending.append((version, filename))

        if not pending:
            _migrations_logger.info("Sin migraciones pendientes — esquema actualizado.")
            return applied_versions

        for version, filename in pending:
            filepath = os.path.join(migrations_dir, filename)
            _migrations_logger.info("Aplicando migración %04d: %s", version, filename)

            with open(filepath, encoding="utf-8") as f:
                sql = f.read()

            # Ejecutar sentencia por sentencia (psycopg2 no acepta multi-statement)
            statements = [s.strip() for s in sql.split(";") if s.strip()]
            for stmt in statements:
                # Ignorar bloques que son solo comentarios
                non_comment = "\n".join(
                    line for line in stmt.splitlines() if not line.strip().startswith("--")
                ).strip()
                if not non_comment:
                    continue
                try:
                    conn.execute(stmt)
                except Exception as exc:
                    short = stmt[:300].replace("\n", " ")
                    _migrations_logger.error(
                        "Migración %04d falló en: %s\nError: %s", version, short, exc
                    )
                    raise RuntimeError(
                        f"Migración {version} ({filename}) falló — revisa los logs para más detalles."
                    ) from exc

            from datetime import datetime as _dt
            # Usar el cursor raw para evitar el RETURNING id que agrega el wrapper
            conn._cur.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (%s, %s, %s)",
                (version, filename, _dt.now().isoformat(timespec="seconds")),
            )
            applied_versions.append(filename)
            _migrations_logger.info("Migración %04d aplicada correctamente.", version)

    finally:
        conn.close()

    return applied_versions
