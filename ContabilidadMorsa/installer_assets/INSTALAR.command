#!/bin/zsh
set -euo pipefail

APP_NAME="Contabilidad Morsa"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPPORT_DIR="$HOME/Library/Application Support/$APP_NAME"
BACKUPS_DIR="$SUPPORT_DIR/backups"

TARGET_ROOT="/Applications"
if [ ! -w "$TARGET_ROOT" ]; then
    TARGET_ROOT="$HOME/Applications"
    mkdir -p "$TARGET_ROOT"
fi

TARGET_APP="$TARGET_ROOT/$APP_NAME.app"
SOURCE_APP="$SCRIPT_DIR/$APP_NAME.app"
DB_SRC="$SCRIPT_DIR/datos/contabilidad.db"
BACKUPS_SRC="$SCRIPT_DIR/datos/backups"
DB_DEST="$SUPPORT_DIR/contabilidad.db"

echo "================================================"
echo "  Instalador - $APP_NAME"
echo "================================================"
echo ""

if [ ! -d "$SOURCE_APP" ]; then
    echo "ERROR: No se encontro la app dentro del paquete."
    echo "Ruta esperada: $SOURCE_APP"
    echo ""
    echo "Presiona Enter para cerrar..."
    read
    exit 1
fi

echo "Instalando la app en:"
echo "  $TARGET_ROOT"
if [ -d "$TARGET_APP" ]; then
    rm -rf "$TARGET_APP"
fi
cp -R "$SOURCE_APP" "$TARGET_ROOT/"
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
echo "  OK"
echo ""

mkdir -p "$SUPPORT_DIR"

if [ -f "$DB_SRC" ]; then
    if [ -f "$DB_DEST" ]; then
        echo "Base de datos existente detectada. No se sobreescribio:"
        echo "  $DB_DEST"
    else
        cp "$DB_SRC" "$DB_DEST"
        echo "Base de datos inicial copiada en:"
        echo "  $DB_DEST"
    fi
else
    echo "El paquete no trae base inicial. La app creara una nueva al primer uso."
fi
echo ""

if [ -d "$BACKUPS_SRC" ]; then
    mkdir -p "$BACKUPS_DIR"
    copied=0
    skipped=0
    for backup_file in "$BACKUPS_SRC"/*.db(.N); do
        backup_name="$(basename "$backup_file")"
        if [ -f "$BACKUPS_DIR/$backup_name" ]; then
            skipped=$((skipped + 1))
            continue
        fi
        cp "$backup_file" "$BACKUPS_DIR/$backup_name"
        copied=$((copied + 1))
    done
    echo "Backups copiados: $copied"
    echo "Backups ya existentes: $skipped"
    echo "Carpeta de backups:"
    echo "  $BACKUPS_DIR"
    echo ""
fi

echo "Instalacion completa."
echo "Abre '$APP_NAME' desde:"
echo "  $TARGET_APP"
echo ""
echo "Si macOS la bloquea por seguridad:"
echo "  1. Haz clic derecho sobre la app"
echo "  2. Elige 'Abrir'"
echo "  3. Confirma la apertura"
echo ""
echo "Presiona Enter para cerrar..."
read
