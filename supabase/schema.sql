-- ============================================================
-- Contabilidad Morsa — Esquema PostgreSQL para Supabase
-- Ejecutar en el SQL Editor de Supabase (una sola vez)
-- ============================================================

-- ── Proveedores ──────────────────────────────────────────────
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

-- ── Egresos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS egresos (
    id                  SERIAL PRIMARY KEY,
    fecha               TEXT NOT NULL,
    no_documento        TEXT,
    consecutivo         TEXT,
    proveedor_id        INTEGER REFERENCES proveedores(id),
    razon_social        TEXT NOT NULL,
    nit                 TEXT,
    valor               DOUBLE PRECISION NOT NULL,
    tipo_gasto          TEXT NOT NULL,
    canal_pago          TEXT DEFAULT 'Otro',
    factura_electronica TEXT DEFAULT 'NO',
    observaciones       TEXT,
    soporte_path        TEXT,
    soporte_name        TEXT,
    source_module       TEXT,
    source_ref          TEXT,
    source_period       TEXT
);

-- ── Ingresos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingresos (
    id         SERIAL PRIMARY KEY,
    fecha      TEXT NOT NULL UNIQUE,
    caja       DOUBLE PRECISION DEFAULT 0,
    bancos     DOUBLE PRECISION DEFAULT 0,
    tarjeta_cr DOUBLE PRECISION DEFAULT 0
);

-- ── Nómina: resumen mensual ───────────────────────────────────
CREATE TABLE IF NOT EXISTS nomina_resumen (
    id                SERIAL PRIMARY KEY,
    periodo           TEXT NOT NULL,
    empleado          TEXT NOT NULL,
    cedula            TEXT,
    valor_dia         DOUBLE PRECISION DEFAULT 0,
    q1_dias           DOUBLE PRECISION DEFAULT 0,
    q1_devengado      DOUBLE PRECISION DEFAULT 0,
    q1_aux_transporte DOUBLE PRECISION DEFAULT 0,
    q1_salud          DOUBLE PRECISION DEFAULT 0,
    q1_pension        DOUBLE PRECISION DEFAULT 0,
    q1_neto           DOUBLE PRECISION DEFAULT 0,
    q2_dias           DOUBLE PRECISION DEFAULT 0,
    q2_devengado      DOUBLE PRECISION DEFAULT 0,
    q2_aux_transporte DOUBLE PRECISION DEFAULT 0,
    q2_salud          DOUBLE PRECISION DEFAULT 0,
    q2_pension        DOUBLE PRECISION DEFAULT 0,
    q2_neto           DOUBLE PRECISION DEFAULT 0,
    total_deduccion   DOUBLE PRECISION DEFAULT 0,
    total_incapacidad DOUBLE PRECISION DEFAULT 0,
    total_descuento   DOUBLE PRECISION DEFAULT 0,
    total_mes         DOUBLE PRECISION DEFAULT 0,
    origen_archivo    TEXT
);

-- ── Nómina: seguridad social ──────────────────────────────────
CREATE TABLE IF NOT EXISTS nomina_seg_social (
    id             SERIAL PRIMARY KEY,
    periodo        TEXT NOT NULL,
    grupo          TEXT,
    concepto       TEXT NOT NULL,
    valor          DOUBLE PRECISION DEFAULT 0,
    observaciones  TEXT,
    origen_archivo TEXT
);

-- ── Nómina: novedades ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nomina_novedades (
    id             SERIAL PRIMARY KEY,
    periodo        TEXT NOT NULL,
    fecha          TEXT NOT NULL,
    empleado       TEXT NOT NULL,
    cedula         TEXT,
    quincena       TEXT,
    naturaleza     TEXT NOT NULL,
    tipo_novedad   TEXT NOT NULL,
    valor          DOUBLE PRECISION DEFAULT 0,
    observaciones  TEXT,
    origen_archivo TEXT
);

-- ── Nómina: asistencia ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS nomina_asistencia (
    id             SERIAL PRIMARY KEY,
    periodo        TEXT NOT NULL,
    empleado       TEXT NOT NULL,
    cedula         TEXT,
    dia            INTEGER NOT NULL,
    quincena       TEXT NOT NULL,
    estado         TEXT NOT NULL,
    origen_archivo TEXT,
    UNIQUE(periodo, empleado, dia)
);

-- ── Cierres mensuales ────────────────────────────────────────
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

-- ── Auditoría ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria (
    id         SERIAL PRIMARY KEY,
    created_at TEXT NOT NULL,
    entidad    TEXT NOT NULL,
    entidad_id INTEGER,
    accion     TEXT NOT NULL,
    periodo    TEXT,
    detalle    TEXT,
    snapshot   TEXT
);

-- ── Cuadre de caja ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuadre_caja (
    id             SERIAL PRIMARY KEY,
    fecha          TEXT NOT NULL UNIQUE,
    saldo_inicial  DOUBLE PRECISION NOT NULL DEFAULT 0,
    ingresos_caja  DOUBLE PRECISION NOT NULL DEFAULT 0,
    egresos_caja   DOUBLE PRECISION NOT NULL DEFAULT 0,
    saldo_esperado DOUBLE PRECISION NOT NULL DEFAULT 0,
    saldo_real     DOUBLE PRECISION,
    diferencia     DOUBLE PRECISION,
    observaciones  TEXT,
    cerrado        INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

-- ── Ajustes de caja ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caja_ajustes (
    id            SERIAL PRIMARY KEY,
    fecha         TEXT NOT NULL,
    tipo          TEXT NOT NULL,
    valor         DOUBLE PRECISION NOT NULL,
    motivo        TEXT NOT NULL,
    observaciones TEXT,
    created_at    TEXT NOT NULL
);

-- ── Usuarios / autenticación ──────────────────────────────────
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

-- ── Índices de rendimiento ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_egresos_fecha      ON egresos(fecha);
CREATE INDEX IF NOT EXISTS idx_egresos_canal      ON egresos(canal_pago);
CREATE INDEX IF NOT EXISTS idx_egresos_tipo       ON egresos(tipo_gasto);
CREATE INDEX IF NOT EXISTS idx_ingresos_fecha     ON ingresos(fecha);
CREATE INDEX IF NOT EXISTS idx_auditoria_created  ON auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cuadre_caja_fecha  ON cuadre_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_caja_ajustes_fecha ON caja_ajustes(fecha);
CREATE INDEX IF NOT EXISTS idx_nomina_periodo     ON nomina_resumen(periodo);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_exp  ON auth_sessions(expires_at);
