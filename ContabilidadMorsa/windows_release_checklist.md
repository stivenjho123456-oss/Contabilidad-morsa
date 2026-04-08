# Checklist de entrega Windows

## Antes de compilar

- Usar una máquina Windows 10 o 11 real.
- Confirmar que Python esté instalado y disponible con `py`.
- Instalar Inno Setup si se quiere generar el instalador final `.exe`.
- Cerrar Excel antes de probar exportaciones.

## Build

Desde la raíz del proyecto:

```bat
ContabilidadMorsa\build_windows.bat
```

Salida esperada:

- `dist\Contabilidad Morsa\Contabilidad Morsa.exe`
- `dist_installer\ContabilidadMorsaSetup.exe` si `iscc` está instalado

## Pruebas obligatorias

- Instalar el setup en un usuario normal, sin permisos de administrador.
- Abrir la app desde el acceso directo del escritorio.
- Crear un proveedor.
- Crear un ingreso.
- Crear un egreso con `Factura electrónica = SI`.
- Exportar `Reporte`, `Cierre` y `Todo`.
- Crear un backup manual.
- Cerrar y abrir la app y validar que los datos persisten.
- Desinstalar la app y confirmar que `%APPDATA%\Contabilidad Morsa\` sigue intacto.

## Rutas a validar

- Datos de usuario: `%APPDATA%\Contabilidad Morsa\`
- Base de datos: `%APPDATA%\Contabilidad Morsa\contabilidad.db`
- Backups: `%APPDATA%\Contabilidad Morsa\backups\`

## Riesgos a revisar antes de entregar

- SmartScreen bloqueando el instalador por falta de firma digital.
- Antivirus corporativo bloqueando el `.exe`.
- Excel abierto durante una exportación.
- Ruta con caracteres especiales en el usuario de Windows.

## Recomendación de producción

- Firmar `ContabilidadMorsaSetup.exe` y `Contabilidad Morsa.exe`.
- Mantener el instalador en modo `per-user`.
- Entregar siempre el `setup`, no la carpeta `dist`.
