# Web App

La arquitectura recomendada para producción y para instalador Windows es:

- `apps/frontend`: React compilado
- `apps/backend`: FastAPI
- FastAPI sirve el frontend compilado en la misma URL
- SQLite sigue local en `%APPDATA%` o en la carpeta de datos del usuario

## Desarrollo

Backend:

```bash
cd "/Users/stivenjohanhurtado/Contabilidad Morsa"
./start_backend.sh
```

Frontend:

```bash
cd "/Users/stivenjohanhurtado/Contabilidad Morsa"
./start_frontend.sh
```

URLs:

```text
Backend:  http://127.0.0.1:8010
Frontend: http://127.0.0.1:5175
```

## Producción local

Compila primero el frontend:

```bash
cd "/Users/stivenjohanhurtado/Contabilidad Morsa/apps/frontend"
npm run build
```

Luego levanta solo FastAPI:

```bash
cd "/Users/stivenjohanhurtado/Contabilidad Morsa"
./start_backend.sh
```

Y abre:

```text
http://127.0.0.1:8010
```

## Windows

El build de Windows ahora está pensado para una sola app:

- compila React
- empaqueta el backend con el frontend ya compilado
- abre la aplicación en el navegador del sistema
- reaprovecha la instancia ya abierta y se apaga sola por inactividad al cerrar el navegador
- usa SQLite local persistente
- ejecuta `smoke_test.py` antes de empaquetar
- valida que el `frontend/dist` sí quedó embebido
- genera `Setup.exe` con instalación `per-user`

Script:

```bat
ContabilidadMorsa\build_windows.bat
```

### Resultado esperado

Si todo sale bien, debes obtener:

```text
dist\Contabilidad Morsa\Contabilidad Morsa.exe
dist_installer\ContabilidadMorsaSetup.exe
```

### Requisitos del equipo de build Windows

- Python con launcher `py`
- Node.js con `npm`
- Inno Setup en `PATH` para generar el instalador final

### Recomendación de validación

Antes de entregarlo al cliente, prueba en un Windows limpio:

1. Instalar `ContabilidadMorsaSetup.exe`
2. Abrir la app desde acceso directo
3. Confirmar que se abre en navegador y responde el dashboard
4. Crear un proveedor, ingreso y egreso
5. Exportar Excel
6. Crear backup
7. Cerrar y volver a abrir la app confirmando persistencia de datos
