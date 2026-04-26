-- 0002_soft_deletes_inventario.sql
-- Agrega deleted_at a las tablas de inventario.
-- Reemplaza DELETE físico por marcado lógico — los datos nunca se pierden.

ALTER TABLE inventario_diario ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE inventario_turno  ADD COLUMN IF NOT EXISTS deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_inventario_diario_fecha_turno
    ON inventario_diario(fecha, turno)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventario_turno_fecha
    ON inventario_turno(fecha)
    WHERE deleted_at IS NULL;
