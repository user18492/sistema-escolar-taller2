-- Pasos a seguir:
--   1) Crear la base de datos:
--        createdb nombre_de_tu_db
--   2) Ejecutar este archivo contra esa base:
--        psql -U tu_usuario -d nombre_de_tu_db -f schema.sql

--Si te sale no reconocido, tenes que agregar el path del bin de postgres a la variable de entorno PATH de tu sistema operativo.

BEGIN;

-- Estados
CREATE TABLE usuario_estados (
    usuario_estado_id SERIAL PRIMARY KEY,
    nombre            VARCHAR(50) NOT NULL,
    descripcion       VARCHAR(255)
);

-- Roles
CREATE TABLE usuario_roles (
    usuario_rol_id SERIAL PRIMARY KEY,
    nombre         VARCHAR(50) NOT NULL
);

-- Instituciones
CREATE TABLE instituciones (
    institucion_id    SERIAL PRIMARY KEY,
    nombre            VARCHAR(150),
    direccion_calle   VARCHAR(150),
    direccion_altura  VARCHAR(20),
    email             VARCHAR(150),
    telefono          VARCHAR(30),
    cuit              VARCHAR(20)
);

-- Usuarios
CREATE TABLE usuarios (
    usuario_id         SERIAL PRIMARY KEY,
    usuario_rol_id     INTEGER NOT NULL REFERENCES usuario_roles(usuario_rol_id),
    usuario_estado_id  INTEGER NOT NULL REFERENCES usuario_estados(usuario_estado_id),
    institucion_id     INTEGER NOT NULL REFERENCES instituciones(institucion_id),
    nombre             VARCHAR(100),
    apellido           VARCHAR(100),
    email              VARCHAR(150),
    password_hash      VARCHAR(255),
    dni                VARCHAR(20),
    fecha_nacimiento   DATE,
    imagen_url         VARCHAR(255)
);

-- Indices porque sino no se hacen solos
CREATE INDEX idx_usuarios_usuario_rol_id    ON usuarios(usuario_rol_id);
CREATE INDEX idx_usuarios_usuario_estado_id ON usuarios(usuario_estado_id);
CREATE INDEX idx_usuarios_institucion_id    ON usuarios(institucion_id);

COMMIT;
