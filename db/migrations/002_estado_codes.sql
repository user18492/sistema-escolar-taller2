-- db/migrations/002_estado_codes.sql
-- Alinea los nombres de usuario_estados con los códigos que ya usa
-- el HTML (data-value="ACTIVE"/"SUSPENDED" en el filtro de la tabla).

UPDATE usuario_estados SET nombre = 'ACTIVE'    WHERE nombre = 'activo';
UPDATE usuario_estados SET nombre = 'SUSPENDED' WHERE nombre = 'inactivo';
