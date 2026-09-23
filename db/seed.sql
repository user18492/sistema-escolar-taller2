-- db/seed.sql
-- Datos mínimos para que el sistema funcione mientras no hay
-- login real ni pantallas de administración de catálogos.
-- Ejecutar una sola vez, después de schema.sql:
--   psql -U postgres -d db_taller -f seed.sql

BEGIN;

INSERT INTO usuario_roles (nombre) VALUES
    ('ADMIN'),
    ('SECRETARY'),
    ('TEACHER');

-- Los nombres coinciden con los data-value que ya usa el filtro
-- de estado en la tabla de usuarios (renderer/admin/users).
INSERT INTO usuario_estados (nombre, descripcion) VALUES
    ('ACTIVE', 'Usuario habilitado para operar en el sistema'),
    ('SUSPENDED', 'Usuario deshabilitado, no puede iniciar sesion');

-- Institución por defecto (institucion_id = 1, hardcodeado en el código
-- hasta que exista selección real de institución / login).
INSERT INTO instituciones (nombre) VALUES
    ('Institución por defecto');

COMMIT;
