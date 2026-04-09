# Contabilidad Morsa

Producto `web-only` para operación contable con:

- `apps/frontend`: React + Vite
- `apps/backend`: FastAPI
- `Supabase Postgres`: base de datos
- `Render`: API
- `Vercel`: frontend

## Desarrollo local

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

## Variables principales

Backend:

```text
DATABASE_URL=postgresql://...
MORSA_ALLOWED_ORIGINS=https://tu-frontend.vercel.app
MORSA_API_SECRET=secreto-largo-y-aleatorio
MORSA_PASSWORD_PEPPER=pepper-largo-y-aleatorio
MORSA_SESSION_HOURS=12
MORSA_ADMIN_USERNAME=admin
MORSA_ADMIN_PASSWORD=...
MORSA_ADMIN_FULL_NAME=Administrador General
MORSA_ENABLE_DOCS=0
```

Frontend:

```text
VITE_API_URL=https://tu-backend.onrender.com
```

## Despliegue

1. Ejecuta `supabase/schema.sql` en Supabase.
2. Si existe una base histórica, migra con `supabase/migrate_sqlite_to_supabase.py`.
3. Despliega el backend con `render.yaml`.
4. Despliega el frontend con `vercel.json`.
5. Ajusta `MORSA_ALLOWED_ORIGINS` con la URL final de Vercel.

## Verificación

```bash
python3 -m py_compile apps/backend/app/main.py apps/backend/app/db_adapter.py apps/backend/smoke_test.py
./.venv/bin/python apps/backend/smoke_test.py
./.venv/bin/python apps/backend/postgres_smoke_test.py
cd apps/frontend && npm run lint && npm run build
```

## Notas

- No hay instaladores locales ni app de escritorio soportada.
- En producción, PostgreSQL debe existir y coincidir con el contrato validado por la API.
- El fallback SQLite queda sólo para pruebas automatizadas.
- `postgres_smoke_test.py` requiere `DATABASE_URL` o `PG_HOST`/`PG_PASSWORD` y valida la ruta real de nube.
