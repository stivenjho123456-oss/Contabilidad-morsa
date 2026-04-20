import sqlite3
import os
import calendar
import json
import re
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path

from app_paths import get_app_data_dir

DB_PATH = os.path.join(get_app_data_dir(), 'contabilidad.db')
SQLITE_TIMEOUT_SECONDS = 30
SQLITE_BUSY_TIMEOUT_MS = SQLITE_TIMEOUT_SECONDS * 1000
WAL_AUTOCHECKPOINT_PAGES = 1000
JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024
_DB_WRITE_LOCK = threading.RLock()


class AppValidationError(ValueError):
    pass


def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=SQLITE_TIMEOUT_SECONDS)
    return _configure_connection(conn)


def _configure_connection(conn):
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute(f'PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}')
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = FULL')
    conn.execute(f'PRAGMA wal_autocheckpoint = {WAL_AUTOCHECKPOINT_PAGES}')
    conn.execute(f'PRAGMA journal_size_limit = {JOURNAL_SIZE_LIMIT_BYTES}')
    conn.execute('PRAGMA temp_store = MEMORY')
    return conn


@contextmanager
def database_write_lock():
    with _DB_WRITE_LOCK:
        yield


def checkpoint_database(mode='PASSIVE'):
    checkpoint_mode = str(mode or 'PASSIVE').upper()
    if checkpoint_mode not in {'PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'}:
        checkpoint_mode = 'PASSIVE'

    with database_write_lock():
        conn = get_connection()
        try:
            row = conn.execute(f'PRAGMA wal_checkpoint({checkpoint_mode})').fetchone()
            return {
                'mode': checkpoint_mode,
                'busy': int(row[0]) if row else 0,
                'log_frames': int(row[1]) if row else 0,
                'checkpointed_frames': int(row[2]) if row else 0,
            }
        finally:
            conn.close()


@contextmanager
def write_transaction(checkpoint=False, checkpoint_mode='PASSIVE'):
    with database_write_lock():
        conn = get_connection()
        try:
            conn.execute('BEGIN IMMEDIATE')
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        if checkpoint:
            checkpoint_database(checkpoint_mode)


