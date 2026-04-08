# Deploy con Supabase y Vercel

## Estado real del proyecto

Hoy este sistema **no está listo para un despliegue directo a Vercel + Supabase** sin migración previa. La razón no es el frontend; es el backend.

Dependencias actuales que chocan con cloud:

- Base de datos SQLite local en `ContabilidadMorsa/database.py`
- Backups locales en disco en `ContabilidadMorsa/backup_manager.py`
- Soportes de egresos guardados en filesystem local en `apps/backend/app/main.py`
- Lógica de app de escritorio y launcher local en `apps/backend/launcher.py`

En Vercel, el filesystem no debe tratarse como almacenamiento persistente de aplicación. Supabase resuelve eso con **Postgres** y **Storage**, pero hay que migrar explícitamente.

## Arquitectura recomendada

### Fase 1. Despliegue serio y rápido

- Frontend React en **Vercel**
- Base de datos en **Supabase Postgres**
- Archivos adjuntos en **Supabase Storage**
- Backend API **fuera de Vercel** temporalmente
  - recomendado: Railway, Render o Fly.io

Esta fase es la más profesional porque evita forzar a Vercel a cubrir responsabilidades que hoy tu backend todavía maneja como app local.

### Fase 2. Full Supabase + Vercel

Sólo después de migrar:

- SQLite -> Postgres
- archivos locales -> Supabase Storage
- backups locales -> estrategia de export/restore compatible con Postgres
- lógica desktop/local -> runtime cloud

En ese punto sí puedes decidir entre:

- mantener FastAPI y correrlo en Vercel Functions
- o reescribir partes de la API hacia Supabase Data API / Edge Functions

## Qué ya quedó preparado

Se dejó el frontend listo para apuntar a una API pública con variable de entorno:

- archivo: `apps/frontend/.env.example`
- variable: `VITE_API_URL`

Ejemplo en Vercel:

```text
VITE_API_URL=https://api-contabilidad.tu-dominio.com
```

## Qué debes crear en Supabase

### 1. Proyecto

- Crea un proyecto en Supabase.
- Guarda:
  - `Project URL`
  - `Anon Key`
  - strings de conexión de Postgres

### 2. Base de datos

Debes migrar la estructura de SQLite a Postgres.

Tablas que claramente existen en el proyecto:

- `proveedores`
- `ingresos`
- `egresos`
- `cuadre_caja`
- `caja_ajustes`
- `nomina_resumen`
- `nomina_seg_social`
- `nomina_novedades`
- `nomina_asistencia`
- `cierres_mensuales`
- `auditoria`

### 3. Storage

Crea buckets para reemplazar filesystem local:

- `supports`
- opcionalmente `exports`
- opcionalmente `imports`

Los archivos de soporte de egresos deben dejar de escribirse con rutas locales y empezar a guardar:

- bucket
- object path
- URL firmada o path interno

## Qué falta cambiar en código

### Backend

#### A. Reemplazar SQLite

Actualmente el acceso a datos depende de:

- `sqlite3.connect(...)`
- SQL compatible con SQLite

Hay que migrarlo a Postgres.

Opciones razonables:

- `psycopg` + SQL manual
- `SQLAlchemy`

Si vas a correr el backend en serverless, usa el pooler de Supabase en **transaction mode**.

#### B. Reemplazar filesystem local

Hoy se usan:

- backups locales
- restore desde `.db`
- soportes en directorios locales

Eso no es válido como diseño principal en Vercel.

Debes mover:

- soportes a Supabase Storage
- backups a dumps/exportaciones compatibles con Postgres o snapshots gestionados por Supabase

#### C. Ajustar seguridad y runtime

La app actual también tiene:

- token local efímero
- heartbeat/cierre de ventana para modo escritorio

Eso es útil en desktop, pero no en cloud. Debe quedar desactivado o aislado para producción web.

## Despliegue del frontend en Vercel

### Root Directory recomendado

```text
apps/frontend
```

### Variables de entorno

```text
VITE_API_URL=https://api-contabilidad.tu-dominio.com
```

### Build

Vercel detecta Vite sin problema.

Valores esperados:

- Build Command: `npm run build`
- Output Directory: `dist`

## Conclusión

### Lo que sí puedes hacer ya

- desplegar el frontend en Vercel
- parametrizar la URL pública de API
- preparar Supabase como destino de datos y archivos

### Lo que no debes hacer todavía

- subir este backend tal cual a Vercel esperando que funcione como producción seria
- mantener SQLite y archivos locales como núcleo del sistema en cloud

## Siguiente paso recomendado

La ruta correcta es esta:

1. Migrar esquema y datos de SQLite a Supabase Postgres
2. Migrar soportes a Supabase Storage
3. Adaptar backend para Postgres y storage remoto
4. Publicar frontend en Vercel
5. Publicar API en un runtime persistente o completar adaptación a Vercel Functions

Si quieres, el siguiente paso útil es que yo mismo te arme la **fase 1 profesional**:

- frontend listo para Vercel
- backend listo para Supabase Postgres
- soportes listos para Supabase Storage

Eso sí sería un camino sólido de producción.
