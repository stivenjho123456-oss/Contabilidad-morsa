# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Arquitectura

Aplicación web de contabilidad para restaurante (La Morsa). Stack:

- **Frontend**: React + Vite → desplegado en Vercel (`apps/frontend/`)
- **Backend**: FastAPI → desplegado en Render (`apps/backend/`)
- **Base de datos**: PostgreSQL en Supabase (producción) / SQLite (tests locales)

### El parche crítico de `get_connection`

`ContabilidadMorsa/database.py` es el módulo central de base de datos. Fue escrito originalmente para SQLite. En producción, `apps/backend/app/main.py` lo parchea al arrancar:

```python
# main.py línea 49
_db_module.get_connection = _db_adapter.get_pg_connection
```

Esto redirige todas las llamadas a PostgreSQL sin modificar `database.py`. El archivo `apps/backend/app/db_adapter.py` traduce SQL estilo SQLite (`?`, `strftime`, `BEGIN IMMEDIATE`) a PostgreSQL.

### Flujo de imports

```
apps/backend/app/main.py
  → agrega ContabilidadMorsa/ al sys.path
  → importa database.py (SQLite por defecto)
  → parchea get_connection → get_pg_connection (si DATABASE_URL existe)
  → importa routers/inventario.py, routers/auth.py
```

### Roles de usuario

- `admin`: acceso total
- `cocina`: solo rutas `/api/inventario/*` y `/api/insumos`

El middleware en `main.py` aplica este filtro en cada request.

### Sistema de inventario (versiones)

Cada save del inventario crea una nueva `version` (INTEGER) en `inventario_diario` e `inventario_turno`. **Nunca se borra el historial.** Las queries siempre filtran por `MAX(version)` para obtener el estado más reciente. Un turno puede guardarse múltiples veces sin perder datos anteriores.

La unicidad de `inventario_turno` es por `(fecha, turno, version)` y **solo entre filas vivas** (`WHERE deleted_at IS NULL`), porque `next_version` se calcula con `MAX(version)` ignorando las borradas. La migración `0004` quitó el `UNIQUE(fecha, turno)` original, que era incompatible con el versionado y hacía fallar el segundo guardado de un turno.

### Migraciones

Las migraciones SQL están en `apps/backend/migrations/NNNN_nombre.sql` y se ejecutan automáticamente al arrancar la API en Render (solo PostgreSQL). El schema base para un Supabase nuevo está en `supabase/schema.sql`.

## Comandos de desarrollo local

```bash
# Backend (Puerto 8010)
./start_backend.sh

# Frontend (Puerto 5175)
./start_frontend.sh
```

Requiere `.venv` creado con `python3 -m venv .venv && .venv/bin/pip install -r apps/backend/requirements.txt`.

## Tests y verificación

```bash
# Tests de integración con SQLite (sin Supabase)
./.venv/bin/python apps/backend/smoke_test.py

# Tests contra PostgreSQL real (requiere DATABASE_URL o PG_HOST/PG_PASSWORD)
./.venv/bin/python apps/backend/postgres_smoke_test.py

# Lint y build del frontend
cd apps/frontend && npm run lint && npm run build

# Verificar sintaxis Python
python3 -m py_compile apps/backend/app/main.py apps/backend/app/db_adapter.py
```

El `smoke_test.py` levanta la app con SQLite en un directorio temporal (`MORSA_ALLOW_SQLITE=1`) y ejecuta todos los endpoints con un `TestClient` de FastAPI.

## Variables de entorno clave

| Variable | Dónde | Descripción |
|---|---|---|
| `DATABASE_URL` | Render | Connection string de Supabase (Transaction Pooler) |
| `MORSA_ALLOWED_ORIGINS` | Render | URL del frontend en Vercel |
| `MORSA_API_SECRET` | Render | Token de auth entre frontend y backend |
| `MORSA_PASSWORD_PEPPER` | Render | Pepper para hashing de contraseñas |
| `MORSA_ALLOW_SQLITE` | Solo tests | Habilita SQLite como fallback |
| `MORSA_PASSWORD_RESET` | Temporal | `usuario:ClaveNueva` — restablece esa contraseña al arrancar. Borrar tras usar |
| `VITE_API_URL` | `apps/frontend/.env` | URL del backend |

## Consideraciones importantes

- **No usar `;` en comentarios SQL** de archivos de migración — el runner los parte por `;` y ejecutaría el texto del comentario como sentencia.
- **`REQUIRED_PG_SCHEMA`** en `db_adapter.py` debe actualizarse cada vez que se agrega una columna a una tabla existente, o el health check falla al arrancar.
- **`@serialized_write`** es un decorator en `database.py` que serializa escrituras concurrentes con un `threading.RLock`. Debe aplicarse a todas las funciones que escriben a la DB.
- **Respaldos**: `backup_critical_tables()` guarda un JSON en la tabla `archivos`, o sea *dentro* de la misma base. Eso solo protege de un borrado accidental desde la app, no de perder la base. Para una copia real usa `GET /api/admin/backup/descargar`, que entrega el archivo, o un `pg_dump`.
- **`_BACKUP_TABLES`** en `database.py` debe incluir toda tabla de negocio nueva. Un respaldo que omite una tabla es peor que no tener respaldo.
- **Recuperación de contraseña**: no hay correo. Se hace con `MORSA_PASSWORD_RESET` o con `apps/backend/reset_password.py`. Ver [docs/recuperar-password.md](docs/recuperar-password.md).
- Las fechas se almacenan como `TEXT` en formato `YYYY-MM-DD`. Los timestamps (`created_at`, `deleted_at`) como ISO 8601. La conversión de zona horaria (Colombia = UTC-5) es responsabilidad del frontend al construir el campo `fecha`.
