import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from app_paths import get_app_data_dir
from database import (
    AppValidationError,
    DB_PATH,
    checkpoint_database,
    database_write_lock,
    get_database_health,
)


BACKUP_DIR = get_app_data_dir() / 'backups'
MAX_BACKUPS = 30
AUTO_BACKUP_INTERVAL_HOURS = 12
SAFETY_BACKUP_INTERVAL_MINUTES = 30


def ensure_backup_dir():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return BACKUP_DIR


def _timestamp():
    return datetime.now().strftime('%Y%m%d_%H%M%S')


def _backup_name(reason):
    slug = (reason or 'manual').strip().lower().replace(' ', '_')
    return f'contabilidad_backup_{_timestamp()}_{slug}.db'


def _reason_slug(path):
    parts = Path(path).stem.split('_')
    if len(parts) <= 4:
        return 'manual'
    return '_'.join(parts[4:]) or 'manual'


def _human_reason(path):
    slug = _reason_slug(path)
    if slug == 'auto':
        return 'AUTO'
    if slug == 'manual':
        return 'MANUAL'
    return slug.replace('_', ' ').upper()


def create_backup(reason='manual'):
    ensure_backup_dir()
    source_path = Path(DB_PATH)
    if not source_path.exists():
        raise AppValidationError('No existe una base de datos para respaldar.')

    with database_write_lock():
        checkpoint_database('PASSIVE')
        dest_path = BACKUP_DIR / _backup_name(reason)
        src = sqlite3.connect(DB_PATH, timeout=30)
        dst = sqlite3.connect(dest_path, timeout=30)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()

    validation = validate_backup(dest_path)
    if not validation['ok']:
        dest_path.unlink(missing_ok=True)
        raise AppValidationError(f'El backup generado no pasó la validación: {validation["detail"]}')

    prune_old_backups(MAX_BACKUPS)
    return get_backup_info(dest_path)


def validate_backup(path):
    backup_path = Path(path)
    if not backup_path.exists():
        return {'ok': False, 'detail': 'El backup no existe.'}
    try:
        conn = sqlite3.connect(backup_path, timeout=10)
        try:
            row = conn.execute('PRAGMA integrity_check').fetchone()
            integrity = row[0] if row else 'unknown'
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        return {'ok': False, 'detail': str(exc)}
    return {'ok': integrity == 'ok', 'detail': integrity}


def list_backups():
    ensure_backup_dir()
    rows = [get_backup_info(path) for path in sorted(BACKUP_DIR.glob('*.db'), reverse=True)]
    return rows


def get_backup_info(path):
    p = Path(path)
    stat = p.stat()
    created_at = datetime.fromtimestamp(stat.st_mtime)
    return {
        'name': p.name,
        'path': str(p),
        'size_bytes': stat.st_size,
        'created_at': created_at,
        'created_label': created_at.strftime('%Y-%m-%d %H:%M'),
        'reason': _human_reason(p),
        'reason_slug': _reason_slug(p),
    }


def resolve_backup_name(name):
    safe_name = Path((name or '').strip()).name
    if not safe_name or safe_name != (name or '').strip():
        raise AppValidationError('El backup solicitado no es válido.')
    candidate = (BACKUP_DIR / safe_name).resolve()
    backup_root = BACKUP_DIR.resolve()
    if candidate != backup_root and backup_root not in candidate.parents:
        raise AppValidationError('El backup solicitado está fuera del directorio permitido.')
    if candidate.suffix.lower() != '.db' or not candidate.exists():
        raise AppValidationError('El backup seleccionado no existe.')
    return candidate


def prune_old_backups(max_backups=MAX_BACKUPS):
    backups = sorted(BACKUP_DIR.glob('*.db'), reverse=True)
    for old in backups[max_backups:]:
        try:
            old.unlink()
        except OSError:
            continue


def find_latest_valid_backup():
    for row in list_backups():
        validation = validate_backup(row['path'])
        if validation['ok']:
            return row
    return None


def create_backup_if_due(reason='safety', max_age_minutes=SAFETY_BACKUP_INTERVAL_MINUTES, force=False):
    ensure_backup_dir()
    reason_slug = (reason or 'safety').strip().lower().replace(' ', '_')
    if not force:
        cutoff = datetime.now() - timedelta(minutes=max(1, int(max_age_minutes)))
        for backup in list_backups():
            if backup.get('reason_slug') == reason_slug and backup['created_at'] >= cutoff:
                return backup
    return create_backup(reason)


def restore_backup(path, create_pre_restore_backup=True):
    backup_path = Path(path).expanduser().resolve()
    if not backup_path.exists():
        raise AppValidationError('El backup seleccionado no existe.')

    validation = validate_backup(backup_path)
    if not validation['ok']:
        raise AppValidationError(f'El backup no es válido: {validation["detail"]}')

    source_path = Path(DB_PATH)
    ensure_backup_dir()
    with database_write_lock():
        if create_pre_restore_backup and source_path.exists():
            try:
                create_backup('pre_restore')
            except Exception:
                pass

        checkpoint_database('TRUNCATE')
        source_conn = sqlite3.connect(backup_path, timeout=30)
        dest_conn = sqlite3.connect(DB_PATH, timeout=30)
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
            source_conn.close()
        checkpoint_database('TRUNCATE')

    health = get_database_health()
    if not health['ok']:
        raise AppValidationError('La base restaurada no superó la validación de integridad.')
    return get_backup_info(backup_path)


def restore_backup_by_name(name, create_pre_restore_backup=True):
    backup_path = resolve_backup_name(name)
    return restore_backup(str(backup_path), create_pre_restore_backup=create_pre_restore_backup)


def auto_recover_database():
    health = get_database_health()
    if health['ok']:
        return {'restored': False, 'reason': 'healthy', 'backup': None, 'health': health}

    latest = find_latest_valid_backup()
    if not latest:
        return {'restored': False, 'reason': 'no_valid_backup', 'backup': None, 'health': health}

    restore_backup(latest['path'], create_pre_restore_backup=False)
    return {
        'restored': True,
        'reason': 'restored_from_latest_valid_backup',
        'backup': latest,
        'health': get_database_health(),
    }


def create_startup_backup_if_needed():
    return create_backup_if_due('auto', max_age_minutes=AUTO_BACKUP_INTERVAL_HOURS * 60)
