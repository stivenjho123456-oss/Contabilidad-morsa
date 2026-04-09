-- Upgrade seguro para instalaciones cloud ya existentes.
-- Ejecutar en Supabase SQL Editor antes de desplegar la versión nueva.

CREATE TABLE IF NOT EXISTS proveedores (
    id               SERIAL PRIMARY KEY,
    razon_social     TEXT NOT NULL,
    nit              TEXT,
    primer_nombre    TEXT,
    segundo_nombre   TEXT,
    primer_apellido  TEXT,
    segundo_apellido TEXT,
    direccion        TEXT,
    telefono         TEXT,
    correo           TEXT,
    tipo             TEXT
);

CREATE TABLE IF NOT EXISTS ingresos (
    id         SERIAL PRIMARY KEY,
    fecha      TEXT NOT NULL UNIQUE,
    caja       DOUBLE PRECISION DEFAULT 0,
    bancos     DOUBLE PRECISION DEFAULT 0,
    tarjeta_cr DOUBLE PRECISION DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cierres_mensuales (
    id          SERIAL PRIMARY KEY,
    mes         INTEGER NOT NULL,
    ano         INTEGER NOT NULL,
    periodo     TEXT NOT NULL,
    cerrado     INTEGER NOT NULL DEFAULT 1,
    cerrado_at  TEXT NOT NULL,
    observacion TEXT,
    UNIQUE(mes, ano)
);

CREATE TABLE IF NOT EXISTS archivos (
    id            SERIAL PRIMARY KEY,
    scope         TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    content_type  TEXT,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    content       BYTEA NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    full_name      TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'admin',
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES usuarios(id),
    token_hash    TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    revoked_at    TEXT,
    user_agent    TEXT,
    ip_address    TEXT
);

ALTER TABLE egresos ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES proveedores(id);
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS canal_pago TEXT DEFAULT 'Otro';
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS factura_electronica TEXT DEFAULT 'NO';
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS soporte_path TEXT;
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS soporte_name TEXT;
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS support_file_id INTEGER REFERENCES archivos(id);
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS source_module TEXT;
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS source_period TEXT;

ALTER TABLE nomina_resumen ADD COLUMN IF NOT EXISTS origen_archivo TEXT;

ALTER TABLE nomina_seg_social ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE nomina_seg_social ADD COLUMN IF NOT EXISTS origen_archivo TEXT;

ALTER TABLE nomina_novedades ADD COLUMN IF NOT EXISTS cedula TEXT;
ALTER TABLE nomina_novedades ADD COLUMN IF NOT EXISTS quincena TEXT;
ALTER TABLE nomina_novedades ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE nomina_novedades ADD COLUMN IF NOT EXISTS origen_archivo TEXT;

ALTER TABLE nomina_asistencia ADD COLUMN IF NOT EXISTS cedula TEXT;
ALTER TABLE nomina_asistencia ADD COLUMN IF NOT EXISTS origen_archivo TEXT;

ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS periodo TEXT;
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS detalle TEXT;
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS snapshot TEXT;

ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS cerrado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT CURRENT_TIMESTAMP::text;

ALTER TABLE caja_ajustes ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE caja_ajustes ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT CURRENT_TIMESTAMP::text;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT CURRENT_TIMESTAMP::text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT CURRENT_TIMESTAMP::text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS last_login_at TEXT;

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT CURRENT_TIMESTAMP::text;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP::text;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS revoked_at TEXT;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;

CREATE INDEX IF NOT EXISTS idx_egresos_fecha ON egresos(fecha);
CREATE INDEX IF NOT EXISTS idx_egresos_canal ON egresos(canal_pago);
CREATE INDEX IF NOT EXISTS idx_egresos_tipo ON egresos(tipo_gasto);
CREATE INDEX IF NOT EXISTS idx_egresos_support_id ON egresos(support_file_id);
CREATE INDEX IF NOT EXISTS idx_ingresos_fecha ON ingresos(fecha);
CREATE INDEX IF NOT EXISTS idx_auditoria_created ON auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cuadre_caja_fecha ON cuadre_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_caja_ajustes_fecha ON caja_ajustes(fecha);
CREATE INDEX IF NOT EXISTS idx_nomina_periodo ON nomina_resumen(periodo);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_exp ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_archivos_scope ON archivos(scope, created_at DESC);
