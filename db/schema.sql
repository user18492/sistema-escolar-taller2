-- Esquema de la base de datos.
-- Lo ejecuta db/setup-db.ps1 (npm run db:setup) antes de seed.sql.
--
-- Convenciones:
--   - Claves primarias INT GENERATED ALWAYS AS IDENTITY: un INSERT no puede fijar el id.
--   - Todas las restricciones llevan nombre: pk_<tabla>, fk_<tabla>_<tabla referenciada>,
--     uq_<tabla>_<columnas>, ck_<tabla>_<regla>.
--   - Las reglas que dependen de otra tabla las validan triggers, porque un CHECK no puede
--     consultarla: trg_<tabla>_<regla>, con su función fn_<tabla>_<regla>. Fallan como un CHECK
--     (código 23514) e informan un nombre ck_<tabla>_<regla> como el de la restricción incumplida.

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

-- Cursos: una división de un grado, en un turno y un ciclo lectivo, dentro de una institución
CREATE TABLE curso (
    curso_id            INT         GENERATED ALWAYS AS IDENTITY,
    institucion_id      INT         NOT NULL,
    grado_id            INT         NOT NULL,
    division            VARCHAR(1)  NOT NULL,
    -- Una letra mayúscula: A, B, C...
    turno               VARCHAR(6)  NOT NULL,
    -- MAÑANA, TARDE
    anio_ciclo_lectivo  INT         NOT NULL,
    -- Solo el año: 2026
    fecha_eliminacion   TIMESTAMPTZ,
    -- NULL = vigente; con fecha = dado de baja (baja lógica): la fila se conserva, pero no se lista

    CONSTRAINT pk_curso PRIMARY KEY (curso_id),
    CONSTRAINT fk_curso_institucion FOREIGN KEY (institucion_id) REFERENCES institucion(institucion_id),
    CONSTRAINT fk_curso_grado FOREIGN KEY (grado_id) REFERENCES grado(grado_id),
    CONSTRAINT ck_curso_division CHECK (division ~ '^[A-Z]$'),
    CONSTRAINT ck_curso_turno CHECK (turno IN ('MAÑANA', 'TARDE')),
    CONSTRAINT ck_curso_anio_ciclo_lectivo CHECK (anio_ciclo_lectivo BETWEEN 2000 AND 2100)
);

-- Un curso vigente no se repite dentro de una institución: lo identifican estas columnas juntas.
-- Los dados de baja no cuentan, así que el mismo curso se puede volver a crear después de una
-- baja. Por eso es un índice único parcial y no una restricción UNIQUE, que no admite WHERE;
-- conserva el nombre uq_ porque cumple la misma función
CREATE UNIQUE INDEX uq_curso_institucion_grado_division_turno_anio_ciclo_lectivo
    ON curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
    WHERE fecha_eliminacion IS NULL;

-- institucion_id no necesita un índice propio: ya es la primera columna del índice único, que
-- abarca a los cursos vigentes, los únicos que se listan
CREATE INDEX idx_curso_grado_id ON curso(grado_id);

-- Asignaciones docentes: un profesor dicta en un curso una materia del plan de estudios de su grado
CREATE TABLE asignacion_docente (
    asignacion_docente_id  INT  GENERATED ALWAYS AS IDENTITY,
    usuario_id             INT  NOT NULL,
    -- El profesor
    curso_id               INT  NOT NULL,
    grado_materia_id       INT  NOT NULL,
    -- La materia, tomada del plan de estudios del grado del curso
    fecha_eliminacion      TIMESTAMPTZ,
    -- NULL = vigente; con fecha = dada de baja (baja lógica): la fila se conserva, pero deja de
    -- contar para las reglas de esta tabla

    CONSTRAINT pk_asignacion_docente PRIMARY KEY (asignacion_docente_id),
    CONSTRAINT fk_asignacion_docente_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(usuario_id),
    CONSTRAINT fk_asignacion_docente_curso FOREIGN KEY (curso_id) REFERENCES curso(curso_id),
    CONSTRAINT fk_asignacion_docente_grado_materia FOREIGN KEY (grado_materia_id) REFERENCES grado_materia(grado_materia_id)
);

-- Una materia de un curso tiene un solo profesor vigente. Con eso tampoco se repite una misma
-- asignación (profesor, curso y materia), y no hace falta la institución: el curso es de una sola.
-- Las dadas de baja no cuentan, así que la materia se puede volver a asignar después de una baja;
-- por eso es un índice único parcial, como el de curso
CREATE UNIQUE INDEX uq_asignacion_docente_curso_grado_materia
    ON asignacion_docente (curso_id, grado_materia_id)
    WHERE fecha_eliminacion IS NULL;

