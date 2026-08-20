-- 0004_inventario_turno_multiversion.sql
-- Corrige el choque entre el versionado y la restriccion original de la tabla.
--
-- La migracion 0001 creo inventario_turno con UNIQUE(fecha, turno), pensada para
-- una sola fila por turno. La 0003 introdujo el versionado, donde cada guardado
-- inserta una fila nueva con version incremental para el mismo fecha+turno.
-- Las dos reglas se contradicen: el segundo guardado de un turno chocaba contra
-- la restriccion, la transaccion completa se revertia y el usuario perdia lo que
-- acababa de capturar, items incluidos.
--
-- La unicidad correcta es por fecha+turno+version, y solo entre filas vivas,
-- porque next_version se calcula con MAX(version) ignorando las borradas.

ALTER TABLE inventario_turno DROP CONSTRAINT IF EXISTS inventario_turno_fecha_turno_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_turno_fecha_turno_version
    ON inventario_turno(fecha, turno, version)
    WHERE deleted_at IS NULL;
