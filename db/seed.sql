-- Datos minimos de prueba.
-- Lo ejecuta db/setup-db.ps1 (npm run db:setup) después de schema.sql.
--
-- Contraseñas: los valores de password_hash son hashes bcrypt (algoritmo $2b$,
-- costo 10). La contraseña en texto plano de cada usuario se indica en el
-- comentario de su fila; son solo para desarrollo/pruebas locales.

BEGIN;

-- Roles del sistema
INSERT INTO usuario_roles (nombre) VALUES
    ('ADMIN'),
    ('SECRETARIO'),
    ('PROFESOR');

-- Institucion de prueba
INSERT INTO instituciones (nombre, direccion_calle, direccion_altura, email, telefono, cuit) VALUES
    ('Instituto San Martin', 'Av. Belgrano', '1234', 'contacto@institucion.edu.ar', '+54 379 4123456', '30-71234567-8');

-- Usuarios: uno por rol.
-- Credenciales de acceso (email / contraseña en texto plano):
--   ana.morales@institucion.edu.ar      / Admin123!       (ADMIN)
--   lucia.perez@institucion.edu.ar      / Secretario123!  (SECRETARIO)
--   martin.gomez@institucion.edu.ar     / Profesor123!    (PROFESOR)
--   carla.fernandez@institucion.edu.ar  / Profesor123!    (PROFESOR, inactivo)
INSERT INTO usuarios (usuario_rol_id, usuario_estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento) VALUES
    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Ana', 'Morales', 'ana.morales@institucion.edu.ar',
     -- Contraseña: Admin123!
     '$2b$10$tWzkxipsUu4Kv4.7pqMIR.FGjEut8Tfrtc0rQPfuqZFFwkZEI6xnS', '34567890', '1985-03-12'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Lucia', 'Perez', 'lucia.perez@institucion.edu.ar',
     -- Contraseña: Secretario123!
     '$2b$10$RWopdPiMv1PMnPl6aQM3IOw4bgAT/LHfyy0PQ5GUZEIYqAGgcGhDS', '35678901', '1990-07-25'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Martin', 'Gomez', 'martin.gomez@institucion.edu.ar',
     -- Contraseña: Profesor123!
     '$2b$10$2u2u2VcUbqdGZGD0WPupSOSTfCh6Fb1/Peg8iz345uKVCIo22B1Dq', '36789012', '1988-11-04'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     FALSE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Carla', 'Fernandez', 'carla.fernandez@institucion.edu.ar',
     -- Contraseña: Profesor123!
     '$2b$10$xwwU7BrQ4BHbcLAEnwo/ReWwyFPd5tFv6QAaCm.kGbdVvkNzptfQ6', '37890123', '1992-02-18');

COMMIT;
