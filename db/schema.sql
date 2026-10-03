-- Esquema de la base de datos.
-- Lo ejecuta db/setup-db.ps1 (npm run db:setup) antes de seed.sql.
--
-- Convenciones:
--   - Claves primarias INT GENERATED ALWAYS AS IDENTITY: un INSERT no puede fijar el id.
--   - Todas las restricciones llevan nombre: pk_<tabla>, fk_<tabla>_<tabla referenciada>,
--     uq_<tabla>_<columnas>.

BEGIN;

-- Instituciones
CREATE TABLE institucion (
    institucion_id    INT           GENERATED ALWAYS AS IDENTITY,
    nombre            VARCHAR(150),
    direccion_calle   VARCHAR(150),
    direccion_altura  VARCHAR(20),
    email             VARCHAR(254),
    telefono          VARCHAR(30),
    cuit              VARCHAR(13),
    -- Con guiones: XX-XXXXXXXX-X

    CONSTRAINT pk_institucion PRIMARY KEY (institucion_id)
);

-- Roles
CREATE TABLE usuario_rol (
    usuario_rol_id  INT          GENERATED ALWAYS AS IDENTITY,
    nombre          VARCHAR(50)  NOT NULL,
    -- ADMIN, SECRETARIO, PROFESOR

    CONSTRAINT pk_usuario_rol PRIMARY KEY (usuario_rol_id),
    CONSTRAINT uq_usuario_rol_nombre UNIQUE (nombre)
);

-- Usuarios: una fila por persona e institución. Quien pertenece a más de una institución tiene una
-- fila en cada una, con el mismo dni y el mismo email.
CREATE TABLE usuario (
    usuario_id         INT           GENERATED ALWAYS AS IDENTITY,
    institucion_id     INT           NOT NULL,
    usuario_rol_id     INT           NOT NULL,
    estado             BOOLEAN       NOT NULL DEFAULT TRUE,
    -- true = Activo, false = Suspendido
    nombre             VARCHAR(100)  NOT NULL,
    apellido           VARCHAR(100)  NOT NULL,
    dni                VARCHAR(8)    NOT NULL,
    -- Solo los dígitos (7 u 8)
    email              VARCHAR(254)  NOT NULL,
    fecha_nacimiento   DATE          NOT NULL,
    password_hash      VARCHAR(60)   NOT NULL,
    -- Hash bcrypt: siempre 60 caracteres
    imagen_url         VARCHAR(255),
    fecha_eliminacion  TIMESTAMPTZ,
    -- NULL = vigente; con fecha = dado de baja (baja lógica): no se lista ni puede iniciar sesión.
    -- La fila se conserva con su dni y su email, así que la baja y la reactivación son un UPDATE
    -- de esta columna y no un INSERT: las restricciones UNIQUE también cuentan a los dados de baja

    CONSTRAINT pk_usuario PRIMARY KEY (usuario_id),
    CONSTRAINT fk_usuario_institucion FOREIGN KEY (institucion_id) REFERENCES institucion(institucion_id),
    CONSTRAINT fk_usuario_usuario_rol FOREIGN KEY (usuario_rol_id) REFERENCES usuario_rol(usuario_rol_id),
    CONSTRAINT uq_usuario_institucion_dni UNIQUE (institucion_id, dni),
    CONSTRAINT uq_usuario_institucion_email UNIQUE (institucion_id, email)
);

-- Indice porque sino no se hace solo. institucion_id no necesita uno propio: ya es la primera
-- columna de los índices de las restricciones UNIQUE
CREATE INDEX idx_usuario_usuario_rol_id ON usuario(usuario_rol_id);

COMMIT;
