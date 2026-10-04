-- Esquema de la base de datos.
-- Lo ejecuta db/setup-db.ps1 (npm run db:setup) antes de seed.sql.
--
-- Convenciones:
--   - Claves primarias INT GENERATED ALWAYS AS IDENTITY: un INSERT no puede fijar el id.
--   - Todas las restricciones llevan nombre: pk_<tabla>, fk_<tabla>_<tabla referenciada>,
--     uq_<tabla>_<columnas>, ck_<tabla>_<regla>.

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
    -- true = Activo, false = Suspendido: no puede iniciar sesión, pero se sigue listando
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
    -- NULL = vigente; con fecha = dado de baja (baja lógica): se lista aparte, como eliminado, y no
    -- puede iniciar sesión.
    -- La fila se conserva con su dni y su email, así que la baja y la restauración son un UPDATE
    -- de esta columna y no un INSERT: las restricciones UNIQUE también cuentan a los dados de baja

    CONSTRAINT pk_usuario PRIMARY KEY (usuario_id),
    CONSTRAINT fk_usuario_institucion FOREIGN KEY (institucion_id) REFERENCES institucion(institucion_id),
    CONSTRAINT fk_usuario_usuario_rol FOREIGN KEY (usuario_rol_id) REFERENCES usuario_rol(usuario_rol_id),
    CONSTRAINT uq_usuario_institucion_dni UNIQUE (institucion_id, dni),
    CONSTRAINT uq_usuario_institucion_email UNIQUE (institucion_id, email),
    -- Todo dado de baja queda suspendido; un suspendido no necesariamente está dado de baja
    CONSTRAINT ck_usuario_baja_suspendido CHECK (fecha_eliminacion IS NULL OR estado = FALSE)
);

-- Indice porque sino no se hace solo. institucion_id no necesita uno propio: ya es la primera
-- columna de los índices de las restricciones UNIQUE
CREATE INDEX idx_usuario_usuario_rol_id ON usuario(usuario_rol_id);

-- Materias: catálogo global, común a todas las instituciones
CREATE TABLE materia (
    materia_id  INT           GENERATED ALWAYS AS IDENTITY,
    nombre      VARCHAR(100)  NOT NULL,

    CONSTRAINT pk_materia PRIMARY KEY (materia_id),
    CONSTRAINT uq_materia_nombre UNIQUE (nombre)
);

-- Grados: catálogo global, común a todas las instituciones. Un grado es el año de cursado dentro
-- de un nivel educativo, no una división concreta: eso es un curso
CREATE TABLE grado (
    grado_id         INT          GENERATED ALWAYS AS IDENTITY,
    nombre           VARCHAR(50)  NOT NULL,
    -- 1°, 2°, ... 6°
    nivel_educativo  VARCHAR(10)  NOT NULL,
    -- PRIMARIA, SECUNDARIA

    CONSTRAINT pk_grado PRIMARY KEY (grado_id),
    -- El nombre se repite entre niveles: hay un 1° de primaria y un 1° de secundaria
    CONSTRAINT uq_grado_nombre_nivel_educativo UNIQUE (nombre, nivel_educativo),
    CONSTRAINT ck_grado_nivel_educativo CHECK (nivel_educativo IN ('PRIMARIA', 'SECUNDARIA'))
);

-- Materias que se dictan en cada grado
CREATE TABLE grado_materia (
    grado_materia_id  INT  GENERATED ALWAYS AS IDENTITY,
    grado_id          INT  NOT NULL,
    materia_id        INT  NOT NULL,

    CONSTRAINT pk_grado_materia PRIMARY KEY (grado_materia_id),
    CONSTRAINT fk_grado_materia_grado FOREIGN KEY (grado_id) REFERENCES grado(grado_id),
    CONSTRAINT fk_grado_materia_materia FOREIGN KEY (materia_id) REFERENCES materia(materia_id),
    CONSTRAINT uq_grado_materia_grado_materia UNIQUE (grado_id, materia_id)
);

-- Igual que en usuario: grado_id ya es la primera columna del índice de la restricción UNIQUE
CREATE INDEX idx_grado_materia_materia_id ON grado_materia(materia_id);

COMMIT;
