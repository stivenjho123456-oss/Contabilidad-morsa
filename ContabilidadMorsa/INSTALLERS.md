# Instaladores

La app ya quedó preparada para empaquetarse como aplicación de escritorio.

## Dónde guarda datos

La base SQLite y los backups ya no viven dentro del código fuente.

- macOS: `~/Library/Application Support/Contabilidad Morsa/`
- Windows: `%APPDATA%\Contabilidad Morsa\`

Ahí se guardan:

- `contabilidad.db`
- carpeta `backups/`

## Recursos incluidos

El build incluye estos archivos iniciales:

- `MARZO 2025.xlsx`
- `NOMINA DE  FEBRERO -2026.xlsx`

La app los leerá desde el bundle si existen. Si luego el usuario pone una copia editable en su carpeta de datos, la app usará esa copia primero.

## Build macOS

Desde la raíz del proyecto:

```bash
cd "/Users/stivenjohanhurtado/Contabilidad Morsa"
chmod +x ContabilidadMorsa/build_macos.sh
ContabilidadMorsa/build_macos.sh
```

Qué hace el script:

- compila `apps/frontend`
- ejecuta `smoke_test.py`
- empaqueta la app web embebida con FastAPI
- arma un paquete listo para cliente con app, instalador y, si existe, la base actual del usuario
- copia también los backups actuales si existen

Salida esperada:

```text
dist/Contabilidad Morsa.app
dist_installer/ContabilidadMorsa_Mac/
dist_installer/ContabilidadMorsa_Mac.zip
```

Si `hdiutil` está disponible, también genera:

```text
dist_installer/ContabilidadMorsa-macOS.dmg
```

### Base de datos incluida en el paquete

Por defecto el build toma como semilla:

```text
~/Library/Application Support/Contabilidad Morsa/contabilidad.db
~/Library/Application Support/Contabilidad Morsa/backups/
```

Si necesitas otra base para entregar, puedes sobreescribirlo así:

```bash
MORSA_SEED_DB_PATH="/ruta/a/contabilidad.db" \
MORSA_SEED_BACKUPS_DIR="/ruta/a/backups" \
ContabilidadMorsa/build_macos.sh
```

## Build Windows

Hazlo en una máquina Windows, no en macOS.

Desde la raíz del proyecto:

```bat
ContabilidadMorsa\build_windows.bat
```

Salida esperada:

```text
ContabilidadMorsa\dist\Contabilidad Morsa\
```

Si Inno Setup está instalado y `iscc` está en `PATH`, el mismo script intentará generar también:

```text
dist_installer\ContabilidadMorsaSetup.exe
```

## Instalador Windows

Para generar un `.exe` instalable en Windows:

1. Instala Inno Setup.
2. Ejecuta `ContabilidadMorsa\build_windows.bat`.
3. Si el script no genera el setup automáticamente, abre `ContabilidadMorsa\installer_windows.iss` en Inno Setup.
4. Compílalo.

Salida esperada:

```text
ContabilidadMorsa\dist_installer\ContabilidadMorsaSetup.exe
```

## Limitación real

El `.app` de macOS sí lo puedo construir aquí. El instalador final de Windows no se puede compilar de forma confiable desde este Mac; ese build debe hacerse en Windows.

## Recomendación de entrega a cliente Windows

- Entregar `ContabilidadMorsaSetup.exe`
- Instalar en modo usuario, no en `Program Files`
- Validar el checklist de [windows_release_checklist.md](/Users/stivenjohanhurtado/Contabilidad%20Morsa/ContabilidadMorsa/windows_release_checklist.md)