def serialized_write(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        with database_write_lock():
            return func(*args, **kwargs)

    return wrapper


def get_database_health():
    db_file = Path(DB_PATH)
    status = {
        'path': str(db_file),
        'exists': db_file.exists(),
        'size_bytes': db_file.stat().st_size if db_file.exists() else 0,
        'ok': True,
        'integrity': 'ok',
        'error': None,
    }
    if not db_file.exists():
        return status

    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            row = conn.execute('PRAGMA integrity_check').fetchone()
            integrity = row[0] if row else 'unknown'
            status['integrity'] = integrity
            status['ok'] = integrity == 'ok'
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        status['ok'] = False
        status['integrity'] = 'database_error'
        status['error'] = str(exc)
    except OSError as exc:
        status['ok'] = False
        status['integrity'] = 'os_error'
        status['error'] = str(exc)
    return status


def _validate_iso_date(value, field_name='fecha'):
    raw = (value or '').strip()
    if not raw:
        raise AppValidationError(f'La {field_name} es obligatoria.')
    try:
        datetime.strptime(raw, '%Y-%m-%d')
    except ValueError as exc:
        raise AppValidationError(f'La {field_name} debe tener formato YYYY-MM-DD.') from exc
    return raw


def _clean_text(value):
    return (value or '').strip()


def _json_dump(value):
    return json.dumps(value, ensure_ascii=False, default=str)


def _extract_inserted_id(cursor):
    lastrowid = getattr(cursor, 'lastrowid', None)
    if lastrowid:
        return int(lastrowid)
    if hasattr(cursor, 'fetchone'):
        row = cursor.fetchone()
        if row is None:
            return None
        try:
            return int(row['id'])
        except Exception:
            pass
        try:
            return int(row[0])
        except Exception:
            return None
    return None


@serialized_write
def init_db():
    conn = get_connection()
    try:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS proveedores (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                razon_social    TEXT NOT NULL,
                nit             TEXT,
                primer_nombre   TEXT,
                segundo_nombre  TEXT,
                primer_apellido TEXT,
                segundo_apellido TEXT,
                direccion       TEXT,
                telefono        TEXT,
                correo          TEXT,
                tipo            TEXT
            );

            CREATE TABLE IF NOT EXISTS egresos (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha         TEXT NOT NULL,
                no_documento  TEXT,
                consecutivo   TEXT,
                proveedor_id  INTEGER,
                razon_social  TEXT NOT NULL,
                nit           TEXT,
                valor         REAL NOT NULL,
                tipo_gasto    TEXT NOT NULL,
                factura_electronica TEXT DEFAULT 'NO',
                observaciones TEXT,
                soporte_path  TEXT,
                soporte_name  TEXT,
                source_module TEXT,
                source_ref    TEXT,
                source_period TEXT,
                FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
            );

            CREATE TABLE IF NOT EXISTS ingresos (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha      TEXT NOT NULL UNIQUE,
                caja       REAL DEFAULT 0,
                bancos     REAL DEFAULT 0,
                tarjeta_cr REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS nomina_resumen (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                periodo           TEXT NOT NULL,
                empleado          TEXT NOT NULL,
                cedula            TEXT,
                valor_dia         REAL DEFAULT 0,
                q1_dias           REAL DEFAULT 0,
                q1_devengado      REAL DEFAULT 0,
                q1_aux_transporte REAL DEFAULT 0,
                q1_salud          REAL DEFAULT 0,
                q1_pension        REAL DEFAULT 0,
                q1_neto           REAL DEFAULT 0,
                q2_dias           REAL DEFAULT 0,
                q2_devengado      REAL DEFAULT 0,
                q2_aux_transporte REAL DEFAULT 0,
                q2_salud          REAL DEFAULT 0,
                q2_pension        REAL DEFAULT 0,
                q2_neto           REAL DEFAULT 0,
                total_deduccion   REAL DEFAULT 0,
                total_incapacidad REAL DEFAULT 0,
                total_descuento   REAL DEFAULT 0,
                total_mes         REAL DEFAULT 0,
                origen_archivo    TEXT
            );

            CREATE TABLE IF NOT EXISTS nomina_seg_social (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                periodo        TEXT NOT NULL,
                grupo          TEXT,
                concepto       TEXT NOT NULL,
                valor          REAL DEFAULT 0,
                observaciones  TEXT,
                origen_archivo TEXT
            );

            CREATE TABLE IF NOT EXISTS nomina_novedades (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                periodo        TEXT NOT NULL,
                fecha          TEXT NOT NULL,
                empleado       TEXT NOT NULL,
                cedula         TEXT,
                quincena       TEXT,
                naturaleza     TEXT NOT NULL,
                tipo_novedad   TEXT NOT NULL,
                valor          REAL DEFAULT 0,
                observaciones  TEXT,
                origen_archivo TEXT
            );

            CREATE TABLE IF NOT EXISTS nomina_asistencia (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                periodo        TEXT NOT NULL,
                empleado       TEXT NOT NULL,
                cedula         TEXT,
                dia            INTEGER NOT NULL,
                quincena       TEXT NOT NULL,
                estado         TEXT NOT NULL,
                origen_archivo TEXT,
                UNIQUE(periodo, empleado, dia)
            );

            CREATE TABLE IF NOT EXISTS cierres_mensuales (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                mes         INTEGER NOT NULL,
                ano         INTEGER NOT NULL,
                periodo     TEXT NOT NULL,
                cerrado     INTEGER NOT NULL DEFAULT 1,
                cerrado_at  TEXT NOT NULL,
                observacion TEXT,
                UNIQUE(mes, ano)
            );

            CREATE TABLE IF NOT EXISTS auditoria (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at   TEXT NOT NULL,
                entidad      TEXT NOT NULL,
                entidad_id   INTEGER,
                accion       TEXT NOT NULL,
                periodo      TEXT,
                detalle      TEXT,
                snapshot     TEXT
            );

            CREATE TABLE IF NOT EXISTS cuadre_caja (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha          TEXT NOT NULL UNIQUE,
                saldo_inicial  REAL NOT NULL DEFAULT 0,
                ingresos_caja  REAL NOT NULL DEFAULT 0,
                egresos_caja   REAL NOT NULL DEFAULT 0,
                saldo_esperado REAL NOT NULL DEFAULT 0,
                saldo_real     REAL,
                diferencia     REAL,
                observaciones  TEXT,
                cerrado        INTEGER NOT NULL DEFAULT 0,
                created_at     TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS caja_ajustes (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha          TEXT NOT NULL,
                tipo           TEXT NOT NULL,
                valor          REAL NOT NULL,
                motivo         TEXT NOT NULL,
                observaciones  TEXT,
                created_at     TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS usuarios (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                username       TEXT NOT NULL UNIQUE,
                full_name      TEXT NOT NULL,
                password_hash  TEXT NOT NULL,
                role           TEXT NOT NULL DEFAULT 'admin',
                active         INTEGER NOT NULL DEFAULT 1,
                created_at     TEXT NOT NULL,
                updated_at     TEXT NOT NULL,
                last_login_at  TEXT
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL,
                token_hash    TEXT NOT NULL UNIQUE,
                created_at    TEXT NOT NULL,
                expires_at    TEXT NOT NULL,
                last_seen_at  TEXT NOT NULL,
                revoked_at    TEXT,
                user_agent    TEXT,
                ip_address    TEXT,
                FOREIGN KEY (user_id) REFERENCES usuarios(id)
            );

            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

            CREATE TABLE IF NOT EXISTS archivos (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                scope         TEXT NOT NULL,
                file_name     TEXT NOT NULL,
                content_type  TEXT,
                size_bytes    INTEGER NOT NULL DEFAULT 0,
                content       BYTEA NOT NULL,
                created_at    TEXT NOT NULL
            );
        ''')
        _ensure_column(conn, 'egresos', 'source_module', 'TEXT')
        _ensure_column(conn, 'egresos', 'source_ref', 'TEXT')
        _ensure_column(conn, 'egresos', 'source_period', 'TEXT')
        _ensure_column(conn, 'egresos', 'factura_electronica', "TEXT DEFAULT 'NO'")
        _ensure_column(conn, 'egresos', 'soporte_path', 'TEXT')
        _ensure_column(conn, 'egresos', 'soporte_name', 'TEXT')
        _ensure_column(conn, 'egresos', 'support_file_id', 'INTEGER')
        _ensure_column(conn, 'egresos', 'canal_pago', "TEXT DEFAULT 'Otro'")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure_column(conn, table, column, definition):
    cols = [row[1] for row in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    if column not in cols:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')


@serialized_write
def log_auditoria(entidad, accion, entidad_id=None, periodo=None, detalle='', snapshot=None):
    conn = get_connection()
    try:
        conn.execute(
            'INSERT INTO auditoria (created_at, entidad, entidad_id, accion, periodo, detalle, snapshot) VALUES (?,?,?,?,?,?,?)',
            (
                datetime.now().isoformat(timespec='seconds'),
                _clean_text(entidad),
                entidad_id,
                _clean_text(accion).upper(),
                _clean_text(periodo),
                _clean_text(detalle),
                _json_dump(snapshot) if snapshot is not None else None,
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_auditoria(limit=120):
    conn = get_connection()
    rows = conn.execute(
        'SELECT * FROM auditoria ORDER BY created_at DESC, id DESC LIMIT ?',
        (int(limit),),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _normalize_username(value):
    username = _clean_text(value).lower()
    if not username:
        raise AppValidationError('El usuario es obligatorio.')
    if len(username) < 3 or len(username) > 60:
        raise AppValidationError('El usuario debe tener entre 3 y 60 caracteres.')
    if not re.fullmatch(r'[a-z0-9._@-]+', username):
        raise AppValidationError('El usuario solo puede incluir letras, números, punto, guion, guion bajo y @.')
    return username


def _public_auth_user(row):
    if not row:
        return None
    data = dict(row)
    data.pop('password_hash', None)
    data['active'] = bool(data.get('active', 1))
    return data


def count_auth_users():
    conn = get_connection()
    try:
        row = conn.execute('SELECT COUNT(*) FROM usuarios').fetchone()
        return int(row[0] if row else 0)
    finally:
        conn.close()


def auth_bootstrap_required():
    return count_auth_users() == 0


def get_auth_user_by_username(username, include_password=False):
    normalized = _clean_text(username).lower()
    if not normalized:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            'SELECT * FROM usuarios WHERE LOWER(username)=LOWER(?) LIMIT 1',
            (normalized,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return dict(row) if include_password else _public_auth_user(row)


def get_auth_user_by_id(user_id, include_password=False):
    conn = get_connection()
    try:
        row = conn.execute('SELECT * FROM usuarios WHERE id=? LIMIT 1', (user_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return dict(row) if include_password else _public_auth_user(row)


@serialized_write
def create_auth_user(username, full_name, password_hash, role='admin', active=True):
    normalized_username = _normalize_username(username)
    normalized_name = _clean_text(full_name)
    normalized_role = _clean_text(role).lower() or 'admin'
    now = datetime.now().isoformat(timespec='seconds')

    if len(normalized_name) < 3:
        raise AppValidationError('El nombre completo debe tener al menos 3 caracteres.')
    if not password_hash:
        raise AppValidationError('La contraseña del usuario no pudo guardarse.')

    conn = get_connection()
    try:
        duplicate = conn.execute(
            'SELECT id FROM usuarios WHERE LOWER(username)=LOWER(?)',
            (normalized_username,),
        ).fetchone()
        if duplicate:
            raise AppValidationError('Ya existe un usuario con ese nombre.')

        cursor = conn.execute(
            '''
            INSERT INTO usuarios (username, full_name, password_hash, role, active, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?)
            ''',
            (
                normalized_username,
                normalized_name,
                password_hash,
                normalized_role,
                1 if active else 0,
                now,
                now,
            ),
        )
        user_id = _extract_inserted_id(cursor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    user = get_auth_user_by_id(user_id)
    log_auditoria('usuarios', 'CREATE', entidad_id=user_id, detalle=f'Usuario {normalized_username} creado.', snapshot=user)
    return user


@serialized_write
def set_auth_last_login(user_id):
    conn = get_connection()
    try:
        now = datetime.now().isoformat(timespec='seconds')
        conn.execute(
            'UPDATE usuarios SET last_login_at=?, updated_at=? WHERE id=?',
            (now, now, user_id),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@serialized_write
def cleanup_auth_sessions():
    conn = get_connection()
    try:
        now = datetime.now().isoformat(timespec='seconds')
        conn.execute(
            'DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL',
            (now,),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_auth_session_by_hash(token_hash):
    conn = get_connection()
    try:
        now = datetime.now().isoformat(timespec='seconds')
        row = conn.execute(
            '''
            SELECT
                s.id AS session_id,
                s.user_id AS session_user_id,
                s.created_at AS session_created_at,
                s.expires_at AS session_expires_at,
                s.last_seen_at AS session_last_seen_at,
                u.id AS user_id,
                u.username,
                u.full_name,
                u.role,
                u.active,
                u.created_at AS user_created_at,
                u.updated_at AS user_updated_at,
                u.last_login_at
            FROM auth_sessions s
            JOIN usuarios u ON u.id = s.user_id
            WHERE s.token_hash = ?
              AND s.revoked_at IS NULL
              AND s.expires_at > ?
              AND u.active = 1
            LIMIT 1
            ''',
            (token_hash, now),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return None

    data = dict(row)
    return {
        'id': data['session_id'],
        'user_id': data['session_user_id'],
        'created_at': data['session_created_at'],
        'expires_at': data['session_expires_at'],
        'last_seen_at': data['session_last_seen_at'],
        'user': {
            'id': data['user_id'],
            'username': data['username'],
            'full_name': data['full_name'],
            'role': data['role'],
            'active': bool(data['active']),
            'created_at': data['user_created_at'],
            'updated_at': data['user_updated_at'],
            'last_login_at': data['last_login_at'],
        },
    }


@serialized_write
def create_auth_session(user_id, token_hash, expires_at, user_agent='', ip_address=''):
    conn = get_connection()
    try:
        now = datetime.now().isoformat(timespec='seconds')
        conn.execute(
            'DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL',
            (now,),
        )
        cursor = conn.execute(
            '''
            INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip_address)
            VALUES (?,?,?,?,?,?,?)
            ''',
            (
                user_id,
                token_hash,
                now,
                expires_at,
                now,
                _clean_text(user_agent),
                _clean_text(ip_address),
            ),
        )
        session_id = _extract_inserted_id(cursor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    session = get_auth_session_by_hash(token_hash)
    if session:
        session['id'] = session_id or session['id']
    return session


@serialized_write
def touch_auth_session(session_id):
    conn = get_connection()
    try:
        conn.execute(
            'UPDATE auth_sessions SET last_seen_at=? WHERE id=?',
            (datetime.now().isoformat(timespec='seconds'), session_id),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@serialized_write
def revoke_auth_session(token_hash):
    conn = get_connection()
    try:
        conn.execute(
            'UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL',
            (datetime.now().isoformat(timespec='seconds'), token_hash),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@serialized_write
def create_archivo_blob(scope, file_name, content_type, size_bytes, content):
    conn = get_connection()
    try:
        cursor = conn.execute(
            '''
            INSERT INTO archivos (scope, file_name, content_type, size_bytes, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (
                _clean_text(scope) or 'general',
                _clean_text(file_name) or 'archivo',
                _clean_text(content_type),
                int(size_bytes or 0),
                bytes(content or b''),
                datetime.now().isoformat(timespec='seconds'),
            ),
        )
        archivo_id = _extract_inserted_id(cursor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return archivo_id


def get_archivo_blob(archivo_id):
    conn = get_connection()
    try:
        row = conn.execute('SELECT * FROM archivos WHERE id=? LIMIT 1', (archivo_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    data = dict(row)
    if isinstance(data.get('content'), memoryview):
        data['content'] = data['content'].tobytes()
    return data


@serialized_write
def delete_archivo_blob(archivo_id):
    conn = get_connection()
    try:
        conn.execute('DELETE FROM archivos WHERE id=?', (archivo_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─── Proveedores ────────────────────────────────────────────────────────────

def get_proveedores(search=''):
    conn = get_connection()
    if search:
        rows = conn.execute(
            'SELECT * FROM proveedores WHERE razon_social LIKE ? OR nit LIKE ? ORDER BY razon_social',
            (f'%{search}%', f'%{search}%')
        ).fetchall()
    else:
        rows = conn.execute('SELECT * FROM proveedores ORDER BY razon_social').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_proveedor_by_id(prov_id):
    conn = get_connection()
    row = conn.execute('SELECT * FROM proveedores WHERE id=?', (prov_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


@serialized_write
def save_proveedor(data, prov_id=None):
    conn = get_connection()
    razon_social = _clean_text(data.get('razon_social'))
    nit = _clean_text(data.get('nit'))
    correo = _clean_text(data.get('correo'))

    if not razon_social:
        conn.close()
        raise AppValidationError('La razon social es obligatoria.')

    duplicate = conn.execute(
        'SELECT id FROM proveedores WHERE UPPER(TRIM(razon_social))=UPPER(TRIM(?)) AND id != COALESCE(?, -1)',
        (razon_social, prov_id),
    ).fetchone()
    if duplicate:
        conn.close()
        raise AppValidationError('Ya existe un proveedor con esa razon social.')

    if nit:
        duplicate_nit = conn.execute(
            'SELECT id FROM proveedores WHERE TRIM(nit)=TRIM(?) AND id != COALESCE(?, -1)',
            (nit, prov_id),
        ).fetchone()
        if duplicate_nit:
            conn.close()
            raise AppValidationError('Ya existe un proveedor con ese NIT.')

    if correo and '@' not in correo:
        conn.close()
        raise AppValidationError('El correo no tiene un formato valido.')

    fields = ('razon_social', 'nit', 'primer_nombre', 'segundo_nombre',
              'primer_apellido', 'segundo_apellido', 'direccion', 'telefono', 'correo', 'tipo')
    values = (
        razon_social,
        nit,
        _clean_text(data.get('primer_nombre')),
        _clean_text(data.get('segundo_nombre')),
        _clean_text(data.get('primer_apellido')),
        _clean_text(data.get('segundo_apellido')),
        _clean_text(data.get('direccion')),
        _clean_text(data.get('telefono')),
        correo,
        _clean_text(data.get('tipo')),
    )
    if prov_id:
        set_clause = ', '.join(f'{f}=?' for f in fields)
        conn.execute(f'UPDATE proveedores SET {set_clause} WHERE id=?', (*values, prov_id))
        entity_id = prov_id
        audit_action = 'UPDATE'
    else:
        placeholders = ', '.join('?' for _ in fields)
        cursor = conn.execute(f'INSERT INTO proveedores ({", ".join(fields)}) VALUES ({placeholders})', values)
        entity_id = _extract_inserted_id(cursor)
        audit_action = 'CREATE'
    conn.commit()
    conn.close()
    log_auditoria('proveedor', audit_action, entity_id, None, razon_social, {
        'nit': nit,
        'telefono': _clean_text(data.get('telefono')),
        'correo': correo,
    })


@serialized_write
def delete_proveedor(prov_id):
    conn = get_connection()
    row = conn.execute('SELECT * FROM proveedores WHERE id=?', (prov_id,)).fetchone()
    used = conn.execute(
        'SELECT COUNT(*) FROM egresos WHERE proveedor_id=?',
        (prov_id,),
    ).fetchone()[0]
    if used:
        conn.close()
        raise AppValidationError('No puedes eliminar este proveedor porque ya tiene egresos asociados.')
    conn.execute('DELETE FROM proveedores WHERE id=?', (prov_id,))
    conn.commit()
    conn.close()
    if row:
        log_auditoria('proveedor', 'DELETE', prov_id, None, row['razon_social'], dict(row))


# ─── Egresos ────────────────────────────────────────────────────────────────

def get_egresos(mes=None, ano=None, tipo=None, search=''):
    conn = get_connection()
    query = 'SELECT * FROM egresos WHERE 1=1'
    params = []
    if mes:
        query += " AND strftime('%m', fecha)=?"
        params.append(f'{int(mes):02d}')
    if ano:
        query += " AND strftime('%Y', fecha)=?"
        params.append(str(ano))
    if tipo and tipo != 'Todos':
        query += ' AND tipo_gasto=?'
        params.append(tipo)
    if search:
        query += ' AND (razon_social LIKE ? OR no_documento LIKE ?)'
        params.extend([f'%{search}%', f'%{search}%'])
    query += ' ORDER BY fecha DESC'
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@serialized_write
def save_egreso(data, egreso_id=None):
    fecha = _validate_iso_date(data.get('fecha'))
    mes, ano = month_year_from_date(fecha)
    ensure_period_open(mes, ano)
    razon_social = _clean_text(data.get('razon_social'))
    tipo_gasto = _clean_text(data.get('tipo_gasto')).upper()
    factura_electronica = _clean_text(data.get('factura_electronica')).upper() or 'NO'
    if not razon_social:
        raise AppValidationError('El proveedor o razon social es obligatorio.')
    if not tipo_gasto:
        raise AppValidationError('La naturaleza del gasto es obligatoria.')
    if factura_electronica not in {'SI', 'NO'}:
        raise AppValidationError('El campo factura electrónica debe ser SI o NO.')
    try:
        valor = float(data.get('valor', 0) or 0)
    except (TypeError, ValueError) as exc:
        raise AppValidationError('El valor debe ser numerico.') from exc
    if valor <= 0:
        raise AppValidationError('El valor debe ser mayor a cero.')

    canal_pago = _clean_text(data.get('canal_pago')) or 'Otro'
    if canal_pago not in {'Caja', 'Bancos', 'Tarjeta CR', 'Otro'}:
        canal_pago = 'Otro'

    fields = ('fecha', 'no_documento', 'consecutivo', 'proveedor_id',
              'razon_social', 'nit', 'valor', 'tipo_gasto', 'canal_pago', 'factura_electronica',
              'observaciones', 'soporte_path', 'soporte_name', 'support_file_id', 'source_module', 'source_ref', 'source_period')
    values = (
        fecha,
        _clean_text(data.get('no_documento')),
        _clean_text(data.get('consecutivo')),
        data.get('proveedor_id') or None,
        razon_social,
        _clean_text(data.get('nit')),
        valor,
        tipo_gasto,
        canal_pago,
        factura_electronica,
        _clean_text(data.get('observaciones')),
        _clean_text(data.get('soporte_path')),
        _clean_text(data.get('soporte_name')),
        data.get('support_file_id') or None,
        _clean_text(data.get('source_module')),
        _clean_text(data.get('source_ref')),
        _clean_text(data.get('source_period')),
    )
    conn = get_connection()
    try:
        if egreso_id:
            set_clause = ', '.join(f'{f}=?' for f in fields)
            conn.execute(f'UPDATE egresos SET {set_clause} WHERE id=?', (*values, egreso_id))
            audit_action = 'UPDATE'
            entity_id = egreso_id
        else:
            placeholders = ', '.join('?' for _ in fields)
            cursor = conn.execute(f'INSERT INTO egresos ({", ".join(fields)}) VALUES ({placeholders})', values)
            entity_id = _extract_inserted_id(cursor)
            audit_action = 'CREATE'
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    log_auditoria('egreso', audit_action, entity_id, period_from_month_year(mes, ano), razon_social, {
        'fecha': fecha,
        'razon_social': razon_social,
        'valor': valor,
        'tipo_gasto': tipo_gasto,
    })
    return entity_id


@serialized_write
def delete_egreso(egreso_id):
    conn = get_connection()
    row = conn.execute('SELECT * FROM egresos WHERE id=?', (egreso_id,)).fetchone()
    if row:
        mes, ano = month_year_from_date(row['fecha'])
        ensure_period_open(mes, ano)
    conn.execute('DELETE FROM egresos WHERE id=?', (egreso_id,))
    conn.commit()
    conn.close()
    if row and 'support_file_id' in row and row['support_file_id']:
        try:
            delete_archivo_blob(row['support_file_id'])
        except Exception:
            pass
    if row:
        log_auditoria('egreso', 'DELETE', egreso_id, period_from_month_year(mes, ano), row['razon_social'], dict(row))


# ─── Ingresos ───────────────────────────────────────────────────────────────

def get_ingresos(mes=None, ano=None):
    conn = get_connection()
    query = 'SELECT * FROM ingresos WHERE 1=1'
    params = []
    if mes:
        query += " AND strftime('%m', fecha)=?"
        params.append(f'{int(mes):02d}')
    if ano:
        query += " AND strftime('%Y', fecha)=?"
        params.append(str(ano))
    query += ' ORDER BY fecha DESC'
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@serialized_write
def save_ingreso(data, ingreso_id=None):
    fecha = _validate_iso_date(data.get('fecha'))
    mes, ano = month_year_from_date(fecha)
    ensure_period_open(mes, ano)
    try:
        caja = float(data.get('caja') or 0)
        bancos = float(data.get('bancos') or 0)
        tarjeta_cr = float(data.get('tarjeta_cr') or 0)
    except (TypeError, ValueError) as exc:
        raise AppValidationError('Los valores deben ser numericos.') from exc

    if min(caja, bancos, tarjeta_cr) < 0:
        raise AppValidationError('Los ingresos no pueden ser negativos.')
    if caja == 0 and bancos == 0 and tarjeta_cr == 0:
        raise AppValidationError('Debes registrar al menos un valor mayor a cero.')

    conn = get_connection()
    duplicate = conn.execute(
        'SELECT id FROM ingresos WHERE fecha=? AND id != COALESCE(?, -1)',
        (fecha, ingreso_id),
    ).fetchone()
    if duplicate:
        conn.close()
        raise AppValidationError('Ya existe un ingreso para esa fecha. Usa Editar si quieres reemplazarlo.')

    try:
        if ingreso_id:
            conn.execute(
                'UPDATE ingresos SET fecha=?, caja=?, bancos=?, tarjeta_cr=? WHERE id=?',
                (fecha, caja, bancos, tarjeta_cr, ingreso_id)
            )
            entity_id = ingreso_id
            audit_action = 'UPDATE'
        else:
            cursor = conn.execute(
                'INSERT INTO ingresos (fecha, caja, bancos, tarjeta_cr) VALUES (?,?,?,?)',
                (fecha, caja, bancos, tarjeta_cr)
            )
            entity_id = _extract_inserted_id(cursor)
            audit_action = 'CREATE'
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    log_auditoria('ingreso', audit_action, entity_id, period_from_month_year(mes, ano), fecha, {
        'fecha': fecha,
        'caja': caja,
        'bancos': bancos,
        'tarjeta_cr': tarjeta_cr,
    })


@serialized_write
def delete_ingreso(ingreso_id):
    conn = get_connection()
    row = conn.execute('SELECT * FROM ingresos WHERE id=?', (ingreso_id,)).fetchone()
    if row:
        mes, ano = month_year_from_date(row['fecha'])
        ensure_period_open(mes, ano)
    conn.execute('DELETE FROM ingresos WHERE id=?', (ingreso_id,))
    conn.commit()
    conn.close()
    if row:
        log_auditoria('ingreso', 'DELETE', ingreso_id, period_from_month_year(mes, ano), row['fecha'], dict(row))


# ─── Dashboard stats ────────────────────────────────────────────────────────

def get_dashboard_stats(mes=None, ano=None):
    conn = get_connection()
    where = 'WHERE 1=1'
    params = []
    if mes:
        where += " AND strftime('%m', fecha)=?"
        params.append(f'{int(mes):02d}')
    if ano:
        where += " AND strftime('%Y', fecha)=?"
        params.append(str(ano))

    total_egresos = conn.execute(
        f'SELECT COALESCE(SUM(valor),0) FROM egresos {where}', params).fetchone()[0]

    egresos_by_tipo = conn.execute(
        f'SELECT tipo_gasto, COALESCE(SUM(valor),0) as t FROM egresos {where} '
        f'GROUP BY tipo_gasto ORDER BY t DESC', params).fetchall()

    row = conn.execute(
        f'SELECT COALESCE(SUM(caja),0), COALESCE(SUM(bancos),0), COALESCE(SUM(tarjeta_cr),0) '
        f'FROM ingresos {where}', params).fetchone()
    caja, bancos, tarjeta = row[0], row[1], row[2]
    total_ingresos = caja + bancos + tarjeta

    recent = conn.execute(
        f'SELECT fecha, razon_social, valor, tipo_gasto FROM egresos {where} '
        'ORDER BY fecha DESC LIMIT 10',
        params,
    ).fetchall()

    conn.close()
    return {
        'total_egresos': total_egresos,
        'total_ingresos': total_ingresos,
        'utilidad': total_ingresos - total_egresos,
        'egresos_by_tipo': [(r[0], r[1]) for r in egresos_by_tipo],
        'ingresos_breakdown': {'caja': caja, 'bancos': bancos, 'tarjeta_cr': tarjeta},
        'recent_egresos': [dict(r) for r in recent],
    }


def get_tipos_gasto_distintos():
    conn = get_connection()
    rows = conn.execute(
        'SELECT DISTINCT tipo_gasto FROM egresos WHERE tipo_gasto IS NOT NULL ORDER BY tipo_gasto'
    ).fetchall()
    conn.close()
    tipos = [r[0] for r in rows if r[0]]
    defaults = ['COSTO', 'GASTO', 'SERVICIOS', 'EMPLEADO', 'SEG SOCIAL', 'PAPELERIA', 'PUBLICIDAD']
    for d in defaults:
        if d not in tipos:
            tipos.append(d)
    return sorted(set(tipos))


# ─── Nomina ─────────────────────────────────────────────────────────────────

@serialized_write
def clear_nomina(origen_archivo=None, conn=None):
    owns_conn = conn is None
    conn = conn or get_connection()
    try:
        if origen_archivo:
            conn.execute('DELETE FROM nomina_resumen WHERE origen_archivo=?', (origen_archivo,))
            conn.execute('DELETE FROM nomina_seg_social WHERE origen_archivo=?', (origen_archivo,))
            conn.execute('DELETE FROM nomina_asistencia WHERE origen_archivo=?', (origen_archivo,))
        else:
            conn.execute('DELETE FROM nomina_resumen')
            conn.execute('DELETE FROM nomina_seg_social')
            conn.execute('DELETE FROM nomina_asistencia')
        if owns_conn:
            conn.commit()
    except Exception:
        if owns_conn:
            conn.rollback()
        raise
    finally:
        if owns_conn:
            conn.close()


@serialized_write
def save_nomina_resumen(data, resumen_id=None, conn=None):
    owns_conn = conn is None
    conn = conn or get_connection()
    fields = (
        'periodo', 'empleado', 'cedula', 'valor_dia', 'q1_dias', 'q1_devengado',
        'q1_aux_transporte', 'q1_salud', 'q1_pension', 'q1_neto', 'q2_dias',
        'q2_devengado', 'q2_aux_transporte', 'q2_salud', 'q2_pension', 'q2_neto',
        'total_deduccion', 'total_incapacidad', 'total_descuento', 'total_mes',
        'origen_archivo'
    )
    values = tuple(data.get(field) for field in fields)
    try:
        if resumen_id:
            set_clause = ', '.join(f'{f}=?' for f in fields)
            conn.execute(
                f'UPDATE nomina_resumen SET {set_clause} WHERE id=?',
                (*values, resumen_id),
            )
        else:
            placeholders = ', '.join('?' for _ in fields)
            conn.execute(
                f'INSERT INTO nomina_resumen ({", ".join(fields)}) VALUES ({placeholders})',
                values,
            )
        if owns_conn:
            conn.commit()
    except Exception:
        if owns_conn:
            conn.rollback()
        raise
    finally:
        if owns_conn:
            conn.close()


@serialized_write
def delete_nomina_resumen(resumen_id):
    conn = get_connection()
    conn.execute('DELETE FROM nomina_resumen WHERE id=?', (resumen_id,))
    conn.commit()
    conn.close()


@serialized_write
def save_nomina_seg_social(data, seg_id=None, conn=None):
    owns_conn = conn is None
    conn = conn or get_connection()
    fields = ('periodo', 'grupo', 'concepto', 'valor', 'observaciones', 'origen_archivo')
    values = tuple(data.get(field) for field in fields)
    try:
        if seg_id:
            set_clause = ', '.join(f'{f}=?' for f in fields)
            conn.execute(
                f'UPDATE nomina_seg_social SET {set_clause} WHERE id=?',
                (*values, seg_id),
            )
        else:
            placeholders = ', '.join('?' for _ in fields)
            conn.execute(
                f'INSERT INTO nomina_seg_social ({", ".join(fields)}) VALUES ({placeholders})',
                values,
            )
        if owns_conn:
            conn.commit()
    except Exception:
        if owns_conn:
            conn.rollback()
        raise
    finally:
        if owns_conn:
            conn.close()


@serialized_write
def delete_nomina_seg_social(seg_id):
    conn = get_connection()
    conn.execute('DELETE FROM nomina_seg_social WHERE id=?', (seg_id,))
    conn.commit()
    conn.close()


def _nomina_asistencia_conn(conn, periodo=None, empleado=None):
    query = 'SELECT * FROM nomina_asistencia WHERE 1=1'
    params = []
    if periodo and periodo != 'Todos':
        query += ' AND periodo=?'
        params.append(periodo)
    if empleado:
        query += ' AND empleado LIKE ?'
        params.append(f'%{empleado}%')
    query += ' ORDER BY empleado, dia'
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def get_nomina_asistencia(periodo=None, empleado=None):
    conn = get_connection()
    try:
        return _nomina_asistencia_conn(conn, periodo=periodo, empleado=empleado)
    finally:
        conn.close()


@serialized_write
def save_nomina_asistencia(data, asistencia_id=None, conn=None, log_audit=True):
    periodo = _clean_text(data.get('periodo')).upper()
    empleado = _clean_text(data.get('empleado'))
    cedula = _clean_text(data.get('cedula'))
    try:
        dia = int(data.get('dia'))
    except (TypeError, ValueError) as exc:
        raise AppValidationError('El dia de asistencia debe ser numerico.') from exc
    quincena = _clean_text(data.get('quincena')).upper()
    estado = _clean_text(data.get('estado')).upper()
    origen_archivo = _clean_text(data.get('origen_archivo'))

    estados_validos = {
        'LABORADO', 'DOMINGO_FESTIVO', 'NO_FUE', 'INCAPACIDAD',
        'PERMISO_NO_REMUNERADO', 'CITA_MEDICA', 'VACACIONES',
    }

    if not periodo:
        raise AppValidationError('El periodo es obligatorio.')
    start_date, _ = _period_to_dates(periodo)
    if start_date:
        mes, ano = month_year_from_date(start_date)
        ensure_period_open(mes, ano)
    if not empleado:
        raise AppValidationError('El empleado es obligatorio.')
    if dia < 1 or dia > 31:
        raise AppValidationError('El dia de asistencia debe estar entre 1 y 31.')
    if quincena not in {'Q1', 'Q2'}:
        quincena = 'Q1' if dia <= 15 else 'Q2'
    if estado not in estados_validos:
        raise AppValidationError('El estado de asistencia no es valido.')

    owns_conn = conn is None
    conn = conn or get_connection()
    fields = ('periodo', 'empleado', 'cedula', 'dia', 'quincena', 'estado', 'origen_archivo')
    values = (periodo, empleado, cedula, dia, quincena, estado, origen_archivo)
    try:
        if asistencia_id:
            set_clause = ', '.join(f'{f}=?' for f in fields)
            conn.execute(f'UPDATE nomina_asistencia SET {set_clause} WHERE id=?', (*values, asistencia_id))
            entity_id = asistencia_id
            audit_action = 'UPDATE'
        else:
            existing = conn.execute(
                'SELECT id FROM nomina_asistencia WHERE periodo=? AND empleado=? AND dia=?',
                (periodo, empleado, dia),
            ).fetchone()
            if existing:
                set_clause = ', '.join(f'{f}=?' for f in fields)
                conn.execute(f'UPDATE nomina_asistencia SET {set_clause} WHERE id=?', (*values, existing['id']))
                entity_id = existing['id']
                audit_action = 'UPDATE'
            else:
                placeholders = ', '.join('?' for _ in fields)
                cursor = conn.execute(
                    f'INSERT INTO nomina_asistencia ({", ".join(fields)}) VALUES ({placeholders})',
                    values,
                )
                entity_id = _extract_inserted_id(cursor)
                audit_action = 'CREATE'
        if owns_conn:
            conn.commit()
    except Exception:
        if owns_conn:
            conn.rollback()
        raise
    finally:
        if owns_conn:
            conn.close()
    if log_audit:
        log_auditoria('nomina_asistencia', audit_action, entity_id, periodo, empleado, {
            'dia': dia,
            'quincena': quincena,
            'estado': estado,
        })


@serialized_write
def delete_nomina_asistencia(asistencia_id):
    conn = get_connection()
    row = conn.execute('SELECT * FROM nomina_asistencia WHERE id=?', (asistencia_id,)).fetchone()
    if row:
        start_date, _ = _period_to_dates(row['periodo'])
        if start_date:
            mes, ano = month_year_from_date(start_date)
            ensure_period_open(mes, ano)
    conn.execute('DELETE FROM nomina_asistencia WHERE id=?', (asistencia_id,))
    conn.commit()
    conn.close()
    if row:
        log_auditoria('nomina_asistencia', 'DELETE', asistencia_id, row['periodo'], row['empleado'], dict(row))


def _nomina_asistencia_resumen_conn(conn, periodo=None):
    query = '''
        SELECT
            periodo,
            empleado,
            cedula,
            SUM(CASE WHEN estado = 'LABORADO' AND dia <= 15 THEN 1 ELSE 0 END) AS q1_laborados,
            SUM(CASE WHEN estado = 'LABORADO' AND dia > 15 THEN 1 ELSE 0 END) AS q2_laborados,
            SUM(CASE WHEN estado = 'LABORADO' THEN 1 ELSE 0 END) AS dias_laborados,
            SUM(CASE WHEN estado = 'INCAPACIDAD' THEN 1 ELSE 0 END) AS dias_incapacidad,
            SUM(CASE WHEN estado = 'VACACIONES' THEN 1 ELSE 0 END) AS dias_vacaciones,
            SUM(CASE WHEN estado = 'NO_FUE' THEN 1 ELSE 0 END) AS dias_no_fue,
            SUM(CASE WHEN estado = 'PERMISO_NO_REMUNERADO' THEN 1 ELSE 0 END) AS dias_permiso_no_remunerado,
            SUM(CASE WHEN estado = 'CITA_MEDICA' THEN 1 ELSE 0 END) AS dias_cita_medica,
            SUM(CASE WHEN estado = 'DOMINGO_FESTIVO' THEN 1 ELSE 0 END) AS dias_domingo_festivo
        FROM nomina_asistencia
        WHERE 1=1
    '''
    params = []
    if periodo and periodo != 'Todos':
        query += ' AND periodo=?'
        params.append(periodo)
    query += '''
        GROUP BY periodo, empleado, cedula
        ORDER BY UPPER(COALESCE(empleado, '')), empleado
    '''
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def get_nomina_asistencia_resumen(periodo=None):
    conn = get_connection()
    try:
        return _nomina_asistencia_resumen_conn(conn, periodo=periodo)
    finally:
        conn.close()


def _nomina_novedades_conn(conn, periodo=None, search=''):
    query = 'SELECT * FROM nomina_novedades WHERE 1=1'
    params = []
    if periodo and periodo != 'Todos':
        query += ' AND periodo=?'
        params.append(periodo)
    if search:
        query += ' AND (empleado LIKE ? OR cedula LIKE ? OR tipo_novedad LIKE ? OR observaciones LIKE ?)'
        params.extend([f'%{search}%', f'%{search}%', f'%{search}%', f'%{search}%'])
    query += ' ORDER BY fecha DESC, empleado'
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def get_nomina_novedades(periodo=None, search=''):
    conn = get_connection()
    try:
        return _nomina_novedades_conn(conn, periodo=periodo, search=search)
    finally:
        conn.close()


@serialized_write
def save_nomina_novedad(data, novedad_id=None):
    periodo = _clean_text(data.get('periodo')).upper()
    fecha = _validate_iso_date(data.get('fecha'))
    empleado = _clean_text(data.get('empleado'))
    naturaleza = _clean_text(data.get('naturaleza')).upper()
    tipo_novedad = _clean_text(data.get('tipo_novedad')).upper()
    try:
        valor = float(data.get('valor', 0) or 0)
    except (TypeError, ValueError) as exc:
        raise AppValidationError('El valor de la novedad debe ser numerico.') from exc

    if not periodo:
        raise AppValidationError('El periodo es obligatorio.')
    start_date, _ = _period_to_dates(periodo)
    if start_date:
        mes, ano = month_year_from_date(start_date)
        ensure_period_open(mes, ano)
    if not empleado:
        raise AppValidationError('El empleado es obligatorio.')
    if naturaleza not in {'DEVENGADO', 'DEDUCCION'}:
        raise AppValidationError('La naturaleza de la novedad no es valida.')
    if not tipo_novedad:
        raise AppValidationError('El tipo de novedad es obligatorio.')
    if valor <= 0:
        raise AppValidationError('El valor de la novedad debe ser mayor a cero.')

    conn = get_connection()
    fields = (
        'periodo', 'fecha', 'empleado', 'cedula', 'quincena',
        'naturaleza', 'tipo_novedad', 'valor', 'observaciones', 'origen_archivo'
    )
    values = (
        periodo,
        fecha,
        empleado,
        _clean_text(data.get('cedula')),
        _clean_text(data.get('quincena')),
        naturaleza,
        tipo_novedad,
        valor,
        _clean_text(data.get('observaciones')),
        _clean_text(data.get('origen_archivo')),
    )
    try:
        if novedad_id:
            set_clause = ', '.join(f'{f}=?' for f in fields)
            conn.execute(f'UPDATE nomina_novedades SET {set_clause} WHERE id=?', (*values, novedad_id))
            entity_id = novedad_id
            audit_action = 'UPDATE'
        else:
            placeholders = ', '.join('?' for _ in fields)
            cursor = conn.execute(
                f'INSERT INTO nomina_novedades ({", ".join(fields)}) VALUES ({placeholders})',
                values,
            )
            entity_id = _extract_inserted_id(cursor)
            audit_action = 'CREATE'
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    log_auditoria('nomina_novedad', audit_action, entity_id, periodo, empleado, {
        'fecha': fecha,
        'naturaleza': naturaleza,
        'tipo_novedad': tipo_novedad,
        'valor': valor,
    })


@serialized_write
def delete_nomina_novedad(novedad_id):
    conn = get_connection()
    row = conn.execute('SELECT * FROM nomina_novedades WHERE id=?', (novedad_id,)).fetchone()
    if row:
        start_date, _ = _period_to_dates(row['periodo'])
        if start_date:
            mes, ano = month_year_from_date(start_date)
            ensure_period_open(mes, ano)
    conn.execute('DELETE FROM nomina_novedades WHERE id=?', (novedad_id,))
    conn.commit()
    conn.close()
    if row:
        log_auditoria('nomina_novedad', 'DELETE', novedad_id, row['periodo'], row['empleado'], dict(row))


def _nomina_periodos_conn(conn):
    rows = conn.execute('''
        SELECT periodo FROM (
            SELECT DISTINCT periodo FROM nomina_resumen WHERE periodo IS NOT NULL AND periodo != ""
            UNION
            SELECT DISTINCT periodo FROM nomina_novedades WHERE periodo IS NOT NULL AND periodo != ""
            UNION
            SELECT DISTINCT periodo FROM nomina_asistencia WHERE periodo IS NOT NULL AND periodo != ""
        )
        ORDER BY periodo DESC
    ''').fetchall()
    return [r[0] for r in rows]


def get_nomina_periodos():
    conn = get_connection()
    try:
        return _nomina_periodos_conn(conn)
    finally:
        conn.close()


def _nomina_resumen_conn(conn, periodo=None, search=''):
    query = 'SELECT * FROM nomina_resumen WHERE 1=1'
    params = []
    if periodo and periodo != 'Todos':
        query += ' AND periodo=?'
        params.append(periodo)
    if search:
        query += ' AND (empleado LIKE ? OR cedula LIKE ?)'
        params.extend([f'%{search}%', f'%{search}%'])
    query += ' ORDER BY empleado'
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def get_nomina_resumen(periodo=None, search=''):
    conn = get_connection()
    try:
        return _nomina_resumen_conn(conn, periodo=periodo, search=search)
    finally:
        conn.close()


def _nomina_seg_social_conn(conn, periodo=None):
    query = 'SELECT * FROM nomina_seg_social WHERE 1=1'
    params = []
    if periodo and periodo != 'Todos':
        query += ' AND periodo=?'
        params.append(periodo)
    query += ' ORDER BY grupo, concepto'
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def get_nomina_seg_social(periodo=None):
    conn = get_connection()
    try:
        return _nomina_seg_social_conn(conn, periodo=periodo)
    finally:
        conn.close()


def _nomina_stats_conn(conn, periodo=None):
    resumen = _nomina_resumen_conn(conn, periodo=periodo)
    seg = _nomina_seg_social_conn(conn, periodo=periodo)
    novedades = _nomina_novedades_conn(conn, periodo=periodo)
    asistencia = _nomina_asistencia_resumen_conn(conn, periodo=periodo)
    return _build_nomina_stats_payload(resumen, seg, novedades, asistencia)


def get_nomina_stats(periodo=None):
    conn = get_connection()
    try:
        return _nomina_stats_conn(conn, periodo=periodo)
    finally:
        conn.close()


def _nomina_workflow_conn(conn, periodo=None):
    periodo = periodo or 'Todos'
    asistencia = _nomina_asistencia_resumen_conn(conn, periodo=periodo)
    resumen = _nomina_resumen_conn(conn, periodo=periodo)
    seg = _nomina_seg_social_conn(conn, periodo=periodo)
    novedades = _nomina_novedades_conn(conn, periodo=periodo)
    synced = _count_nomina_sync_rows_conn(conn, periodo=periodo)
    return _build_nomina_workflow_payload(periodo, resumen, seg, novedades, asistencia, synced)


def get_nomina_workflow(periodo=None):
    conn = get_connection()
    try:
        return _nomina_workflow_conn(conn, periodo=periodo)
    finally:
        conn.close()


def _build_nomina_stats_payload(resumen, seg, novedades, asistencia):
    total_nomina = sum(r.get('total_mes') or 0 for r in resumen)
    total_q1 = sum(r.get('q1_neto') or 0 for r in resumen)
    total_q2 = sum(r.get('q2_neto') or 0 for r in resumen)
    total_deducciones = sum(r.get('total_deduccion') or 0 for r in resumen)
    total_seg_social = sum(r.get('valor') or 0 for r in seg)
    total_novedades_dev = sum(
        r.get('valor') or 0 for r in novedades if (r.get('naturaleza') or '').upper() == 'DEVENGADO'
    )
    total_novedades_ded = sum(
        r.get('valor') or 0 for r in novedades if (r.get('naturaleza') or '').upper() == 'DEDUCCION'
    )
    return {
        'empleados': len(resumen),
        'total_nomina': total_nomina,
        'total_q1': total_q1,
        'total_q2': total_q2,
        'total_deducciones': total_deducciones,
        'total_seg_social': total_seg_social,
        'total_novedades_devengado': total_novedades_dev,
        'total_novedades_deduccion': total_novedades_ded,
        'total_nomina_integrada': total_nomina + total_novedades_dev - total_novedades_ded + total_seg_social,
        'registros_asistencia': len(asistencia),
        'dias_laborados': sum(r.get('dias_laborados') or 0 for r in asistencia),
    }


def _count_nomina_sync_rows_conn(conn, periodo=None):
    query = 'SELECT COUNT(*) FROM egresos WHERE source_module=?'
    params = ['NOMINA']
    if periodo and periodo != 'Todos':
        query += ' AND source_period=?'
        params.append(periodo)
    return conn.execute(query, params).fetchone()[0]


def _count_nomina_sync_rows(periodo=None):
    conn = get_connection()
    try:
        return _count_nomina_sync_rows_conn(conn, periodo=periodo)
    finally:
        conn.close()


def _build_nomina_workflow_payload(periodo, resumen, seg, novedades, asistencia, synced):
    estados = [
        {
            'step': 'asistencia',
            'label': 'Asistencia diaria cargada',
            'completed': len(asistencia) > 0,
            'count': len(asistencia),
            'detail': 'Captura o importación de días trabajados por empleado.',
        },
        {
            'step': 'liquidacion',
            'label': 'Liquidación de desprendibles importada',
            'completed': len(resumen) > 0,
            'count': len(resumen),
            'detail': 'Resumen quincenal y total por empleado.',
        },
        {
            'step': 'seg_social',
            'label': 'Seguridad social cargada',
            'completed': len(seg) > 0,
            'count': len(seg),
            'detail': 'Conceptos patronales y agrupaciones del periodo.',
        },
        {
            'step': 'novedades',
            'label': 'Novedades registradas',
            'completed': len(novedades) > 0,
            'count': len(novedades),
            'detail': 'Bonificaciones, descuentos y ajustes manuales.',
        },
        {
            'step': 'integracion',
            'label': 'Integración contable a egresos',
            'completed': synced > 0,
            'count': synced,
            'detail': 'Egresos automáticos de empleado y seguridad social.',
        },
    ]
    return {
        'periodo': periodo,
        'completed_steps': sum(1 for item in estados if item['completed']),
        'total_steps': len(estados),
        'ready_to_close': all(item['completed'] for item in estados[:3]),
        'steps': estados,
    }


def get_nomina_bundle(periodo=None, search=''):
    conn = get_connection()
    try:
        periodos = _nomina_periodos_conn(conn)
        resumen_all = _nomina_resumen_conn(conn, periodo=periodo)
        seg_social = _nomina_seg_social_conn(conn, periodo=periodo)
        novedades_all = _nomina_novedades_conn(conn, periodo=periodo)
        asistencia_resumen = _nomina_asistencia_resumen_conn(conn, periodo=periodo)
        synced = _count_nomina_sync_rows_conn(conn, periodo=periodo)

        if search:
            search_q = str(search).strip().lower()
            resumen = [
                row for row in resumen_all
                if search_q in f"{row.get('empleado') or ''} {row.get('cedula') or ''}".lower()
            ]
            novedades = [
                row for row in novedades_all
                if search_q in " ".join(
                    str(row.get(field) or '').lower()
                    for field in ('empleado', 'cedula', 'tipo_novedad', 'observaciones')
                )
            ]
            asistencia = _nomina_asistencia_conn(conn, periodo=periodo, empleado=search)
        else:
            resumen = resumen_all
            novedades = novedades_all
            asistencia = _nomina_asistencia_conn(conn, periodo=periodo)
    finally:
        conn.close()

    stats = _build_nomina_stats_payload(resumen_all, seg_social, novedades_all, asistencia_resumen)
    workflow = _build_nomina_workflow_payload(
        periodo or 'Todos',
        resumen_all,
        seg_social,
        novedades_all,
        asistencia_resumen,
        synced,
    )

    return {
        'periodos': periodos,
        'stats': stats,
        'workflow': workflow,
        'resumen': resumen,
        'asistencia': asistencia,
        'asistencia_resumen': asistencia_resumen,
        'seg_social': seg_social,
        'novedades': novedades,
    }


_SPANISH_MONTHS = {
    'ENERO': 1,
    'FEBRERO': 2,
    'MARZO': 3,
    'ABRIL': 4,
    'MAYO': 5,
    'JUNIO': 6,
    'JULIO': 7,
    'AGOSTO': 8,
    'SEPTIEMBRE': 9,
    'OCTUBRE': 10,
    'NOVIEMBRE': 11,
    'DICIEMBRE': 12,
}


def month_year_from_date(fecha):
    parsed = datetime.strptime(_validate_iso_date(fecha), '%Y-%m-%d')
    return parsed.month, parsed.year


def _period_to_dates(periodo):
    parts = (periodo or '').strip().upper().split()
    if len(parts) != 2 or parts[0] not in _SPANISH_MONTHS:
        return None, None
    month = _SPANISH_MONTHS[parts[0]]
    year = int(parts[1])
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 15).isoformat(), date(year, month, last_day).isoformat()


def period_from_month_year(mes, ano):
    if not mes or not ano:
        return None
    reverse = {v: k for k, v in _SPANISH_MONTHS.items()}
    return f'{reverse[int(mes)]} {int(ano)}'


def is_period_closed(mes, ano):
    conn = get_connection()
    row = conn.execute(
        'SELECT cerrado FROM cierres_mensuales WHERE mes=? AND ano=?',
        (int(mes), int(ano)),
    ).fetchone()
    conn.close()
    return bool(row and row[0])


def ensure_period_open(mes, ano):
    if is_period_closed(mes, ano):
        raise AppValidationError(f'El período {int(mes):02d}-{int(ano)} está cerrado y no permite cambios.')


def list_cierres_mensuales():
    conn = get_connection()
    rows = conn.execute('SELECT * FROM cierres_mensuales ORDER BY ano DESC, mes DESC').fetchall()
    conn.close()
    return [dict(r) for r in rows]


@serialized_write
def set_cierre_mensual(mes, ano, cerrado=True, observacion=''):
    conn = get_connection()
    periodo = period_from_month_year(mes, ano)
    existing = conn.execute(
        'SELECT id FROM cierres_mensuales WHERE mes=? AND ano=?',
        (int(mes), int(ano)),
    ).fetchone()
    payload = (
        periodo,
        1 if cerrado else 0,
        datetime.now().isoformat(timespec='seconds'),
        _clean_text(observacion),
        int(mes),
        int(ano),
    )
    if existing:
        conn.execute(
            'UPDATE cierres_mensuales SET periodo=?, cerrado=?, cerrado_at=?, observacion=? WHERE mes=? AND ano=?',
            payload,
        )
        cierre_id = existing[0]
    else:
        cursor = conn.execute(
            'INSERT INTO cierres_mensuales (periodo, cerrado, cerrado_at, observacion, mes, ano) VALUES (?,?,?,?,?,?)',
            payload,
        )
        cierre_id = _extract_inserted_id(cursor)
    conn.commit()
    conn.close()
    log_auditoria('cierre_mensual', 'CERRAR' if cerrado else 'REABRIR', cierre_id, periodo, observacion, {
        'mes': int(mes),
        'ano': int(ano),
        'cerrado': bool(cerrado),
    })
    return {
        'id': cierre_id,
        'mes': int(mes),
        'ano': int(ano),
        'periodo': periodo,
        'cerrado': bool(cerrado),
        'observacion': _clean_text(observacion),
    }


def get_cierre_mensual(mes, ano):
    stats = get_dashboard_stats(mes=mes, ano=ano)
    periodo = period_from_month_year(mes, ano)
    nomina = get_nomina_stats(periodo=periodo)
    novedades = get_nomina_novedades(periodo=periodo)
    egresos = get_egresos(mes=mes, ano=ano)

    nomina_egresos = sum(
        r['valor'] or 0 for r in egresos
        if (r.get('source_module') or '').upper() == 'NOMINA' and r.get('tipo_gasto') == 'EMPLEADO'
    )
    seg_social_egresos = sum(
        r['valor'] or 0 for r in egresos
        if (r.get('source_module') or '').upper() == 'NOMINA' and r.get('tipo_gasto') == 'SEG SOCIAL'
    )
    operativos = (stats['total_egresos'] or 0) - nomina_egresos - seg_social_egresos
    novedades_deduccion = sum(
        r.get('valor') or 0 for r in novedades if (r.get('naturaleza') or '').upper() == 'DEDUCCION'
    )

    return {
        'periodo': periodo,
        'cerrado': is_period_closed(mes, ano),
        'total_ingresos': stats['total_ingresos'],
        'total_egresos': stats['total_egresos'],
        'egresos_operativos': operativos,
        'egresos_nomina': nomina_egresos,
        'egresos_seg_social': seg_social_egresos,
        'novedades_deduccion': novedades_deduccion,
        'resultado_neto': (stats['total_ingresos'] or 0) - (stats['total_egresos'] or 0),
        'nomina': nomina,
    }


@serialized_write
def sync_nomina_to_egresos(periodo=None):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    periodos = [periodo] if periodo else [r[0] for r in conn.execute(
        'SELECT DISTINCT periodo FROM nomina_resumen ORDER BY periodo'
    ).fetchall()]

    prov_rows = conn.execute('SELECT id, razon_social, nit FROM proveedores').fetchall()
    proveedores = {str(r['razon_social']).strip().upper(): dict(r) for r in prov_rows if r['razon_social']}

    created = 0
    try:
        for per in periodos:
            fecha_q1, fecha_q2 = _period_to_dates(per)
            if fecha_q2:
                mes, ano = month_year_from_date(fecha_q2)
                ensure_period_open(mes, ano)
            conn.execute(
                'DELETE FROM egresos WHERE source_module=? AND source_period=?',
                ('NOMINA', per),
            )

            resumen_rows = conn.execute(
                'SELECT * FROM nomina_resumen WHERE periodo=? ORDER BY empleado',
                (per,),
            ).fetchall()
            for row in resumen_rows:
                prov = proveedores.get((row['empleado'] or '').strip().upper())
                quincenas = (
                    ('Q1', fecha_q1, row['q1_neto']),
                    ('Q2', fecha_q2, row['q2_neto']),
                )
                inserted_for_employee = False
                for tag, fecha_egreso, valor in quincenas:
                    if not fecha_egreso or not valor or float(valor) <= 0:
                        continue
                    conn.execute(
                        'INSERT INTO egresos (fecha, no_documento, consecutivo, proveedor_id, '
                        'razon_social, nit, valor, tipo_gasto, factura_electronica, observaciones, source_module, source_ref, source_period) '
                        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (
                            fecha_egreso,
                            row['cedula'] or '',
                            '',
                            prov['id'] if prov else None,
                            row['empleado'],
                            prov['nit'] if prov else '',
                            float(valor),
                            'EMPLEADO',
                            'NO',
                            f'Nomina {per} {tag}',
                            'NOMINA',
                            f'EMPLEADO:{row["cedula"]}:{tag}',
                            per,
                        ),
                    )
                    created += 1
                    inserted_for_employee = True

                if not inserted_for_employee and row['total_mes'] and fecha_q2:
                    conn.execute(
                        'INSERT INTO egresos (fecha, no_documento, consecutivo, proveedor_id, '
                        'razon_social, nit, valor, tipo_gasto, factura_electronica, observaciones, source_module, source_ref, source_period) '
                        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (
                            fecha_q2,
                            row['cedula'] or '',
                            '',
                            prov['id'] if prov else None,
                            row['empleado'],
                            prov['nit'] if prov else '',
                            float(row['total_mes']),
                            'EMPLEADO',
                            'NO',
                            f'Nomina {per}',
                            'NOMINA',
                            f'EMPLEADO:{row["cedula"]}:TOTAL',
                            per,
                        ),
                    )
                    created += 1

            seg_rows = conn.execute(
                'SELECT * FROM nomina_seg_social WHERE periodo=? ORDER BY grupo, concepto',
                (per,),
            ).fetchall()
            for row in seg_rows:
                concepto = (row['concepto'] or '').strip().upper()
                if concepto.startswith('SALARIO AÑO') or not row['valor'] or float(row['valor']) <= 0:
                    continue
                razon_social = f'{concepto} {row["grupo"] or ""}'.strip()
                conn.execute(
                    'INSERT INTO egresos (fecha, no_documento, consecutivo, proveedor_id, '
                    'razon_social, nit, valor, tipo_gasto, factura_electronica, observaciones, source_module, source_ref, source_period) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (
                        fecha_q2 or '',
                        '',
                        '',
                        None,
                        razon_social,
                        '',
                        float(row['valor']),
                        'SEG SOCIAL',
                        'NO',
                        f'Seguridad social nomina {per}',
                        'NOMINA',
                        f'SEG:{concepto}:{row["grupo"] or ""}',
                        per,
                    ),
                )
                created += 1

            nov_rows = conn.execute(
                'SELECT * FROM nomina_novedades WHERE periodo=? ORDER BY fecha, empleado',
                (per,),
            ).fetchall()
            for row in nov_rows:
                if (row['naturaleza'] or '').upper() != 'DEVENGADO':
                    continue
                fecha_nov = row['fecha'] or fecha_q2 or ''
                conn.execute(
                    'INSERT INTO egresos (fecha, no_documento, consecutivo, proveedor_id, '
                    'razon_social, nit, valor, tipo_gasto, factura_electronica, observaciones, source_module, source_ref, source_period) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (
                        fecha_nov,
                        row['cedula'] or '',
                        '',
                        None,
                        row['empleado'],
                        '',
                        float(row['valor']),
                        'EMPLEADO',
                        'NO',
                        f'Novedad {row["tipo_novedad"]} {per}',
                        'NOMINA',
                        f'NOVEDAD:{row["id"]}',
                        per,
                    ),
                )
                created += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    checkpoint_database('TRUNCATE')
    for per in periodos:
        log_auditoria('nomina_sync', 'SYNC', None, per, f'Egresos generados: {created}', {
            'periodo': per,
            'egresos_generados': created,
        })
    return created


# ── Cuadre de Caja ────────────────────────────────────────────────────────────

def _get_caja_movimientos_from_conn(conn, fecha):
    row_ing = conn.execute(
        "SELECT COALESCE(SUM(caja), 0) FROM ingresos WHERE fecha=?",
        (fecha,)
    ).fetchone()
    ingresos_operativos = float(row_ing[0]) if row_ing else 0.0

    row_egr = conn.execute(
        "SELECT COALESCE(SUM(valor), 0) FROM egresos WHERE fecha=? AND canal_pago='Caja'",
        (fecha,)
    ).fetchone()
    egresos_operativos = float(row_egr[0]) if row_egr else 0.0

    ajustes_rows = conn.execute(
        '''
        SELECT tipo, COALESCE(SUM(valor), 0) AS total
        FROM caja_ajustes
        WHERE fecha=?
        GROUP BY tipo
        ''',
        (fecha,),
    ).fetchall()
    ajustes = {(row['tipo'] or '').upper(): float(row['total'] or 0) for row in ajustes_rows}
    ajustes_entrada = ajustes.get('ENTRADA', 0.0)
    ajustes_salida = ajustes.get('SALIDA', 0.0)

    return {
        'ingresos_operativos': ingresos_operativos,
        'ajustes_entrada': ajustes_entrada,
        'ingresos_caja': round(ingresos_operativos + ajustes_entrada, 2),
        'egresos_operativos': egresos_operativos,
        'ajustes_salida': ajustes_salida,
        'egresos_caja': round(egresos_operativos + ajustes_salida, 2),
    }


def _empty_caja_movimientos():
    return {
        'ingresos_operativos': 0.0,
        'ajustes_entrada': 0.0,
        'ingresos_caja': 0.0,
        'egresos_operativos': 0.0,
        'ajustes_salida': 0.0,
        'egresos_caja': 0.0,
    }


def _get_caja_daily_movements_map(conn, end_date=None):
    filters = []
    params = []
    if end_date:
        filters.append('fecha<=?')
        params.append(end_date)
    filter_sql = f" AND {' AND '.join(filters)}" if filters else ""

    movement_map = {}

    ingresos_rows = conn.execute(
        f'''
        SELECT fecha, COALESCE(SUM(caja), 0) AS total
        FROM ingresos
        WHERE COALESCE(caja, 0) > 0{filter_sql}
        GROUP BY fecha
        ''',
        params,
    ).fetchall()
    for row in ingresos_rows:
        item = movement_map.setdefault(row['fecha'], _empty_caja_movimientos())
        item['ingresos_operativos'] = float(row['total'] or 0)

    egresos_rows = conn.execute(
        f'''
        SELECT fecha, COALESCE(SUM(valor), 0) AS total
        FROM egresos
        WHERE canal_pago='Caja' AND COALESCE(valor, 0) > 0{filter_sql}
        GROUP BY fecha
        ''',
        params,
    ).fetchall()
    for row in egresos_rows:
        item = movement_map.setdefault(row['fecha'], _empty_caja_movimientos())
        item['egresos_operativos'] = float(row['total'] or 0)

    ajustes_rows = conn.execute(
        f'''
        SELECT fecha, UPPER(COALESCE(tipo, '')) AS tipo, COALESCE(SUM(valor), 0) AS total
        FROM caja_ajustes
        WHERE COALESCE(valor, 0) > 0{filter_sql}
        GROUP BY fecha, UPPER(COALESCE(tipo, ''))
        ''',
        params,
    ).fetchall()
    for row in ajustes_rows:
        item = movement_map.setdefault(row['fecha'], _empty_caja_movimientos())
        if row['tipo'] == 'ENTRADA':
            item['ajustes_entrada'] = float(row['total'] or 0)
        elif row['tipo'] == 'SALIDA':
            item['ajustes_salida'] = float(row['total'] or 0)

    for item in movement_map.values():
        item['ingresos_caja'] = round(item['ingresos_operativos'] + item['ajustes_entrada'], 2)
        item['egresos_caja'] = round(item['egresos_operativos'] + item['ajustes_salida'], 2)

    return movement_map


def _build_caja_snapshot(row, movs=None, saldo_inicial=None, *, source='manual_current_day'):
    data = dict(row) if row else {}
    movs = movs or _empty_caja_movimientos()
    base = float(data.get('saldo_inicial') if saldo_inicial is None else (saldo_inicial or 0))
    saldo_contado = data.get('saldo_real')
    if saldo_contado is not None:
        saldo_contado = float(saldo_contado)
    data['id'] = data.get('id')
    data['fecha'] = data.get('fecha')
    data['observaciones'] = data.get('observaciones') or ''
    data['created_at'] = data.get('created_at')
    data['saldo_inicial'] = base
    data['ingresos_caja'] = float(movs['ingresos_caja'] or 0)
    data['egresos_caja'] = float(movs['egresos_caja'] or 0)
    data['saldo_esperado'] = round(base + data['ingresos_caja'] - data['egresos_caja'], 2)
    data['saldo_final'] = saldo_contado if saldo_contado is not None else data['saldo_esperado']
    data['saldo_real'] = saldo_contado
    data['diferencia'] = round(saldo_contado - data['saldo_esperado'], 2) if saldo_contado is not None else None
    data['tiene_arqueo'] = saldo_contado is not None
    data['cerrado'] = 0
    data['has_current_base'] = source == 'manual_current_day'
    data['source'] = source
    return data


def _get_caja_snapshots_until(conn, end_date=None):
    params = []
    query = 'SELECT * FROM cuadre_caja'
    if end_date:
        query += ' WHERE fecha<=?'
        params.append(end_date)
    query += ' ORDER BY fecha ASC'
    explicit_rows = [dict(row) for row in conn.execute(query, params).fetchall()]
    if not explicit_rows:
        return {}

    explicit_map = {row['fecha']: row for row in explicit_rows}
    movements_map = _get_caja_daily_movements_map(conn, end_date=end_date)
    start_date = explicit_rows[0]['fecha']
    candidate_dates = sorted(
        fecha
        for fecha in set(explicit_map) | set(movements_map)
        if fecha >= start_date and (not end_date or fecha <= end_date)
    )

    snapshots = {}
    saldo_arrastrado = None
    for fecha in candidate_dates:
        explicit = explicit_map.get(fecha)
        movs = movements_map.get(fecha, _empty_caja_movimientos())
        if explicit is not None:
            snapshot = _build_caja_snapshot(explicit, movs, source='manual_current_day')
        else:
            if saldo_arrastrado is None:
                continue
            snapshot = _build_caja_snapshot(
                {
                    'fecha': fecha,
                    'observaciones': '',
                    'saldo_real': None,
                    'created_at': None,
                },
                movs,
                saldo_inicial=saldo_arrastrado,
                source='carry_forward',
            )
        snapshots[fecha] = snapshot
        saldo_arrastrado = snapshot['saldo_final']
    return snapshots


def _get_previous_caja_snapshot(conn, fecha):
    target = date.fromisoformat(_validate_iso_date(fecha))
    previous_day = (target - timedelta(days=1)).isoformat()
    snapshots = _get_caja_snapshots_until(conn, end_date=previous_day)
    if not snapshots:
        return None
    last_fecha = max(snapshots)
    return snapshots[last_fecha]


def get_caja_snapshot_by_fecha(fecha):
    conn = get_connection()
    try:
        snapshots = _get_caja_snapshots_until(conn, end_date=_validate_iso_date(fecha))
        return snapshots.get(fecha)
    finally:
        conn.close()


def calcular_movimientos_caja(fecha):
    """Calcula ingresos y egresos en caja para una fecha dada."""
    conn = get_connection()
    try:
        return _get_caja_movimientos_from_conn(conn, fecha)
    finally:
        conn.close()


def get_caja_movimientos_detalle(fecha):
    conn = get_connection()
    try:
        resumen = _get_caja_movimientos_from_conn(conn, fecha)
        entradas_rows = conn.execute(
            '''
            SELECT id, fecha, caja
            FROM ingresos
            WHERE fecha=? AND COALESCE(caja, 0) > 0
            ORDER BY id DESC
            ''',
            (fecha,),
        ).fetchall()
        salidas_rows = conn.execute(
            '''
            SELECT id, fecha, razon_social, tipo_gasto, observaciones, valor
            FROM egresos
            WHERE fecha=? AND canal_pago='Caja' AND COALESCE(valor, 0) > 0
            ORDER BY id DESC
            ''',
            (fecha,),
        ).fetchall()
        ajustes_rows = conn.execute(
            '''
            SELECT id, fecha, tipo, valor, motivo, observaciones, created_at
            FROM caja_ajustes
            WHERE fecha=? AND COALESCE(valor, 0) > 0
            ORDER BY id DESC
            ''',
            (fecha,),
        ).fetchall()
    finally:
        conn.close()

    entradas = [
        {
            'id': f'ingreso-{row["id"]}',
            'tipo': 'entrada',
            'label': 'Ingreso en efectivo',
            'detalle': 'Movimiento registrado en ingresos.',
            'valor': float(row['caja'] or 0),
        }
        for row in entradas_rows
    ]
    salidas = [
        {
            'id': f'egreso-{row["id"]}',
            'tipo': 'salida',
            'label': (row['razon_social'] or row['tipo_gasto'] or 'Salida en efectivo').strip(),
            'detalle': (row['observaciones'] or row['tipo_gasto'] or 'Movimiento registrado en egresos.').strip(),
            'valor': float(row['valor'] or 0),
        }
        for row in salidas_rows
    ]
    for row in ajustes_rows:
        item = {
            'id': f'ajuste-{row["id"]}',
            'tipo': 'entrada' if (row['tipo'] or '').upper() == 'ENTRADA' else 'salida',
            'clase': 'ajuste_manual',
            'label': 'Ajuste manual de caja',
            'detalle': (row['motivo'] or row['observaciones'] or 'Ajuste manual registrado.').strip(),
            'valor': float(row['valor'] or 0),
            'created_at': row['created_at'],
        }
        if item['tipo'] == 'entrada':
            entradas.append(item)
        else:
            salidas.append(item)
    return {
        'entradas': entradas,
        'salidas': salidas,
        'resumen': resumen,
    }


def get_caja_apertura_context(fecha):
    conn = get_connection()
    try:
        current_row = conn.execute(
            'SELECT * FROM cuadre_caja WHERE fecha=?',
            (fecha,),
        ).fetchone()
        previous = _get_previous_caja_snapshot(conn, fecha)
    finally:
        conn.close()

    current = _hydrate_cuadre_caja_row(current_row)
    has_previous = previous is not None
    is_initial_opening = not has_previous
    if current:
        message = (
            'Esta es la apertura inicial registrada de la caja.'
            if is_initial_opening
            else 'La base de hoy fue fijada manualmente y desde ahí la caja sigue corriendo.'
        )
        source = 'manual_current_day'
    elif previous:
        message = 'La caja sigue abierta. La base de hoy se arrastra automáticamente desde el último saldo final registrado.'
        source = 'carry_forward'
    else:
        message = 'No existe historial previo. Define el saldo real con el que inicia la caja por primera vez.'
        source = 'initial_pending'

    return {
        'is_initial_opening': is_initial_opening,
        'has_previous_record': has_previous,
        'has_current_base': current is not None,
        'source': source,
        'message': message,
        'previous_fecha': previous['fecha'] if previous else None,
        'previous_saldo_final': previous['saldo_final'] if previous else 0.0,
    }


def _hydrate_cuadre_caja_row(row):
    if not row:
        return None
    data = dict(row)
    movs = calcular_movimientos_caja(data['fecha'])
    return _build_caja_snapshot(data, movs, source='manual_current_day')


def get_saldo_inicial_sugerido(fecha):
    """Arrastra el último saldo final conocido, con o sin conteo físico."""
    conn = get_connection()
    try:
        previous = _get_previous_caja_snapshot(conn, fecha)
        if not previous:
            return 0.0
        return float(previous['saldo_final'] or 0)
    finally:
        conn.close()


def get_caja_ajustes(mes=None, ano=None):
    conn = get_connection()
    try:
        query = 'SELECT * FROM caja_ajustes WHERE 1=1'
        params = []
        if mes:
            query += " AND strftime('%m', fecha)=?"
            params.append(f'{int(mes):02d}')
        if ano:
            query += " AND strftime('%Y', fecha)=?"
            params.append(str(ano))
        query += ' ORDER BY fecha DESC, id DESC'
        rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_cuadres_caja(mes=None, ano=None):
    conn = get_connection()
    try:
        end_date = None
        if mes and ano:
            last_day = calendar.monthrange(int(ano), int(mes))[1]
            end_date = date(int(ano), int(mes), last_day).isoformat()
        snapshots = list(_get_caja_snapshots_until(conn, end_date=end_date).values())
        if mes:
            snapshots = [row for row in snapshots if month_year_from_date(row['fecha'])[0] == int(mes)]
        if ano:
            snapshots = [row for row in snapshots if month_year_from_date(row['fecha'])[1] == int(ano)]
        snapshots.sort(key=lambda row: row['fecha'], reverse=True)
        return snapshots
    finally:
        conn.close()


def get_cuadre_caja_by_fecha(fecha):
    conn = get_connection()
    try:
        row = conn.execute('SELECT * FROM cuadre_caja WHERE fecha=?', (fecha,)).fetchone()
        return _hydrate_cuadre_caja_row(row)
    finally:
        conn.close()


@serialized_write
def save_cuadre_caja(data, cuadre_id=None):
    fecha = _validate_iso_date(data.get('fecha'))
    mes, ano = month_year_from_date(fecha)
    ensure_period_open(mes, ano)
    try:
        saldo_inicial = float(data.get('saldo_inicial') or 0)
        saldo_real = data.get('saldo_real')
        saldo_real = float(saldo_real) if saldo_real is not None else None
    except (TypeError, ValueError) as exc:
        raise AppValidationError('Los valores deben ser numéricos.') from exc

    if saldo_inicial < 0:
        raise AppValidationError('El saldo inicial no puede ser negativo.')

    movs = calcular_movimientos_caja(fecha)
    ingresos_caja = movs['ingresos_caja']
    egresos_caja = movs['egresos_caja']
    saldo_esperado = round(saldo_inicial + ingresos_caja - egresos_caja, 2)
    diferencia = round(saldo_real - saldo_esperado, 2) if saldo_real is not None else None

    observaciones = (data.get('observaciones') or '').strip()
    cerrado = 0
    now = datetime.now().isoformat(timespec='seconds')

    conn = get_connection()
    try:
        existing_same_date = None
        if not cuadre_id:
            existing_same_date = conn.execute(
                'SELECT id FROM cuadre_caja WHERE fecha=?',
                (fecha,),
            ).fetchone()
            cuadre_id = existing_same_date['id'] if existing_same_date else None

        if cuadre_id:
            conn.execute(
                '''UPDATE cuadre_caja SET fecha=?, saldo_inicial=?, ingresos_caja=?,
                   egresos_caja=?, saldo_esperado=?, saldo_real=?, diferencia=?,
                   observaciones=?, cerrado=? WHERE id=?''',
                (fecha, saldo_inicial, ingresos_caja, egresos_caja, saldo_esperado,
                 saldo_real, diferencia, observaciones, cerrado, cuadre_id)
            )
            entity_id = cuadre_id
            action = 'UPDATE'
        else:
            cursor = conn.execute(
                '''INSERT INTO cuadre_caja (fecha, saldo_inicial, ingresos_caja, egresos_caja,
                   saldo_esperado, saldo_real, diferencia, observaciones, cerrado, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)''',
                (fecha, saldo_inicial, ingresos_caja, egresos_caja, saldo_esperado,
                 saldo_real, diferencia, observaciones, cerrado, now)
            )
            entity_id = _extract_inserted_id(cursor)
            action = 'CREATE'
        conn.commit()
    finally:
        conn.close()

    log_auditoria('cuadre_caja', action, entity_id, period_from_month_year(mes, ano), fecha, {
        'saldo_inicial': saldo_inicial,
        'ingresos_caja': ingresos_caja,
        'egresos_caja': egresos_caja,
        'saldo_esperado': saldo_esperado,
        'saldo_real': saldo_real,
        'diferencia': diferencia,
    })
    return entity_id


@serialized_write
def create_caja_ajuste(data):
    fecha = _validate_iso_date(data.get('fecha'))
    mes, ano = month_year_from_date(fecha)
    ensure_period_open(mes, ano)
    tipo = _clean_text(data.get('tipo')).upper()
    motivo = _clean_text(data.get('motivo'))
    observaciones = _clean_text(data.get('observaciones'))
    try:
        valor = float(data.get('valor') or 0)
    except (TypeError, ValueError) as exc:
        raise AppValidationError('El valor del ajuste debe ser numérico.') from exc

    if tipo not in {'ENTRADA', 'SALIDA'}:
        raise AppValidationError('El ajuste manual debe ser de tipo ENTRADA o SALIDA.')
    if valor <= 0:
        raise AppValidationError('El valor del ajuste debe ser mayor a cero.')
    if not motivo:
        raise AppValidationError('Debes registrar el motivo del ajuste manual.')

    now = datetime.now().isoformat(timespec='seconds')
    conn = get_connection()
    try:
        cursor = conn.execute(
            '''
            INSERT INTO caja_ajustes (fecha, tipo, valor, motivo, observaciones, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (fecha, tipo, valor, motivo, observaciones, now),
        )
        ajuste_id = _extract_inserted_id(cursor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log_auditoria('caja_ajuste', 'CREATE', ajuste_id, period_from_month_year(mes, ano), motivo, {
        'fecha': fecha,
        'tipo': tipo,
        'valor': valor,
        'observaciones': observaciones,
        'created_at': now,
    })
    return ajuste_id


@serialized_write
def delete_cuadre_caja(cuadre_id):
    conn = get_connection()
    try:
        row = conn.execute('SELECT * FROM cuadre_caja WHERE id=?', (cuadre_id,)).fetchone()
        if not row:
            raise AppValidationError('Cuadre no encontrado.')
        conn.execute('DELETE FROM cuadre_caja WHERE id=?', (cuadre_id,))
        conn.commit()
    finally:
        conn.close()


# ── Inventario Diario ──────────────────────────────────────────────────────────

def get_insumos():
    conn = get_connection()
    rows = conn.execute('SELECT * FROM insumos WHERE activo=1 ORDER BY categoria, nombre').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_inventario_diario(fecha):
    conn = get_connection()
    rows = conn.execute(
        '''SELECT inv.*,
                  COALESCE(ins.nombre, inv.nombre_extra) AS nombre,
                  COALESCE(ins.categoria, 'Extra') AS categoria
           FROM inventario_diario inv
           LEFT JOIN insumos ins ON inv.insumo_id = ins.id
           WHERE inv.fecha = ?
           ORDER BY CASE WHEN ins.categoria IS NULL THEN 1 ELSE 0 END,
                    ins.categoria, COALESCE(ins.nombre, inv.nombre_extra)''',
        (fecha,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@serialized_write
def save_inventario_diario(fecha, items, usuario_id=None):
    conn = get_connection()
    try:
        conn.execute('DELETE FROM inventario_diario WHERE fecha=?', (fecha,))
        for item in items:
            insumo_id = item.get('insumo_id')
            nombre_extra = (item.get('nombre_extra') or '').strip() or None
            estado = item.get('estado')
            cantidad = item.get('cantidad')
            notas = item.get('notas')
            if not (insumo_id or nombre_extra) or not estado:
                raise AppValidationError('Cada item debe tener insumo_id o nombre_extra, y estado.')
            conn.execute(
                '''INSERT INTO inventario_diario (fecha, insumo_id, nombre_extra, estado, cantidad, notas, usuario_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (fecha, insumo_id, nombre_extra, estado, cantidad, notas, usuario_id, datetime.now().isoformat())
            )
        conn.commit()
        log_auditoria('inventario_diario', 'SAVE', 0, fecha, f'Inventario del {fecha}', {'items': len(items)})
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
