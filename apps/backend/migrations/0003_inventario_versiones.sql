-- 0003_inventario_versiones.sql
-- Agrega columna version a las tablas de inventario.
-- Cada save crea una nueva version; nunca se borran versiones anteriores.
-- La app siempre muestra la version con MAX(version) para cada fecha+turno.

ALTER TABLE inventario_diario ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inventario_turno  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_inventario_diario_version
    ON inventario_diario(fecha, turno, version)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventario_turno_version
    ON inventario_turno(fecha, turno, version)
    WHERE deleted_at IS NULL;
