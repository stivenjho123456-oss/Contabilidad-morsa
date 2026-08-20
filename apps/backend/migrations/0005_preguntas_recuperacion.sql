-- 0005_preguntas_recuperacion.sql
-- Preguntas de seguridad para recuperar la contrasena sin servidor de correo.
--
-- Las respuestas se guardan hasheadas con el mismo PBKDF2 que las contrasenas,
-- nunca en claro: quien lea la base no puede responder las preguntas.
-- Se normalizan antes de hashear (minusculas, sin tildes, sin espacios de mas)
-- para que "Bogota" y "bogota" cuenten como la misma respuesta.

CREATE TABLE IF NOT EXISTS usuario_preguntas (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT NOT NULL,
    orden          INTEGER NOT NULL DEFAULT 0,
    pregunta       TEXT NOT NULL,
    respuesta_hash TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usuario_preguntas_user ON usuario_preguntas(user_id);

-- login_attempts pasa a registrar tambien el usuario, para poder limitar los
-- intentos por cuenta y no solo por IP. Sin esto, alguien que rote de IP
-- podria seguir adivinando respuestas de la misma cuenta indefinidamente.
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS username TEXT;

CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, attempted_at);