-- curso_id no necesita un índice propio: ya es la primera columna del índice único, que abarca a
-- las asignaciones vigentes
CREATE INDEX idx_asignacion_docente_usuario_id ON asignacion_docente(usuario_id);
CREATE INDEX idx_asignacion_docente_grado_materia_id ON asignacion_docente(grado_materia_id);

-- Coherencia de una asignación vigente con las filas que referencia: el usuario es un profesor, es
-- de la misma institución que el curso y la materia es del grado del curso. Las dadas de baja no se
-- validan. FOR SHARE retiene las filas del usuario y del curso hasta el fin de la transacción: un
-- cambio simultáneo de rol o de grado espera y, al seguir, su trigger (más abajo) ya ve esta
-- asignación. Si una fila referenciada no existe, las comparaciones dan NULL y no fallan: la
-- rechaza después su clave foránea
CREATE FUNCTION fn_asignacion_docente_coherencia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_usuario_rol_id          INT;
    v_usuario_institucion_id  INT;
    v_rol                     VARCHAR(50);
    v_curso_institucion_id    INT;
    v_curso_grado_id          INT;
    v_materia_grado_id        INT;
BEGIN
    -- Sin JOIN con usuario_rol: si la fila cambió mientras esperaba el bloqueo, PostgreSQL vuelve a
    -- evaluar la consulta con la fila nueva del usuario pero con el rol anterior, y no devolvería
    -- nada
    SELECT u.usuario_rol_id, u.institucion_id
      INTO v_usuario_rol_id, v_usuario_institucion_id
      FROM usuario u
     WHERE u.usuario_id = NEW.usuario_id
       FOR SHARE;

    SELECT r.nombre
      INTO v_rol
      FROM usuario_rol r
     WHERE r.usuario_rol_id = v_usuario_rol_id;

    SELECT c.institucion_id, c.grado_id
      INTO v_curso_institucion_id, v_curso_grado_id
      FROM curso c
     WHERE c.curso_id = NEW.curso_id
       FOR SHARE;

    SELECT gm.grado_id
      INTO v_materia_grado_id
      FROM grado_materia gm
     WHERE gm.grado_materia_id = NEW.grado_materia_id;

    IF v_rol <> 'PROFESOR' THEN
        RAISE EXCEPTION 'El usuario % no es un profesor', NEW.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_asignacion_docente_usuario_profesor';
    END IF;

    IF v_usuario_institucion_id <> v_curso_institucion_id THEN
        RAISE EXCEPTION 'El usuario % y el curso % son de instituciones distintas',
                        NEW.usuario_id, NEW.curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_asignacion_docente_misma_institucion';
    END IF;

    IF v_materia_grado_id <> v_curso_grado_id THEN
        RAISE EXCEPTION 'La materia de grado % no es del grado del curso %',
                        NEW.grado_materia_id, NEW.curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_asignacion_docente_materia_del_grado';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asignacion_docente_coherencia
    BEFORE INSERT OR UPDATE ON asignacion_docente
    FOR EACH ROW
    WHEN (NEW.fecha_eliminacion IS NULL)
    EXECUTE FUNCTION fn_asignacion_docente_coherencia();

-- Un curso con asignaciones vigentes conserva su grado y su institución: cambiarlos las dejaría
-- con materias de otro grado o con profesores de otra institución
CREATE FUNCTION fn_curso_asignaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM asignacion_docente a
                WHERE a.curso_id = OLD.curso_id
                  AND a.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'El curso % tiene asignaciones docentes vigentes', OLD.curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_curso_asignaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_curso_asignaciones_vigentes
    BEFORE UPDATE ON curso
    FOR EACH ROW
    WHEN (NEW.grado_id <> OLD.grado_id OR NEW.institucion_id <> OLD.institucion_id)
    EXECUTE FUNCTION fn_curso_asignaciones_vigentes();

-- Un usuario con asignaciones vigentes conserva su rol (que es PROFESOR) y su institución
CREATE FUNCTION fn_usuario_asignaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM asignacion_docente a
                WHERE a.usuario_id = OLD.usuario_id
                  AND a.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'El usuario % tiene asignaciones docentes vigentes', OLD.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_usuario_asignaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuario_asignaciones_vigentes
    BEFORE UPDATE ON usuario
    FOR EACH ROW
    WHEN (NEW.usuario_rol_id <> OLD.usuario_rol_id OR NEW.institucion_id <> OLD.institucion_id)
    EXECUTE FUNCTION fn_usuario_asignaciones_vigentes();

COMMIT;
