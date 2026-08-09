# Migracion a Railway

Este proyecto ya esta listo para correr fuera de Supabase, Render y Vercel. El backend usa PostgreSQL por `DATABASE_URL` y no depende de APIs propietarias de Supabase. La migracion real es de infraestructura.

## Objetivo recomendado

Mover en este orden:

1. Base de datos: Supabase Postgres -> Railway Postgres
2. Backend: Render -> Railway
3. Frontend: Vercel -> Railway solo si de verdad quieres consolidar todo

Si quieres minimizar riesgo, migra primero base de datos + backend y deja el frontend en Vercel durante el corte.

## 1. Crear el Postgres en Railway

En Railway:

1. Crea un proyecto nuevo.
2. Agrega un servicio `PostgreSQL`.
3. Copia estas variables del servicio de base de datos:
   `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `DATABASE_URL`

Referencia oficial:

- PostgreSQL en Railway: https://docs.railway.com/databases/postgresql

## 2. Exportar la base actual desde Supabase

Haz el respaldo con `pg_dump` usando la conexion directa de Supabase, no el pooler si puedes evitarlo para una migracion grande.

```bash
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --dbname="postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require" \
  --file=supabase_backup.dump
```

Si no tienes `pg_dump`, instalalo con PostgreSQL client tools antes del corte.

## 3. Restaurar en Railway

Restaura el dump sobre la base nueva de Railway:

```bash
pg_restore \
  --verbose \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="postgresql://USER:PASSWORD@HOST:PORT/railway?sslmode=require" \
  supabase_backup.dump
```

Si Railway te entrega variables separadas, puedes usar:

```bash
PGPASSWORD="tu_password" pg_restore \
  --verbose \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  supabase_backup.dump
```

Referencia oficial:

- Guia de migracion de Railway con `pg_dump`/`pg_restore`: https://docs.railway.com/platform/migrate-from-lovable

## 4. Verificar el esquema antes del cambio

Con la base de Railway ya restaurada, valida localmente contra esa base:

```bash
DATABASE_URL="postgresql://..." ./.venv/bin/python apps/backend/postgres_smoke_test.py
```

Tambien puedes levantar el backend local contra Railway:

```bash
DATABASE_URL="postgresql://..." \
MORSA_ALLOWED_ORIGINS="http://127.0.0.1:5175" \
MORSA_DEV_MODE=1 \
./start_backend.sh
```

La API ya valida el contrato del esquema al arrancar. Si algo falta, lo reporta desde `db_adapter.py`.

## 5. Subir el backend a Railway

En este repo ya existe [apps/backend/Dockerfile](/Users/stivenjohanhurtado/Contabilidad%20Morsa/apps/backend/Dockerfile) para desplegar FastAPI en Railway.

Variables minimas del servicio backend:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
MORSA_API_SECRET=...
MORSA_PASSWORD_PEPPER=...
MORSA_ADMIN_USERNAME=admin
MORSA_ADMIN_PASSWORD=...
MORSA_ADMIN_FULL_NAME=Administrador General
MORSA_ALLOWED_ORIGINS=https://tu-frontend
MORSA_SESSION_HOURS=12
MORSA_ENABLE_DOCS=0
PYTHONUNBUFFERED=1
```

Notas:

- Railway expone un `PORT` automaticamente; el `Dockerfile` ya lo usa.
- Si el backend y la base viven en el mismo proyecto de Railway, usa la referencia `${{Postgres.DATABASE_URL}}` para no copiar credenciales a mano.
- Railway documenta que los servicios publicos deben escuchar en `0.0.0.0:$PORT`.

Referencias oficiales:

- Variables: https://docs.railway.com/variables
- Public networking y `PORT`: https://docs.railway.com/public-networking
- Start command: https://docs.railway.com/deployments/start-command

## 6. Frontend: moverlo o dejarlo

El frontend React/Vite puede:

- quedarse en Vercel, cambiando `VITE_API_URL` al nuevo backend de Railway
- migrarse a Railway si quieres centralizar todo

Si lo migras a Railway, al ser una SPA de Vite necesitas compilar `dist/` y servir archivos estaticos. Railway documenta dos enfoques viables:

- hosting estatico desde GitHub
- servir `dist` con `serve --single --listen $PORT dist`

Referencias oficiales:

- Static hosting: https://docs.railway.com/guides/static-hosting
- Vite en Railway: https://docs.railway.com/deployments/troubleshooting/no-start-command-could-be-found

## 7. Corte a produccion recomendado

Para evitar perdida de datos:

1. Programa una ventana corta de mantenimiento.
2. Bloquea escrituras en la app vieja.
3. Toma un dump final de Supabase.
4. Restaura ese dump final en Railway.
5. Actualiza `DATABASE_URL` del backend en Railway.
6. Cambia `VITE_API_URL` o el dominio del frontend.
7. Prueba login, dashboard, proveedores, ingresos, egresos, inventario y carga de archivos.
8. Solo despues apaga Supabase/Render.

## Riesgos especificos de este proyecto

- Hay columnas `BYTEA` en `archivos.content`; el dump/restore debe incluir datos binarios completos.
- El backend traduce SQL estilo SQLite a PostgreSQL, asi que lo importante no es Supabase sino mantener PostgreSQL compatible.
- `MORSA_ALLOWED_ORIGINS` debe quedar con el dominio final real del frontend o el navegador bloqueara CORS.
- El chequeo de esquema es estricto; si falta una tabla o columna, la API no deberia arrancar.

## Comandos utiles despues de migrar

Verificar backend:

```bash
python3 -m py_compile apps/backend/app/main.py apps/backend/app/db_adapter.py apps/backend/smoke_test.py
DATABASE_URL="postgresql://..." ./.venv/bin/python apps/backend/postgres_smoke_test.py
```

Verificar frontend:

```bash
cd apps/frontend
npm run lint
npm run build
```
