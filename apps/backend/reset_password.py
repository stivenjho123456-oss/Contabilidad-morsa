#!/usr/bin/env python3
"""Restablece la contraseña de un usuario desde la línea de comandos.

Es la vía de recuperación cuando nadie puede entrar a la aplicación. No pide la
contraseña anterior: quien puede ejecutar esto ya tiene la cadena de conexión de
la base de datos, o sea control total del despliegue.

Uso contra la base de producción:

    DATABASE_URL="postgresql://..." ./.venv/bin/python apps/backend/reset_password.py admin

Pide la contraseña nueva por teclado (no queda en el historial del shell). Para
automatizarlo se puede pasar con --password, pero entonces sí queda registrada.

Listar los usuarios existentes:

    DATABASE_URL="postgresql://..." ./.venv/bin/python apps/backend/reset_password.py --listar

IMPORTANTE: MORSA_PASSWORD_PEPPER debe valer lo mismo que en el servidor. Si no,
el hash queda calculado con otro pepper y el login seguirá fallando.
"""
from __future__ import annotations

import argparse
import getpass
import logging
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
CORE_APP_DIR = ROOT_DIR / "ContabilidadMorsa"
APP_DIR = Path(__file__).resolve().parent / "app"
for _path in (str(CORE_APP_DIR), str(APP_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")

from db_adapter import USE_POSTGRES  # noqa: E402

if USE_POSTGRES:
    import db_adapter as _db_adapter  # noqa: E402
    import database as _db_module  # noqa: E402

    _db_module.get_connection = _db_adapter.get_pg_connection

from database import AppValidationError, get_connection  # noqa: E402
from auth_service import reset_user_password  # noqa: E402


def listar_usuarios():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT username, full_name, role, active FROM usuarios ORDER BY username"
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        print("No hay usuarios registrados.")
        return

    print(f"{'USUARIO':<24} {'NOMBRE':<28} {'ROL':<10} ESTADO")
    for row in rows:
        data = dict(row)
        estado = "activo" if data.get("active") else "inactivo"
        print(f"{data['username']:<24} {data['full_name']:<28} {data['role']:<10} {estado}")


def pedir_password():
    primera = getpass.getpass("Contraseña nueva: ")
    segunda = getpass.getpass("Repite la contraseña: ")
    if primera != segunda:
        print("Las contraseñas no coinciden.", file=sys.stderr)
        raise SystemExit(1)
    return primera


def main():
    parser = argparse.ArgumentParser(
        description="Restablece la contraseña de un usuario de Contabilidad Morsa."
    )
    parser.add_argument("usuario", nargs="?", help="Nombre de usuario a restablecer.")
    parser.add_argument(
        "--password",
        help="Contraseña nueva. Si se omite se pide por teclado (recomendado).",
    )
    parser.add_argument(
        "--listar",
        action="store_true",
        help="Muestra los usuarios existentes y termina.",
    )
    args = parser.parse_args()

    destino = "PostgreSQL (DATABASE_URL)" if USE_POSTGRES else "SQLite local"
    print(f"Base de datos: {destino}")

    if not os.getenv("MORSA_PASSWORD_PEPPER"):
        print(
            "AVISO: MORSA_PASSWORD_PEPPER no está definida. Si el servidor sí la usa, "
            "la contraseña que generes aquí no va a servir para iniciar sesión.",
            file=sys.stderr,
        )

    if args.listar:
        listar_usuarios()
        return

    if not args.usuario:
        parser.error("Falta el nombre de usuario (o usa --listar).")

    nueva = args.password or pedir_password()

    try:
        resultado = reset_user_password(args.usuario, nueva, origen="script CLI")
    except AppValidationError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)

    print(
        f"Listo. Contraseña de '{resultado['username']}' restablecida. "
        f"Sesiones cerradas: {resultado['sesiones_cerradas']}."
    )


if __name__ == "__main__":
    main()
