-- 0001_baseline_schema.sql
-- Esquema completo de la aplicación.
-- Seguro en bases de datos existentes: usa IF NOT EXISTS en todo.
-- En despliegues frescos crea todo desde cero.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    applied_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS proveedores (
    id               BIGSERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS egresos (
    id                  BIGSERIAL PRIMARY KEY,
    fecha               TEXT NOT NULL,
    no_documento        TEXT,
    consecutivo         TEXT,
    proveedor_id        BIGINT,
    razon_social        TEXT NOT NULL,
    nit                 TEXT,
    valor               NUMERIC NOT NULL,
    tipo_gasto          TEXT NOT NULL,
    canal_pago          TEXT DEFAULT 'Otro',
    factura_electronica TEXT DEFAULT 'NO',
    observaciones       TEXT,
    soporte_path        TEXT,
    soporte_name        TEXT,
    support_file_id     BIGINT,
    source_module       TEXT,
    source_ref          TEXT,
    source_period       TEXT,
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);

CREATE TABLE IF NOT EXISTS ingresos (
    id         BIGSERIAL PRIMARY KEY,
    fecha      TEXT NOT NULL UNIQUE,
    caja       NUMERIC DEFAULT 0,
    bancos     NUMERIC DEFAULT 0,
    tarjeta_cr NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nomina_resumen (
    id                BIGSERIAL PRIMARY KEY,
    periodo           TEXT NOT NULL,
    empleado          TEXT NOT NULL,
    cedula            TEXT,
    valor_dia         NUMERIC DEFAULT 0,
    q1_dias           NUMERIC DEFAULT 0,
    q1_devengado      NUMERIC DEFAULT 0,
    q1_aux_transporte NUMERIC DEFAULT 0,
    q1_salud          NUMERIC DEFAULT 0,
    q1_pension        NUMERIC DEFAULT 0,
    q1_neto           NUMERIC DEFAULT 0,
    q2_dias           NUMERIC DEFAULT 0,
    q2_devengado      NUMERIC DEFAULT 0,
    q2_aux_transporte NUMERIC DEFAULT 0,
    q2_salud          NUMERIC DEFAULT 0,
    q2_pension        NUMERIC DEFAULT 0,
    q2_neto           NUMERIC DEFAULT 0,
    total_deduccion   NUMERIC DEFAULT 0,
    total_incapacidad NUMERIC DEFAULT 0,
    total_descuento   NUMERIC DEFAULT 0,
    total_mes         NUMERIC DEFAULT 0,
    origen_archivo    TEXT
);

CREATE TABLE IF NOT EXISTS nomina_seg_social (
    id             BIGSERIAL PRIMARY KEY,
    periodo        TEXT NOT NULL,
    grupo          TEXT,
    concepto       TEXT NOT NULL,
    valor          NUMERIC DEFAULT 0,
    observaciones  TEXT,
    origen_archivo TEXT
);

CREATE TABLE IF NOT EXISTS nomina_novedades (
    id             BIGSERIAL PRIMARY KEY,
    periodo        TEXT NOT NULL,
    fecha          TEXT NOT NULL,
    empleado       TEXT NOT NULL,
    cedula         TEXT,
    quincena       TEXT,
    naturaleza     TEXT NOT NULL,
    tipo_novedad   TEXT NOT NULL,
    valor          NUMERIC DEFAULT 0,
    observaciones  TEXT,
    origen_archivo TEXT
);

CREATE TABLE IF NOT EXISTS nomina_asistencia (
    id             BIGSERIAL PRIMARY KEY,
    periodo        TEXT NOT NULL,
    empleado       TEXT NOT NULL,
    cedula         TEXT,
    dia            INTEGER NOT NULL,
    quincena       TEXT NOT NULL,
    estado         TEXT NOT NULL,
    origen_archivo TEXT,
    UNIQUE(periodo, empleado, dia)
);

CREATE TABLE IF NOT EXISTS cierres_mensuales (
    id          BIGSERIAL PRIMARY KEY,
    mes         INTEGER NOT NULL,
    ano         INTEGER NOT NULL,
    periodo     TEXT NOT NULL,
    cerrado     INTEGER NOT NULL DEFAULT 1,
    cerrado_at  TEXT NOT NULL,
    observacion TEXT,
    UNIQUE(mes, ano)
);

CREATE TABLE IF NOT EXISTS auditoria (
    id         BIGSERIAL PRIMARY KEY,
    created_at TEXT NOT NULL,
    entidad    TEXT NOT NULL,
    entidad_id BIGINT,
    accion     TEXT NOT NULL,
    periodo    TEXT,
    detalle    TEXT,
    snapshot   TEXT
);

CREATE TABLE IF NOT EXISTS cuadre_caja (
    id             BIGSERIAL PRIMARY KEY,
    fecha          TEXT NOT NULL UNIQUE,
    saldo_inicial  NUMERIC NOT NULL DEFAULT 0,
    ingresos_caja  NUMERIC NOT NULL DEFAULT 0,
    egresos_caja   NUMERIC NOT NULL DEFAULT 0,
    saldo_esperado NUMERIC NOT NULL DEFAULT 0,
    saldo_real     NUMERIC,
    diferencia     NUMERIC,
    observaciones  TEXT,
    cerrado        INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS caja_ajustes (
    id            BIGSERIAL PRIMARY KEY,
    fecha         TEXT NOT NULL,
    tipo          TEXT NOT NULL,
    valor         NUMERIC NOT NULL,
    motivo        TEXT NOT NULL,
    observaciones TEXT,
    canal         TEXT DEFAULT 'Caja',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS caja_apertura (
    id            BIGSERIAL PRIMARY KEY,
    mes           INTEGER NOT NULL,
    ano           INTEGER NOT NULL,
    efectivo      NUMERIC NOT NULL DEFAULT 0,
    bancos        NUMERIC NOT NULL DEFAULT 0,
    tarjeta_cr    NUMERIC NOT NULL DEFAULT 0,
    observaciones TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE(mes, ano)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at   TEXT,
    user_agent   TEXT,
    ip_address   TEXT,
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id   ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);

CREATE TABLE IF NOT EXISTS archivos (
    id           BIGSERIAL PRIMARY KEY,
    scope        TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    content_type TEXT,
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    content      BYTEA NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id           BIGSERIAL PRIMARY KEY,
    ip_address   TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    success      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempted_at);

CREATE TABLE IF NOT EXISTS insumos (
    id         BIGSERIAL PRIMARY KEY,
    nombre     TEXT NOT NULL UNIQUE,
    categoria  TEXT DEFAULT 'General',
    unidad     TEXT DEFAULT 'unidad',
    activo     INTEGER DEFAULT 1,
    orden      INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventario_diario (
    id          BIGSERIAL PRIMARY KEY,
    fecha       TEXT NOT NULL,
    turno       INTEGER NOT NULL DEFAULT 1,
    insumo_id   BIGINT,
    nombre_extra TEXT,
    estado      TEXT NOT NULL,
    cantidad    NUMERIC,
    notas       TEXT,
    usuario_id  BIGINT,
    created_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS inventario_turno (
    id            BIGSERIAL PRIMARY KEY,
    fecha         TEXT NOT NULL,
    turno         INTEGER NOT NULL DEFAULT 1,
    observaciones TEXT,
    usuario_id    BIGINT,
    created_at    TEXT NOT NULL,
    deleted_at    TEXT,
    UNIQUE(fecha, turno)
);
