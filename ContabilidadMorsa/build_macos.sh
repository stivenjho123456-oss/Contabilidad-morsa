#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
APP_DIR="$ROOT_DIR/ContabilidadMorsa"
FRONTEND_DIR="$ROOT_DIR/apps/frontend"
DIST_DIR="$ROOT_DIR/dist"
INSTALLER_DIR="$ROOT_DIR/dist_installer"
PACKAGE_DIR="$INSTALLER_DIR/ContabilidadMorsa_Mac"
APP_NAME="Contabilidad Morsa"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
SEED_DB_PATH="${MORSA_SEED_DB_PATH:-$HOME/Library/Application Support/$APP_NAME/contabilidad.db}"
SEED_BACKUPS_DIR="${MORSA_SEED_BACKUPS_DIR:-$HOME/Library/Application Support/$APP_NAME/backups}"
ZIP_PATH="$INSTALLER_DIR/ContabilidadMorsa_Mac.zip"
DMG_PATH="$INSTALLER_DIR/ContabilidadMorsa-macOS.dmg"

cd "$ROOT_DIR"

echo "Compilando frontend..."
cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
  npm ci
fi
npm run build
if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
  echo "ERROR: El frontend no genero dist/index.html."
  exit 1
fi

cd "$ROOT_DIR"
echo "Validando backend y dependencias..."
./.venv/bin/python -m pip install -r "$ROOT_DIR/apps/backend/requirements.txt"
./.venv/bin/python -m pip install -r "$APP_DIR/requirements-build.txt"
./.venv/bin/python "$ROOT_DIR/apps/backend/smoke_test.py"

rm -rf "$ROOT_DIR/build" "$DIST_DIR" "$INSTALLER_DIR"

echo "Empaquetando app macOS..."
./.venv/bin/pyinstaller "$APP_DIR/ContabilidadMorsaWeb.spec" --clean --noconfirm

if [ ! -d "$APP_BUNDLE" ]; then
  echo "ERROR: No se genero $APP_BUNDLE."
  exit 1
fi

APP_FRONTEND_INDEX="$(find "$APP_BUNDLE" -path '*apps/frontend/dist/index.html' -print -quit)"
if [ -z "$APP_FRONTEND_INDEX" ]; then
  echo "ERROR: El frontend compilado no quedo embebido dentro de la app."
  exit 1
fi

echo "Armando paquete para cliente..."
mkdir -p "$PACKAGE_DIR/datos"
cp -R "$APP_BUNDLE" "$PACKAGE_DIR/"
cp "$APP_DIR/installer_assets/INSTALAR.command" "$PACKAGE_DIR/"
cp "$APP_DIR/installer_assets/LEEME_INSTALACION.txt" "$PACKAGE_DIR/"
chmod +x "$PACKAGE_DIR/INSTALAR.command"

if [ -f "$SEED_DB_PATH" ] && [ -s "$SEED_DB_PATH" ]; then
  cp "$SEED_DB_PATH" "$PACKAGE_DIR/datos/contabilidad.db"
else
  echo "AVISO: No se encontro una base inicial valida en:"
  echo "       $SEED_DB_PATH"
fi

if [ -d "$SEED_BACKUPS_DIR" ]; then
  mkdir -p "$PACKAGE_DIR/datos/backups"
  cp -R "$SEED_BACKUPS_DIR"/. "$PACKAGE_DIR/datos/backups/" 2>/dev/null || true
fi

ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$ZIP_PATH"

if command -v hdiutil >/dev/null 2>&1; then
  DMG_STAGING_DIR="$INSTALLER_DIR/.dmg-root"
  rm -rf "$DMG_STAGING_DIR"
  mkdir -p "$DMG_STAGING_DIR"
  cp -R "$PACKAGE_DIR" "$DMG_STAGING_DIR/"
  hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGING_DIR/ContabilidadMorsa_Mac" -ov -format UDZO "$DMG_PATH" >/dev/null
  rm -rf "$DMG_STAGING_DIR"
fi

echo
echo "Build macOS listo:"
echo "  $APP_BUNDLE"
echo "Paquete listo para cliente:"
echo "  $PACKAGE_DIR"
echo "  $ZIP_PATH"
if [ -f "$DMG_PATH" ]; then
  echo "  $DMG_PATH"
fi
