-- Esquema de la base de datos.
-- Lo ejecuta db/setup-db.ps1 (npm run db:setup) antes de seed.sql.
--
-- Convenciones:
--   - Claves primarias INT GENERATED ALWAYS AS IDENTITY: un INSERT no puede fijar el id.
--   - Todas las restricciones llevan nombre: pk_<tabla>, fk_<tabla>_<tabla referenciada>,
--     uq_<tabla>_<columnas>, ck_<tabla>_<regla>.
--   - Las reglas que dependen de otra tabla, o del valor anterior de la fila, las validan triggers,
--     porque un CHECK no puede consultarlos: trg_<tabla>_<regla>, con su función
--     fn_<tabla>_<regla>. Fallan como un CHECK (código 23514) e informan un nombre
--     ck_<tabla>_<regla> como el de la restricción incumplida.
--   - Los procedimientos almacenados se llaman sp_<tabla>_<acción>. Sus errores previstos usan los
--     códigos de condición de PostgreSQL que correspondan, y cada uno documenta los suyos.
--   - La fecha actual sale siempre de fn_fecha_actual() (más abajo), nunca de CURRENT_DATE: es la
--     única fuente de la fecha y del ciclo lectivo actuales.

BEGIN;

-- Fecha y ciclo lectivo actuales.
-- El ciclo lectivo actual es el año calendario en curso, de enero a diciembre; los anteriores están
-- cerrados (solo lectura) y los posteriores son futuros (todavía no existen). Las reglas que dependen
-- del ciclo lectivo usan estas funciones, y no CURRENT_DATE, para que la fecha tenga una sola fuente

-- La fecha actual. Su firma no cambia: sin parámetros, DATE, LANGUAGE sql y STABLE, porque la suite de
-- pruebas la reemplaza con CREATE OR REPLACE para congelar la fecha en sus bases (tests/lib/clock.js)
CREATE FUNCTION fn_fecha_actual() RETURNS DATE
LANGUAGE sql STABLE AS $$
    SELECT CURRENT_DATE
$$;

-- El año del ciclo lectivo actual: el de la fecha actual
CREATE FUNCTION fn_anio_ciclo_lectivo_actual() RETURNS INT
LANGUAGE sql STABLE AS $$
    SELECT EXTRACT(YEAR FROM fn_fecha_actual())::INT
$$;

-- Estado del ciclo lectivo p_anio respecto del actual: 'CERRADO' (anterior), 'ACTUAL' o 'FUTURO'
-- (posterior). Es STRICT: con un año NULL devuelve NULL, sin evaluar nada. Así, en los triggers, una
-- fila referenciada que no existe no se rechaza acá, sino después, por su clave foránea
CREATE FUNCTION fn_ciclo_lectivo_estado(p_anio INT) RETURNS TEXT
LANGUAGE sql STABLE STRICT AS $$
    SELECT CASE
               WHEN p_anio < fn_anio_ciclo_lectivo_actual() THEN 'CERRADO'
               WHEN p_anio > fn_anio_ciclo_lectivo_actual() THEN 'FUTURO'
               ELSE 'ACTUAL'
           END
$$;

-- Instituciones
CREATE TABLE institucion (
    institucion_id    INT           GENERATED ALWAYS AS IDENTITY,
    nombre            VARCHAR(150)  NOT NULL,
    direccion_calle   VARCHAR(150)  NOT NULL,
    direccion_altura  VARCHAR(20)   NOT NULL,
    email             VARCHAR(254)  NOT NULL,
    telefono          VARCHAR(13)   NOT NULL,
    -- Solo los dígitos (10 a 13), sin espacios, guiones ni +
    cuit              VARCHAR(13)   NOT NULL,
    -- Con guiones: XX-XXXXXXXX-X

    CONSTRAINT pk_institucion PRIMARY KEY (institucion_id),
    CONSTRAINT uq_institucion_cuit UNIQUE (cuit),
    CONSTRAINT ck_institucion_nombre CHECK (nombre = btrim(nombre) AND nombre <> ''),
    CONSTRAINT ck_institucion_direccion_calle CHECK (direccion_calle = btrim(direccion_calle) AND direccion_calle <> ''),
    CONSTRAINT ck_institucion_direccion_altura CHECK (direccion_altura = btrim(direccion_altura) AND direccion_altura <> ''),
    -- Mismo formato que ck_usuario_email, sin exigir minúsculas: el email de la institución no se
    -- usa para buscarla
    CONSTRAINT ck_institucion_email CHECK (email = btrim(email) AND email <> '' AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    CONSTRAINT ck_institucion_cuit CHECK (cuit ~ '^[0-9]{2}-[0-9]{8}-[0-9]$'),
    CONSTRAINT ck_institucion_telefono CHECK (telefono ~ '^[0-9]{10,13}$')
);

-- Roles
CREATE TABLE usuario_rol (
    usuario_rol_id  INT          GENERATED ALWAYS AS IDENTITY,
    nombre          VARCHAR(50)  NOT NULL,
    -- ADMIN, SECRETARIO, PROFESOR

    CONSTRAINT pk_usuario_rol PRIMARY KEY (usuario_rol_id),
    CONSTRAINT uq_usuario_rol_nombre UNIQUE (nombre),
    CONSTRAINT ck_usuario_rol_nombre CHECK (nombre IN ('ADMIN', 'SECRETARIO', 'PROFESOR'))
);

-- Usuarios: una fila por cuenta, y una cuenta es de una persona en una institución con un rol.
-- Quien pertenece a más de una institución, o tiene más de un rol en una misma, tiene una fila por
-- cada una, con el mismo dni y el mismo email.
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
    -- de esta columna y no un INSERT. Los dados de baja no cuentan para la unicidad (más abajo)

    CONSTRAINT pk_usuario PRIMARY KEY (usuario_id),
    CONSTRAINT fk_usuario_institucion FOREIGN KEY (institucion_id) REFERENCES institucion(institucion_id),
    CONSTRAINT fk_usuario_usuario_rol FOREIGN KEY (usuario_rol_id) REFERENCES usuario_rol(usuario_rol_id),
    -- Todo dado de baja queda suspendido; un suspendido no necesariamente está dado de baja
    CONSTRAINT ck_usuario_baja_suspendido CHECK (fecha_eliminacion IS NULL OR estado = FALSE),
    -- Formato de los datos, como los deja el formulario de usuarios. La edad (18 a 80 años) no se
    -- valida acá: depende de la fecha actual
    CONSTRAINT ck_usuario_nombre CHECK (nombre = btrim(nombre) AND nombre <> ''),
    CONSTRAINT ck_usuario_apellido CHECK (apellido = btrim(apellido) AND apellido <> ''),
    CONSTRAINT ck_usuario_dni CHECK (dni ~ '^[1-9][0-9]{6,7}$'),
    -- En minúsculas: el login busca la cuenta por el email en minúsculas, y así la unicidad no
    -- distingue mayúsculas
    CONSTRAINT ck_usuario_email CHECK (email = LOWER(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    CONSTRAINT ck_usuario_password_hash CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$')
);

-- El dni y el email de un usuario vigente no se repiten dentro de una institución y un rol: una
-- persona puede tener una cuenta por rol y por institución, pero no dos iguales. Los dados de baja
-- no cuentan, así que la cuenta se puede volver a crear después de una baja; por eso son índices
-- únicos parciales y no restricciones UNIQUE, que no admiten WHERE. Conservan el nombre uq_ porque
-- cumplen la misma función. Restaurar a un dado de baja lo vuelve a contar: falla si ya hay un
-- vigente con su dni o su email y su rol
CREATE UNIQUE INDEX uq_usuario_institucion_usuario_rol_dni
    ON usuario (institucion_id, usuario_rol_id, dni)
    WHERE fecha_eliminacion IS NULL;

CREATE UNIQUE INDEX uq_usuario_institucion_usuario_rol_email
    ON usuario (institucion_id, usuario_rol_id, email)
    WHERE fecha_eliminacion IS NULL;

-- Indice porque sino no se hace solo. institucion_id también necesita uno propio: los índices
-- únicos son parciales y no sirven para listar a los dados de baja
CREATE INDEX idx_usuario_usuario_rol_id ON usuario(usuario_rol_id);
CREATE INDEX idx_usuario_institucion_id ON usuario(institucion_id);

-- El rol y la institución de un usuario no cambian después del alta: una cuenta tiene un solo rol
-- y es de una sola institución. Así, lo que referencia al usuario (sus asignaciones docentes,
-- vigentes o dadas de baja) no queda apuntando a otro rol, y el rol que guarda una sesión abierta
-- no queda viejo. Un rol mal cargado se corrige dando de baja la cuenta y creando otra
CREATE FUNCTION fn_usuario_rol_institucion_inmutables() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.usuario_rol_id <> OLD.usuario_rol_id THEN
        RAISE EXCEPTION 'El rol del usuario % no se puede cambiar', OLD.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_usuario_rol_inmutable';
    END IF;

    IF NEW.institucion_id <> OLD.institucion_id THEN
        RAISE EXCEPTION 'La institución del usuario % no se puede cambiar', OLD.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_usuario_institucion_inmutable';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuario_rol_institucion_inmutables
    BEFORE UPDATE ON usuario
    FOR EACH ROW
    WHEN (NEW.usuario_rol_id <> OLD.usuario_rol_id OR NEW.institucion_id <> OLD.institucion_id)
    EXECUTE FUNCTION fn_usuario_rol_institucion_inmutables();

-- Una institución no se queda sin administradores habilitados (activos y vigentes): el último no
-- se suspende ni se da de baja. FOR NO KEY UPDATE retiene la fila de la institución hasta el fin
-- de la transacción: si dos administradores se deshabilitan entre sí a la vez, el segundo espera
-- y, al seguir, ya no cuenta al primero
CREATE FUNCTION fn_usuario_ultimo_administrador() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_rol  VARCHAR(50);
BEGIN
    SELECT r.nombre
      INTO v_rol
      FROM usuario_rol r
     WHERE r.usuario_rol_id = OLD.usuario_rol_id;

    IF v_rol <> 'ADMIN' THEN
        RETURN NEW;
    END IF;

    PERFORM 1
       FROM institucion i
      WHERE i.institucion_id = OLD.institucion_id
        FOR NO KEY UPDATE;

    IF NOT EXISTS (SELECT 1
                     FROM usuario u
                    WHERE u.institucion_id = OLD.institucion_id
                      AND u.usuario_rol_id = OLD.usuario_rol_id
                      AND u.usuario_id <> OLD.usuario_id
                      AND u.estado
                      AND u.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'El usuario % es el único administrador habilitado de su institución', OLD.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_usuario_ultimo_administrador';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuario_ultimo_administrador
    BEFORE UPDATE ON usuario
    FOR EACH ROW
    WHEN (OLD.estado AND OLD.fecha_eliminacion IS NULL
          AND (NOT NEW.estado OR NEW.fecha_eliminacion IS NOT NULL))
    EXECUTE FUNCTION fn_usuario_ultimo_administrador();

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

-- grado_id no necesita un índice propio: ya es la primera columna del índice de la restricción
-- UNIQUE
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

-- Un curso solo se crea, se edita o se da de baja en el ciclo lectivo actual: los de un ciclo
-- cerrado quedan en solo lectura, como historial, y en un ciclo futuro todavía no se carga nada. La
-- misma regla, con su propio trigger, rige para las asignaciones docentes, las inscripciones, las
-- evaluaciones y las calificaciones, cada una con el ciclo lectivo de su curso.
-- En un UPDATE se controla primero el ciclo que tenía la fila y después el ciclo al que pasa: nada se
-- mueve desde un ciclo cerrado ni hacia uno. Por eso el ciclo lectivo de un curso ya no cambia, y los
-- triggers de las demás tablas no necesitan retener el curso para leerlo. La baja lógica también es
-- un UPDATE: el trigger no lleva WHEN
CREATE FUNCTION fn_curso_ciclo_lectivo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_anios   INT[] := ARRAY[NEW.anio_ciclo_lectivo];
    v_anio    INT;
    v_estado  TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_anios := OLD.anio_ciclo_lectivo || v_anios;
    END IF;

    FOREACH v_anio IN ARRAY v_anios LOOP
        v_estado := fn_ciclo_lectivo_estado(v_anio);

        IF v_estado = 'CERRADO' THEN
            RAISE EXCEPTION 'El curso % es del ciclo lectivo %, que está cerrado', NEW.curso_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_curso_ciclo_lectivo_cerrado';
        END IF;

        IF v_estado = 'FUTURO' THEN
            RAISE EXCEPTION 'El curso % es del ciclo lectivo %, que todavía no empezó', NEW.curso_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_curso_ciclo_lectivo_futuro';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_curso_ciclo_lectivo
    BEFORE INSERT OR UPDATE ON curso
    FOR EACH ROW
    EXECUTE FUNCTION fn_curso_ciclo_lectivo();

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

-- Una asignación docente solo se crea, se edita o se da de baja en el ciclo lectivo actual: el de su
-- curso, como en trg_curso_ciclo_lectivo. En un cambio de curso se controla primero el que tenía y
-- después el nuevo. Si el curso no existe, su año queda en NULL y no falla: la rechaza después su
-- clave foránea
CREATE FUNCTION fn_asignacion_docente_ciclo_lectivo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cursos    INT[] := ARRAY[NEW.curso_id];
    v_curso_id  INT;
    v_anio      INT;
    v_estado    TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_cursos := OLD.curso_id || v_cursos;
    END IF;

    FOREACH v_curso_id IN ARRAY v_cursos LOOP
        SELECT c.anio_ciclo_lectivo
          INTO v_anio
          FROM curso c
         WHERE c.curso_id = v_curso_id;

        v_estado := fn_ciclo_lectivo_estado(v_anio);

        IF v_estado = 'CERRADO' THEN
            RAISE EXCEPTION 'El curso % de la asignación docente % es del ciclo lectivo %, que está cerrado',
                            v_curso_id, NEW.asignacion_docente_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_asignacion_docente_ciclo_lectivo_cerrado';
        END IF;

        IF v_estado = 'FUTURO' THEN
            RAISE EXCEPTION 'El curso % de la asignación docente % es del ciclo lectivo %, que todavía no empezó',
                            v_curso_id, NEW.asignacion_docente_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_asignacion_docente_ciclo_lectivo_futuro';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asignacion_docente_ciclo_lectivo
    BEFORE INSERT OR UPDATE ON asignacion_docente
    FOR EACH ROW
    EXECUTE FUNCTION fn_asignacion_docente_ciclo_lectivo();

-- Coherencia de una asignación vigente con las filas que referencia: el usuario es un profesor
-- activo y vigente, es de la misma institución que el curso y la materia es del grado del curso.
-- Rige en toda alta o edición que deja la asignación vigente, aunque no cambie el profesor: la de
-- un profesor suspendido no se edita sin reemplazarlo. Las dadas de baja no se validan, así que la
-- de un suspendido sí se puede dar de baja. Las de un ciclo lectivo cerrado no llegan hasta acá:
-- trg_asignacion_docente_ciclo_lectivo dispara antes (orden alfabético) y las rechaza, así que
-- conservan su profesor. FOR SHARE retiene las filas del usuario y del curso hasta el fin de la
-- transacción: una suspensión o una baja simultánea del usuario o un cambio simultáneo de grado
-- esperan y, al seguir, el trigger de la baja o del grado (más abajo) ya ve esta asignación; si la
-- suspensión o la baja llegaron antes, este control las espera y lee la fila como quedó. Si una
-- fila referenciada no existe, las comparaciones dan NULL y no fallan: la rechaza después su clave
-- foránea
CREATE FUNCTION fn_asignacion_docente_coherencia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_usuario_rol_id             INT;
    v_usuario_institucion_id     INT;
    v_usuario_estado             BOOLEAN;
    v_usuario_fecha_eliminacion  TIMESTAMPTZ;
    v_rol                        VARCHAR(50);
    v_curso_institucion_id       INT;
    v_curso_grado_id             INT;
    v_materia_grado_id           INT;
BEGIN
    -- Sin JOIN con usuario_rol: si la fila cambia mientras espera el bloqueo, PostgreSQL vuelve a
    -- evaluar la consulta con la fila nueva del usuario pero con las filas anteriores de las demás
    -- tablas, y no devolvería nada si ya no coinciden. El rol es inmutable, así que acá lo que
    -- puede cambiar durante la espera es el estado o la fecha de baja, que se leen de la fila nueva
    SELECT u.usuario_rol_id, u.institucion_id, u.estado, u.fecha_eliminacion
      INTO v_usuario_rol_id, v_usuario_institucion_id, v_usuario_estado, v_usuario_fecha_eliminacion
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

    IF v_usuario_fecha_eliminacion IS NOT NULL THEN
        RAISE EXCEPTION 'El usuario % está dado de baja', NEW.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_asignacion_docente_usuario_vigente';
    END IF;

    -- Un dado de baja también está suspendido (ck_usuario_baja_suspendido): conserva el error de
    -- arriba
    IF NOT v_usuario_estado THEN
        RAISE EXCEPTION 'El usuario % está suspendido', NEW.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_asignacion_docente_usuario_activo';
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

-- Un usuario con asignaciones vigentes del ciclo lectivo actual no se da de baja: quedarían a nombre
-- de un eliminado, con sus materias ocupadas y sin nadie que cargue sus evaluaciones y sus notas.
-- Antes hay que reasignarlas o darlas de baja. Es el equivalente de la clave foránea para la baja
-- lógica. Solo cuenta el ciclo actual (de uno futuro no hay asignaciones): las de un ciclo cerrado
-- ya no se editan ni se dan de baja (trg_asignacion_docente_ciclo_lectivo), así que quedan en el
-- histórico con el profesor eliminado. Suspenderlo sí se puede: sus asignaciones lo esperan, pero
-- no se editan sin reemplazarlo (trg_asignacion_docente_coherencia)
CREATE FUNCTION fn_usuario_asignaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM asignacion_docente a
                 JOIN curso c ON c.curso_id = a.curso_id
                WHERE a.usuario_id = OLD.usuario_id
                  AND a.fecha_eliminacion IS NULL
                  AND fn_ciclo_lectivo_estado(c.anio_ciclo_lectivo) <> 'CERRADO') THEN
        RAISE EXCEPTION 'El usuario % tiene asignaciones docentes vigentes en el ciclo lectivo actual', OLD.usuario_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_usuario_asignaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuario_asignaciones_vigentes
    BEFORE UPDATE ON usuario
    FOR EACH ROW
    WHEN (OLD.fecha_eliminacion IS NULL AND NEW.fecha_eliminacion IS NOT NULL)
    EXECUTE FUNCTION fn_usuario_asignaciones_vigentes();

-- Estados de alumno. No intervienen en las calificaciones: si al alumno se lo puede calificar en un
-- curso, y si esas notas cuentan para el promedio, depende solo del estado de su inscripción
CREATE TABLE alumno_estado (
    alumno_estado_id  INT          GENERATED ALWAYS AS IDENTITY,
    nombre            VARCHAR(50)  NOT NULL,
    -- ACTIVO, EGRESADO

    CONSTRAINT pk_alumno_estado PRIMARY KEY (alumno_estado_id),
    CONSTRAINT uq_alumno_estado_nombre UNIQUE (nombre),
    CONSTRAINT ck_alumno_estado_nombre CHECK (nombre IN ('ACTIVO', 'EGRESADO'))
);

-- Alumnos: una fila por persona e institución. Quien pasa a otra institución tiene una fila en
-- cada una, con su propio estado.
-- La institución no se deduce de las inscripciones: el alumno se registra antes de inscribirse en
-- un curso, y durante ese lapso no tiene ninguna.
-- La baja lógica (fecha_eliminacion) la hace sp_alumno_dar_de_baja (más abajo), que también cancela
-- sus inscripciones activas, sin darlas de baja. Ninguna otra regla la tiene en cuenta todavía: un
-- alumno dado de baja sigue contando para todas, también para la unicidad de dni y email
CREATE TABLE alumno (
    alumno_id          INT           GENERATED ALWAYS AS IDENTITY,
    institucion_id     INT           NOT NULL,
    alumno_estado_id   INT           NOT NULL,
    nombre             VARCHAR(100)  NOT NULL,
    apellido           VARCHAR(100)  NOT NULL,
    email              VARCHAR(254)  NOT NULL,
    telefono           VARCHAR(13)   NOT NULL,
    -- Solo los dígitos (10 a 13), sin espacios, guiones ni +
    direccion_calle    VARCHAR(150)  NOT NULL,
    direccion_altura   VARCHAR(20)   NOT NULL,
    dni                VARCHAR(8)    NOT NULL,
    -- Solo los dígitos (7 u 8)
    fecha_nacimiento   DATE          NOT NULL,
    fecha_eliminacion  TIMESTAMPTZ,
    -- NULL = vigente; con fecha = dado de baja (baja lógica): la fila se conserva

    CONSTRAINT pk_alumno PRIMARY KEY (alumno_id),
    CONSTRAINT fk_alumno_institucion FOREIGN KEY (institucion_id) REFERENCES institucion(institucion_id),
    CONSTRAINT fk_alumno_alumno_estado FOREIGN KEY (alumno_estado_id) REFERENCES alumno_estado(alumno_estado_id),
    CONSTRAINT uq_alumno_institucion_dni UNIQUE (institucion_id, dni),
    CONSTRAINT uq_alumno_institucion_email UNIQUE (institucion_id, email),
    CONSTRAINT ck_alumno_telefono CHECK (telefono ~ '^[0-9]{10,13}$')
);

-- institucion_id no necesita un índice propio: ya es la primera columna de los índices de las
-- restricciones UNIQUE
CREATE INDEX idx_alumno_alumno_estado_id ON alumno(alumno_estado_id);

-- Estados de inscripción. Cada uno dice si al alumno se lo puede calificar en el curso y si sus
-- calificaciones cuentan para el promedio:
--   - ACTIVA: cursa el curso. Se califica y cuenta para el promedio.
--   - FINALIZADA: terminó el cursado. Solo lectura, y cuenta para el promedio.
--   - CANCELADA: dejó de cursar, porque abandonó o porque se cambió a otro curso. Solo lectura, y
--     no cuenta para el promedio.
-- Un cambio de curso cancela la inscripción actual y crea otra, activa, en el curso destino.
-- La base hace cumplir la primera regla: trg_calificacion_coherencia (más abajo) solo acepta
-- cargar, corregir o dar de baja calificaciones de inscripciones activas, y además vigentes (sin
-- baja lógica). La segunda la aplican las consultas que calculan promedios
CREATE TABLE inscripcion_estado (
    inscripcion_estado_id  INT          GENERATED ALWAYS AS IDENTITY,
    nombre                 VARCHAR(50)  NOT NULL,
    -- ACTIVA, FINALIZADA, CANCELADA

    CONSTRAINT pk_inscripcion_estado PRIMARY KEY (inscripcion_estado_id),
    CONSTRAINT uq_inscripcion_estado_nombre UNIQUE (nombre),
    CONSTRAINT ck_inscripcion_estado_nombre CHECK (nombre IN ('ACTIVA', 'FINALIZADA', 'CANCELADA'))
);

-- Inscripciones: un alumno cursa un curso. A lo largo del tiempo, un alumno pasa por muchos cursos
-- y un curso tiene muchos alumnos.
-- Lo que cambia a lo largo de su vida es su estado. La baja lógica (fecha_eliminacion) la hace el
-- Secretario desde el listado de inscripciones, sin cambiar el estado ni el resto de la fila. La
-- baja de un alumno (sp_alumno_dar_de_baja, más abajo) no la hace: pasa sus inscripciones activas a
-- CANCELADA, pero no las da de baja, para conservar todo su historial. El cierre del ciclo lectivo
-- (sp_inscripcion_finalizar_ciclos_cerrados, más abajo) pasa a FINALIZADA las activas de los ciclos
-- cerrados.
-- La baja lógica solo la tienen en cuenta la regla de una sola inscripción activa por alumno
-- (trg_inscripcion_coherencia), para la que una inscripción dada de baja no cuenta como activa;
-- sp_alumno_dar_de_baja y sp_inscripcion_finalizar_ciclos_cerrados, que solo cancelan o finalizan
-- las vigentes; la excepción de trg_inscripcion_ciclo_lectivo, que solo deja finalizar las vigentes,
-- y trg_calificacion_coherencia, que no acepta cargar, corregir ni dar de baja calificaciones de una
-- inscripción dada de baja, aunque siga activa. Para las demás reglas, una inscripción dada de baja
-- sigue contando
CREATE TABLE inscripcion (
    inscripcion_id         INT   GENERATED ALWAYS AS IDENTITY,
    alumno_id              INT   NOT NULL,
    curso_id               INT   NOT NULL,
    inscripcion_estado_id  INT   NOT NULL,
    fecha_inscripcion      DATE  NOT NULL DEFAULT fn_fecha_actual(),
    -- Por defecto, la fecha actual. Su año es el ciclo lectivo del curso
    fecha_eliminacion      TIMESTAMPTZ,
    -- NULL = vigente; con fecha = dada de baja (baja lógica): la fila se conserva

    CONSTRAINT pk_inscripcion PRIMARY KEY (inscripcion_id),
    CONSTRAINT fk_inscripcion_alumno FOREIGN KEY (alumno_id) REFERENCES alumno(alumno_id),
    CONSTRAINT fk_inscripcion_curso FOREIGN KEY (curso_id) REFERENCES curso(curso_id),
    CONSTRAINT fk_inscripcion_inscripcion_estado FOREIGN KEY (inscripcion_estado_id) REFERENCES inscripcion_estado(inscripcion_estado_id)
);

-- Ninguna restricción UNIQUE abarca estas columnas, así que cada una lleva su índice
CREATE INDEX idx_inscripcion_alumno_id ON inscripcion(alumno_id);
CREATE INDEX idx_inscripcion_curso_id ON inscripcion(curso_id);
CREATE INDEX idx_inscripcion_inscripcion_estado_id ON inscripcion(inscripcion_estado_id);

-- Una inscripción solo se crea, se edita o se da de baja en el ciclo lectivo actual: el de su curso,
-- como en trg_curso_ciclo_lectivo. En un cambio de curso se controla primero el que tenía y después
-- el nuevo. Si el curso no existe, su año queda en NULL y no falla: la rechaza después su clave
-- foránea.
-- Excepción: en un ciclo cerrado se acepta pasar una inscripción vigente de ACTIVA a FINALIZADA sin
-- cambiar nada más (ni el alumno, ni el curso, ni la fecha, ni la baja lógica). Es la única
-- modificación que admite un ciclo cerrado, y la hace el cierre del ciclo
-- (sp_inscripcion_finalizar_ciclos_cerrados, más abajo): sin ella, las activas de un ciclo cerrado
-- quedarían activas para siempre y sus alumnos no podrían inscribirse en el ciclo siguiente
CREATE FUNCTION fn_inscripcion_ciclo_lectivo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cursos           INT[] := ARRAY[NEW.curso_id];
    v_curso_id         INT;
    v_anio             INT;
    v_estado           TEXT;
    v_estado_anterior  VARCHAR(50);
    v_estado_nuevo     VARCHAR(50);
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT e.nombre
          INTO v_estado_anterior
          FROM inscripcion_estado e
         WHERE e.inscripcion_estado_id = OLD.inscripcion_estado_id;

        SELECT e.nombre
          INTO v_estado_nuevo
          FROM inscripcion_estado e
         WHERE e.inscripcion_estado_id = NEW.inscripcion_estado_id;

        SELECT c.anio_ciclo_lectivo
          INTO v_anio
          FROM curso c
         WHERE c.curso_id = OLD.curso_id;

        IF fn_ciclo_lectivo_estado(v_anio) = 'CERRADO'
           AND v_estado_anterior = 'ACTIVA'
           AND v_estado_nuevo = 'FINALIZADA'
           AND NEW.alumno_id = OLD.alumno_id
           AND NEW.curso_id = OLD.curso_id
           AND NEW.fecha_inscripcion = OLD.fecha_inscripcion
           AND OLD.fecha_eliminacion IS NULL
           AND NEW.fecha_eliminacion IS NULL THEN
            RETURN NEW;
        END IF;

        v_cursos := OLD.curso_id || v_cursos;
    END IF;

    FOREACH v_curso_id IN ARRAY v_cursos LOOP
        SELECT c.anio_ciclo_lectivo
          INTO v_anio
          FROM curso c
         WHERE c.curso_id = v_curso_id;

        v_estado := fn_ciclo_lectivo_estado(v_anio);

        IF v_estado = 'CERRADO' THEN
            RAISE EXCEPTION 'El curso % de la inscripción % es del ciclo lectivo %, que está cerrado',
                            v_curso_id, NEW.inscripcion_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_inscripcion_ciclo_lectivo_cerrado';
        END IF;

        IF v_estado = 'FUTURO' THEN
            RAISE EXCEPTION 'El curso % de la inscripción % es del ciclo lectivo %, que todavía no empezó',
                            v_curso_id, NEW.inscripcion_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_inscripcion_ciclo_lectivo_futuro';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inscripcion_ciclo_lectivo
    BEFORE INSERT OR UPDATE ON inscripcion
    FOR EACH ROW
    EXECUTE FUNCTION fn_inscripcion_ciclo_lectivo();

-- Coherencia de una inscripción con las filas que referencia: el alumno y el curso son de la misma
-- institución y, si la inscripción es activa y vigente (sin baja lógica), el alumno no tiene otra
-- activa y vigente. Las demás no cuentan: un alumno puede tener cualquier cantidad de canceladas y
-- finalizadas, y de inscripciones dadas de baja en cualquier estado, también activas (la baja no
-- cambia el estado). Por eso un cambio de curso primero pasa la inscripción actual a CANCELADA y
-- después crea la nueva, y un alumno cuya inscripción activa se dio de baja se puede volver a
-- inscribir. Si a una inscripción activa se le quita la baja, vuelve a contar y se valida igual.
-- "Activa" es una fila de inscripcion_estado y no un valor fijo, así que un índice único parcial no
-- puede expresar la regla. En su lugar, FOR NO KEY UPDATE retiene la fila del alumno hasta el fin
-- de la transacción: otra inscripción simultánea del mismo alumno espera y, al seguir, ya ve esta.
-- La baja lógica de una inscripción es un UPDATE y también pasa por acá, así que retiene al alumno:
-- una inscripción simultánea espera a que termine y, al seguir, ya no cuenta la dada de baja.
-- También espera un cambio simultáneo de institución del alumno o del curso (retenido con
-- FOR SHARE), cuyos triggers están más abajo. Si una fila referenciada no existe, las comparaciones
-- dan NULL y no fallan: la rechaza después su clave foránea
CREATE FUNCTION fn_inscripcion_coherencia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_alumno_institucion_id  INT;
    v_curso_institucion_id   INT;
    v_estado                 VARCHAR(50);
BEGIN
    SELECT a.institucion_id
      INTO v_alumno_institucion_id
      FROM alumno a
     WHERE a.alumno_id = NEW.alumno_id
       FOR NO KEY UPDATE;

    SELECT c.institucion_id
      INTO v_curso_institucion_id
      FROM curso c
     WHERE c.curso_id = NEW.curso_id
       FOR SHARE;

    SELECT e.nombre
      INTO v_estado
      FROM inscripcion_estado e
     WHERE e.inscripcion_estado_id = NEW.inscripcion_estado_id;

    IF v_alumno_institucion_id <> v_curso_institucion_id THEN
        RAISE EXCEPTION 'El alumno % y el curso % son de instituciones distintas',
                        NEW.alumno_id, NEW.curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_inscripcion_misma_institucion';
    END IF;

    IF v_estado = 'ACTIVA'
       AND NEW.fecha_eliminacion IS NULL
       AND EXISTS (SELECT 1
                     FROM inscripcion i
                     JOIN inscripcion_estado e ON e.inscripcion_estado_id = i.inscripcion_estado_id
                    WHERE i.alumno_id = NEW.alumno_id
                      AND i.inscripcion_id <> NEW.inscripcion_id
                      AND i.fecha_eliminacion IS NULL
                      AND e.nombre = 'ACTIVA') THEN
        RAISE EXCEPTION 'El alumno % ya tiene una inscripción activa', NEW.alumno_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_inscripcion_alumno_una_activa';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inscripcion_coherencia
    BEFORE INSERT OR UPDATE ON inscripcion
    FOR EACH ROW
    EXECUTE FUNCTION fn_inscripcion_coherencia();

-- El año de la fecha de una inscripción es el ciclo lectivo de su curso: las inscripciones se hacen
-- durante ese año, a partir de enero. Se validan todas, cualquiera sea su estado. FOR SHARE retiene
-- la fila del curso hasta el fin de la transacción: un cambio simultáneo de ciclo lectivo espera y,
-- al seguir, su trigger (más abajo) ya ve esta inscripción. Si el curso no existe, la comparación
-- da NULL y no falla: la rechaza después su clave foránea
CREATE FUNCTION fn_inscripcion_fecha_ciclo_lectivo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_anio_ciclo_lectivo  INT;
BEGIN
    SELECT c.anio_ciclo_lectivo
      INTO v_anio_ciclo_lectivo
      FROM curso c
     WHERE c.curso_id = NEW.curso_id
       FOR SHARE;

    IF EXTRACT(YEAR FROM NEW.fecha_inscripcion) <> v_anio_ciclo_lectivo THEN
        RAISE EXCEPTION 'La fecha % no es del ciclo lectivo % del curso %',
                        NEW.fecha_inscripcion, v_anio_ciclo_lectivo, NEW.curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_inscripcion_fecha_ciclo_lectivo';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inscripcion_fecha_ciclo_lectivo
    BEFORE INSERT OR UPDATE ON inscripcion
    FOR EACH ROW
    EXECUTE FUNCTION fn_inscripcion_fecha_ciclo_lectivo();

-- Un alumno con inscripciones conserva su institución: cambiarla lo dejaría en cursos de otra.
-- Cuentan todas, no solo las activas: las demás, también las dadas de baja, siguen siendo su
-- historial
CREATE FUNCTION fn_alumno_inscripciones() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM inscripcion i
                WHERE i.alumno_id = OLD.alumno_id) THEN
        RAISE EXCEPTION 'El alumno % tiene inscripciones', OLD.alumno_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_alumno_inscripciones';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alumno_inscripciones
    BEFORE UPDATE ON alumno
    FOR EACH ROW
    WHEN (NEW.institucion_id <> OLD.institucion_id)
    EXECUTE FUNCTION fn_alumno_inscripciones();

-- Un curso con inscripciones conserva su institución y su ciclo lectivo: las fechas de sus
-- inscripciones son de ese año. El grado sí puede cambiar: la inscripción no depende de él.
-- Un cambio de ciclo lectivo ya lo rechaza antes trg_curso_ciclo_lectivo, para cualquier curso: este
-- trigger solo llega a rechazar el cambio de institución
CREATE FUNCTION fn_curso_inscripciones() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM inscripcion i
                WHERE i.curso_id = OLD.curso_id) THEN
        RAISE EXCEPTION 'El curso % tiene inscripciones', OLD.curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_curso_inscripciones';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_curso_inscripciones
    BEFORE UPDATE ON curso
    FOR EACH ROW
    WHEN (NEW.institucion_id <> OLD.institucion_id
          OR NEW.anio_ciclo_lectivo <> OLD.anio_ciclo_lectivo)
    EXECUTE FUNCTION fn_curso_inscripciones();

-- Baja lógica de un alumno de la institución: completa su fecha_eliminacion, sin cambiar su estado,
-- y pasa sus inscripciones vigentes y activas a CANCELADA, sin darlas de baja: su fecha_eliminacion
-- sigue en NULL. Así ya no se lo puede calificar: trg_calificacion_coherencia (más abajo) solo
-- acepta inscripciones activas y vigentes, así que tampoco una activa que ya estaba dada de baja,
-- que no se cancela. Las finalizadas y las canceladas no cambian, y la baja no llega a
-- las calificaciones ni a las evaluaciones: todo es su historial, que se conserva completo para
-- cuando se lo restaure.
-- Devuelve en p_inscripciones_canceladas cuántas inscripciones canceló (0 o 1, porque un alumno
-- tiene una sola activa vigente: trg_inscripcion_coherencia).
-- Es todo o nada sin hacer COMMIT ni ROLLBACK: un CALL fuera de una transacción es una transacción
-- en sí mismo, y si falla cualquiera de sus pasos (un RAISE de acá o el de un trigger), PostgreSQL
-- deshace todo lo que había hecho. Llamado dentro de una transacción, forma parte de ella.
-- Errores previstos, que el backend traduce en un mensaje para el usuario:
--   - no_data_found (P0002): el alumno no existe en la institución.
--   - object_not_in_prerequisite_state (55000): el alumno ya estaba dado de baja.
-- FOR NO KEY UPDATE retiene la fila del alumno hasta el fin de la transacción, como
-- fn_inscripcion_coherencia: una segunda baja simultánea espera y, al seguir, lo encuentra dado de
-- baja, y una inscripción simultánea del alumno también espera o, si llegó antes, ya está guardada
-- cuando se cancelan las activas
CREATE PROCEDURE sp_alumno_dar_de_baja(
    p_alumno_id                     INT,
    p_institucion_id                INT,
    OUT p_inscripciones_canceladas  INT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_fecha_eliminacion  TIMESTAMPTZ;
    v_activa_id          INT;
    v_cancelada_id       INT;
BEGIN
    SELECT a.fecha_eliminacion
      INTO v_fecha_eliminacion
      FROM alumno a
     WHERE a.alumno_id = p_alumno_id
       AND a.institucion_id = p_institucion_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El alumno % no existe en la institución %', p_alumno_id, p_institucion_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF v_fecha_eliminacion IS NOT NULL THEN
        RAISE EXCEPTION 'El alumno % ya está dado de baja', p_alumno_id
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    SELECT e.inscripcion_estado_id
      INTO v_activa_id
      FROM inscripcion_estado e
     WHERE e.nombre = 'ACTIVA';

    SELECT e.inscripcion_estado_id
      INTO v_cancelada_id
      FROM inscripcion_estado e
     WHERE e.nombre = 'CANCELADA';

    UPDATE alumno
       SET fecha_eliminacion = NOW()
     WHERE alumno_id = p_alumno_id;

    UPDATE inscripcion
       SET inscripcion_estado_id = v_cancelada_id
     WHERE alumno_id = p_alumno_id
       AND inscripcion_estado_id = v_activa_id
       AND fecha_eliminacion IS NULL;

    GET DIAGNOSTICS p_inscripciones_canceladas = ROW_COUNT;
END;
$$;

-- Cierre de los ciclos lectivos: pasa a FINALIZADA las inscripciones activas y vigentes de los cursos
-- de ciclos cerrados (anteriores al actual), sin cambiar nada más: es la excepción que admite
-- trg_inscripcion_ciclo_lectivo. Las canceladas, las finalizadas y las dadas de baja no cambian. Así,
-- la primera inscripción de un alumno en el ciclo nuevo no choca con una activa del anterior.
-- Devuelve en p_inscripciones_finalizadas cuántas inscripciones finalizó.
-- Es idempotente: una segunda llamada ya no encuentra activas en los ciclos cerrados y devuelve 0.
-- Está pensado para que lo llame el proceso principal cada vez que se inicia la aplicación.
-- Es todo o nada sin hacer COMMIT ni ROLLBACK, como sp_alumno_dar_de_baja. No tiene errores
-- previstos. Si dos llamadas se cruzan, la segunda espera el bloqueo de cada fila que la primera ya
-- finalizó y, al seguir, PostgreSQL vuelve a evaluar las condiciones sobre la fila como quedó: ya no
-- está activa y no la cuenta
CREATE PROCEDURE sp_inscripcion_finalizar_ciclos_cerrados(
    OUT p_inscripciones_finalizadas  INT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_activa_id      INT;
    v_finalizada_id  INT;
BEGIN
    SELECT e.inscripcion_estado_id
      INTO v_activa_id
      FROM inscripcion_estado e
     WHERE e.nombre = 'ACTIVA';

    SELECT e.inscripcion_estado_id
      INTO v_finalizada_id
      FROM inscripcion_estado e
     WHERE e.nombre = 'FINALIZADA';

    UPDATE inscripcion i
       SET inscripcion_estado_id = v_finalizada_id
      FROM curso c
     WHERE c.curso_id = i.curso_id
       AND c.anio_ciclo_lectivo < fn_anio_ciclo_lectivo_actual()
       AND i.inscripcion_estado_id = v_activa_id
       AND i.fecha_eliminacion IS NULL;

    GET DIAGNOSTICS p_inscripciones_finalizadas = ROW_COUNT;
END;
$$;

-- Evaluaciones: las que un profesor toma en una asignación docente, es decir, en una materia de un
-- curso
CREATE TABLE evaluacion (
    evaluacion_id          INT           GENERATED ALWAYS AS IDENTITY,
    asignacion_docente_id  INT           NOT NULL,
    titulo                 VARCHAR(100)  NOT NULL,
    fecha_evaluacion       DATE          NOT NULL,
    -- Su año es el ciclo lectivo del curso de la asignación. Con calificaciones vigentes no pasa a
    -- una fecha futura: se califica a partir de la fecha de la evaluación
    fecha_eliminacion      TIMESTAMPTZ,
    -- NULL = vigente; con fecha = dada de baja (baja lógica): la fila se conserva, pero deja de
    -- contar para las reglas de esta tabla

    CONSTRAINT pk_evaluacion PRIMARY KEY (evaluacion_id),
    CONSTRAINT fk_evaluacion_asignacion_docente FOREIGN KEY (asignacion_docente_id) REFERENCES asignacion_docente(asignacion_docente_id)
);

-- El título de una evaluación vigente no se repite dentro de una asignación; otra asignación sí
-- puede usarlo. Las dadas de baja no cuentan, así que el título se puede volver a usar después de
-- una baja; por eso es un índice único parcial, como el de curso.
-- asignacion_docente_id no necesita un índice propio: ya es la primera columna de este, que abarca
-- a las evaluaciones vigentes
CREATE UNIQUE INDEX uq_evaluacion_asignacion_docente_titulo
    ON evaluacion (asignacion_docente_id, titulo)
    WHERE fecha_eliminacion IS NULL;

-- Una evaluación solo se crea, se edita o se da de baja en el ciclo lectivo actual: el del curso de
-- su asignación, como en trg_curso_ciclo_lectivo. En un cambio de asignación se controla primero la
-- que tenía y después la nueva. Sin bloqueos: una asignación solo cambia de curso dentro del ciclo
-- actual (trg_asignacion_docente_ciclo_lectivo), y el ciclo de un curso no cambia. Si la asignación
-- no existe, su año queda en NULL y no falla: la rechaza después su clave foránea
CREATE FUNCTION fn_evaluacion_ciclo_lectivo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_asignaciones           INT[] := ARRAY[NEW.asignacion_docente_id];
    v_asignacion_docente_id  INT;
    v_anio                   INT;
    v_estado                 TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_asignaciones := OLD.asignacion_docente_id || v_asignaciones;
    END IF;

    FOREACH v_asignacion_docente_id IN ARRAY v_asignaciones LOOP
        SELECT c.anio_ciclo_lectivo
          INTO v_anio
          FROM asignacion_docente a
          JOIN curso c ON c.curso_id = a.curso_id
         WHERE a.asignacion_docente_id = v_asignacion_docente_id;

        v_estado := fn_ciclo_lectivo_estado(v_anio);

        IF v_estado = 'CERRADO' THEN
            RAISE EXCEPTION 'La asignación docente % de la evaluación % es del ciclo lectivo %, que está cerrado',
                            v_asignacion_docente_id, NEW.evaluacion_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_evaluacion_ciclo_lectivo_cerrado';
        END IF;

        IF v_estado = 'FUTURO' THEN
            RAISE EXCEPTION 'La asignación docente % de la evaluación % es del ciclo lectivo %, que todavía no empezó',
                            v_asignacion_docente_id, NEW.evaluacion_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_evaluacion_ciclo_lectivo_futuro';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evaluacion_ciclo_lectivo
    BEFORE INSERT OR UPDATE ON evaluacion
    FOR EACH ROW
    EXECUTE FUNCTION fn_evaluacion_ciclo_lectivo();

-- El año de la fecha de una evaluación vigente es el ciclo lectivo del curso de su asignación. Las
-- dadas de baja no se validan. FOR SHARE retiene las filas de la asignación y del curso hasta el
-- fin de la transacción: un cambio simultáneo de curso o de ciclo lectivo espera y, al seguir, su
-- trigger (más abajo) ya ve esta evaluación. Si una fila referenciada no existe, la comparación da
-- NULL y no falla: la rechaza después su clave foránea
CREATE FUNCTION fn_evaluacion_fecha_ciclo_lectivo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_curso_id            INT;
    v_anio_ciclo_lectivo  INT;
BEGIN
    -- Sin JOIN con curso, como en fn_asignacion_docente_coherencia: si la asignación cambió de
    -- curso mientras esperaba el bloqueo, PostgreSQL vuelve a evaluar la consulta con la fila nueva
    -- de la asignación pero con el curso anterior, y no devolvería nada
    SELECT a.curso_id
      INTO v_curso_id
      FROM asignacion_docente a
     WHERE a.asignacion_docente_id = NEW.asignacion_docente_id
       FOR SHARE;

    SELECT c.anio_ciclo_lectivo
      INTO v_anio_ciclo_lectivo
      FROM curso c
     WHERE c.curso_id = v_curso_id
       FOR SHARE;

    IF EXTRACT(YEAR FROM NEW.fecha_evaluacion) <> v_anio_ciclo_lectivo THEN
        RAISE EXCEPTION 'La fecha % no es del ciclo lectivo % del curso %',
                        NEW.fecha_evaluacion, v_anio_ciclo_lectivo, v_curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_evaluacion_fecha_ciclo_lectivo';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evaluacion_fecha_ciclo_lectivo
    BEFORE INSERT OR UPDATE ON evaluacion
    FOR EACH ROW
    WHEN (NEW.fecha_eliminacion IS NULL)
    EXECUTE FUNCTION fn_evaluacion_fecha_ciclo_lectivo();

-- Una asignación con evaluaciones vigentes conserva su curso: se tomaron en ese curso y sus fechas
-- son de su ciclo lectivo
CREATE FUNCTION fn_asignacion_docente_evaluaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM evaluacion e
                WHERE e.asignacion_docente_id = OLD.asignacion_docente_id
                  AND e.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'La asignación docente % tiene evaluaciones vigentes', OLD.asignacion_docente_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_asignacion_docente_evaluaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asignacion_docente_evaluaciones_vigentes
    BEFORE UPDATE ON asignacion_docente
    FOR EACH ROW
    WHEN (NEW.curso_id <> OLD.curso_id)
    EXECUTE FUNCTION fn_asignacion_docente_evaluaciones_vigentes();

-- Un curso con evaluaciones vigentes conserva su ciclo lectivo. Cuentan las de todas sus
-- asignaciones, también las dadas de baja: sus evaluaciones siguen vigentes.
-- Un cambio de ciclo lectivo ya lo rechaza antes trg_curso_ciclo_lectivo, para cualquier curso, así
-- que este trigger ya no llega a rechazar nada: se conserva como segunda barrera
CREATE FUNCTION fn_curso_evaluaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM asignacion_docente a
                 JOIN evaluacion e ON e.asignacion_docente_id = a.asignacion_docente_id
                WHERE a.curso_id = OLD.curso_id
                  AND e.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'El curso % tiene evaluaciones vigentes', OLD.curso_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_curso_evaluaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_curso_evaluaciones_vigentes
    BEFORE UPDATE ON curso
    FOR EACH ROW
    WHEN (NEW.anio_ciclo_lectivo <> OLD.anio_ciclo_lectivo)
    EXECUTE FUNCTION fn_curso_evaluaciones_vigentes();

-- Calificaciones: la nota de un alumno en una evaluación. El alumno se referencia por su
-- inscripción en el curso de la evaluación, no directamente.
-- Quien todavía no fue calificado no tiene fila. La que existe no se borra: se corrige su nota o,
-- si se cargó por error, se da de baja (baja lógica). La dada de baja ya no se modifica ni se
-- restaura.
-- Solo se califica en una evaluación vigente cuya fecha ya llegó: no en una dada de baja ni en una
-- con fecha futura
CREATE TABLE calificacion (
    calificacion_id    INT           GENERATED ALWAYS AS IDENTITY,
    evaluacion_id      INT           NOT NULL,
    inscripcion_id     INT           NOT NULL,
    -- El alumno, por su inscripción en el curso de la evaluación
    nota               NUMERIC(4,2)  NOT NULL,
    -- De 0 a 10, con hasta dos decimales. La baja no la vacía: la fila conserva su última nota
    fecha_eliminacion  TIMESTAMPTZ,
    -- NULL = vigente; con fecha = dada de baja (baja lógica): la fila se conserva, pero deja de
    -- contar para las reglas de esta tabla

    CONSTRAINT pk_calificacion PRIMARY KEY (calificacion_id),
    CONSTRAINT fk_calificacion_evaluacion FOREIGN KEY (evaluacion_id) REFERENCES evaluacion(evaluacion_id),
    CONSTRAINT fk_calificacion_inscripcion FOREIGN KEY (inscripcion_id) REFERENCES inscripcion(inscripcion_id),
    CONSTRAINT ck_calificacion_nota CHECK (nota BETWEEN 0 AND 10)
);

-- Una inscripción tiene una sola calificación vigente por evaluación. Las dadas de baja no
-- cuentan, así que después de una baja se le puede cargar otra nota en la misma evaluación; por
-- eso es un índice único parcial, como el de curso.
-- evaluacion_id no necesita un índice propio: ya es la primera columna de este, que abarca a las
-- calificaciones vigentes
CREATE UNIQUE INDEX uq_calificacion_evaluacion_inscripcion
    ON calificacion (evaluacion_id, inscripcion_id)
    WHERE fecha_eliminacion IS NULL;

CREATE INDEX idx_calificacion_inscripcion_id ON calificacion(inscripcion_id);

-- Una calificación solo se carga, se corrige o se da de baja en el ciclo lectivo actual: el del curso
-- de la asignación de su evaluación, como en trg_curso_ciclo_lectivo. En un cambio de evaluación se
-- controla primero la que tenía y después la nueva. Sin bloqueos, como en
-- trg_evaluacion_ciclo_lectivo: una evaluación solo cambia de asignación, y una asignación de curso,
-- dentro del ciclo actual. Si la evaluación no existe, su año queda en NULL y no falla: la rechaza
-- después su clave foránea
CREATE FUNCTION fn_calificacion_ciclo_lectivo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_evaluaciones   INT[] := ARRAY[NEW.evaluacion_id];
    v_evaluacion_id  INT;
    v_anio           INT;
    v_estado         TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_evaluaciones := OLD.evaluacion_id || v_evaluaciones;
    END IF;

    FOREACH v_evaluacion_id IN ARRAY v_evaluaciones LOOP
        SELECT c.anio_ciclo_lectivo
          INTO v_anio
          FROM evaluacion e
          JOIN asignacion_docente a ON a.asignacion_docente_id = e.asignacion_docente_id
          JOIN curso c ON c.curso_id = a.curso_id
         WHERE e.evaluacion_id = v_evaluacion_id;

        v_estado := fn_ciclo_lectivo_estado(v_anio);

        IF v_estado = 'CERRADO' THEN
            RAISE EXCEPTION 'La evaluación % de la calificación % es del ciclo lectivo %, que está cerrado',
                            v_evaluacion_id, NEW.calificacion_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_calificacion_ciclo_lectivo_cerrado';
        END IF;

        IF v_estado = 'FUTURO' THEN
            RAISE EXCEPTION 'La evaluación % de la calificación % es del ciclo lectivo %, que todavía no empezó',
                            v_evaluacion_id, NEW.calificacion_id, v_anio
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_calificacion_ciclo_lectivo_futuro';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calificacion_ciclo_lectivo
    BEFORE INSERT OR UPDATE ON calificacion
    FOR EACH ROW
    EXECUTE FUNCTION fn_calificacion_ciclo_lectivo();

-- Coherencia de una calificación con las filas que referencia.
-- Al cargarla y cada vez que se corrige, es decir, siempre que la fila queda vigente: la evaluación
-- está vigente (sin baja lógica) y su fecha ya llegó (es de hoy o anterior, con fn_fecha_actual()),
-- y la inscripción es del curso de la asignación de la evaluación, está vigente (sin baja lógica) y
-- está activa. La baja lógica de la inscripción no cambia su estado, así que se valida aparte: una
-- activa dada de baja sigue siendo ACTIVA.
-- Al darla de baja, solo lo de la inscripción: las de una inscripción que dejó de estar activa
-- (finalizada o cancelada) o que se dio de baja se conservan como están, y ya no se pueden corregir
-- ni dar de baja. Por eso el trigger valida también la baja de la calificación, y no lleva el
-- WHEN (NEW.fecha_eliminacion IS NULL) de los de asignacion_docente y evaluacion. La evaluación no
-- se mira en la baja, así la de una calificación puede seguir a la de su evaluación.
-- Una calificación dada de baja ya no se modifica: ni su nota ni su fecha de baja, y tampoco se
-- restaura.
-- FOR SHARE retiene las filas de la evaluación, de su asignación y de la inscripción hasta el fin
-- de la transacción: un cambio simultáneo de asignación o de curso espera y, al seguir, su trigger
-- (más abajo) ya ve cómo quedó esta calificación; también el paso de la evaluación a una fecha
-- futura (trg_evaluacion_futura_calificaciones_vigentes, más abajo). Uno de estado o una baja
-- lógica de la inscripción, o una baja de la evaluación, también espera, y sigue con la calificación
-- ya guardada. Al revés, si la evaluación o la inscripción cambió primero (de fecha, de estado o
-- por una baja), la calificación espera a que termine y se valida con la fila como quedó. Si una
-- fila referenciada no existe, las comparaciones dan NULL y no fallan: la rechaza después su clave
-- foránea
CREATE FUNCTION fn_calificacion_coherencia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_asignacion_docente_id          INT;
    v_evaluacion_fecha               DATE;
    v_evaluacion_fecha_eliminacion   TIMESTAMPTZ;
    v_evaluacion_curso_id            INT;
    v_inscripcion_curso_id           INT;
    v_inscripcion_estado_id          INT;
    v_inscripcion_fecha_eliminacion  TIMESTAMPTZ;
    v_estado                         VARCHAR(50);
BEGIN
    -- Antes de las consultas: una dada de baja se rechaza en cualquier cambio, también en la
    -- restauración (fecha_eliminacion de vuelta en NULL)
    IF TG_OP = 'UPDATE' AND OLD.fecha_eliminacion IS NOT NULL THEN
        RAISE EXCEPTION 'La calificación % está dada de baja', OLD.calificacion_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_calificacion_vigente';
    END IF;

    -- Sin JOIN de la evaluación con su asignación ni de la inscripción con su estado, como en
    -- fn_asignacion_docente_coherencia: si la fila cambió mientras esperaba el bloqueo, PostgreSQL
    -- vuelve a evaluar la consulta con la fila nueva pero con la asignación o el estado
    -- anteriores, y no devolvería nada
    SELECT e.asignacion_docente_id, e.fecha_evaluacion, e.fecha_eliminacion
      INTO v_asignacion_docente_id, v_evaluacion_fecha, v_evaluacion_fecha_eliminacion
      FROM evaluacion e
     WHERE e.evaluacion_id = NEW.evaluacion_id
       FOR SHARE;

    SELECT a.curso_id
      INTO v_evaluacion_curso_id
      FROM asignacion_docente a
     WHERE a.asignacion_docente_id = v_asignacion_docente_id
       FOR SHARE;

    SELECT i.curso_id, i.inscripcion_estado_id, i.fecha_eliminacion
      INTO v_inscripcion_curso_id, v_inscripcion_estado_id, v_inscripcion_fecha_eliminacion
      FROM inscripcion i
     WHERE i.inscripcion_id = NEW.inscripcion_id
       FOR SHARE;

    SELECT e.nombre
      INTO v_estado
      FROM inscripcion_estado e
     WHERE e.inscripcion_estado_id = v_inscripcion_estado_id;

    -- Solo al cargar o corregir: la baja de una calificación no mira la evaluación
    IF NEW.fecha_eliminacion IS NULL THEN
        IF v_evaluacion_fecha_eliminacion IS NOT NULL THEN
            RAISE EXCEPTION 'La evaluación % está dada de baja', NEW.evaluacion_id
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_calificacion_evaluacion_vigente';
        END IF;

        IF v_evaluacion_fecha > fn_fecha_actual() THEN
            RAISE EXCEPTION 'La evaluación % es del %, que todavía no llegó',
                            NEW.evaluacion_id, v_evaluacion_fecha
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'ck_calificacion_evaluacion_futura';
        END IF;
    END IF;

    IF v_inscripcion_curso_id <> v_evaluacion_curso_id THEN
        RAISE EXCEPTION 'La inscripción % no es del curso de la evaluación %',
                        NEW.inscripcion_id, NEW.evaluacion_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_calificacion_mismo_curso';
    END IF;

    -- Antes que el estado: una inscripción dada de baja se rechaza por la baja, sea cual sea su
    -- estado
    IF v_inscripcion_fecha_eliminacion IS NOT NULL THEN
        RAISE EXCEPTION 'La inscripción % está dada de baja', NEW.inscripcion_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_calificacion_inscripcion_vigente';
    END IF;

    IF v_estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'La inscripción % no está activa', NEW.inscripcion_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_calificacion_inscripcion_activa';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calificacion_coherencia
    BEFORE INSERT OR UPDATE ON calificacion
    FOR EACH ROW
    EXECUTE FUNCTION fn_calificacion_coherencia();

-- Una inscripción con calificaciones vigentes conserva su curso: son de evaluaciones de ese curso.
-- Las dadas de baja no cuentan: quitada una nota cargada por error, la inscripción puede cambiar
-- de curso. El estado sí puede cambiar, y la inscripción también se puede dar de baja: solo se
-- exige que esté activa y vigente al cargar, corregir o dar de baja una calificación
CREATE FUNCTION fn_inscripcion_calificaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM calificacion c
                WHERE c.inscripcion_id = OLD.inscripcion_id
                  AND c.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'La inscripción % tiene calificaciones vigentes', OLD.inscripcion_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_inscripcion_calificaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inscripcion_calificaciones_vigentes
    BEFORE UPDATE ON inscripcion
    FOR EACH ROW
    WHEN (NEW.curso_id <> OLD.curso_id)
    EXECUTE FUNCTION fn_inscripcion_calificaciones_vigentes();

-- Una evaluación con calificaciones vigentes conserva su asignación: sus alumnos son los del curso
-- de esa asignación. Vale también para una evaluación dada de baja: sus calificaciones siguen
-- vigentes
CREATE FUNCTION fn_evaluacion_calificaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM calificacion c
                WHERE c.evaluacion_id = OLD.evaluacion_id
                  AND c.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'La evaluación % tiene calificaciones vigentes', OLD.evaluacion_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_evaluacion_calificaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evaluacion_calificaciones_vigentes
    BEFORE UPDATE ON evaluacion
    FOR EACH ROW
    WHEN (NEW.asignacion_docente_id <> OLD.asignacion_docente_id)
    EXECUTE FUNCTION fn_evaluacion_calificaciones_vigentes();

-- Una evaluación con calificaciones vigentes no pasa a una fecha futura (posterior a
-- fn_fecha_actual()): se califica a partir de su fecha (trg_calificacion_coherencia), así que una
-- evaluación calificada ya se tomó. Las dadas de baja no cuentan. Vale también para una evaluación
-- dada de baja: sus calificaciones siguen vigentes.
-- Sin bloqueos propios: la carga o la corrección de una calificación retiene la fila de la
-- evaluación con FOR SHARE (fn_calificacion_coherencia), así que el cambio de fecha espera a que
-- termine y, al seguir, ya ve esa calificación; al revés, la calificación espera al cambio de fecha
-- y se valida con la fecha nueva
CREATE FUNCTION fn_evaluacion_futura_calificaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.fecha_evaluacion > fn_fecha_actual()
       AND EXISTS (SELECT 1
                     FROM calificacion c
                    WHERE c.evaluacion_id = OLD.evaluacion_id
                      AND c.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'La evaluación % tiene calificaciones vigentes y no puede pasar a la fecha futura %',
                        OLD.evaluacion_id, NEW.fecha_evaluacion
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_evaluacion_futura_calificaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evaluacion_futura_calificaciones_vigentes
    BEFORE UPDATE ON evaluacion
    FOR EACH ROW
    WHEN (NEW.fecha_evaluacion <> OLD.fecha_evaluacion)
    EXECUTE FUNCTION fn_evaluacion_futura_calificaciones_vigentes();

-- Una asignación con calificaciones vigentes conserva su curso. Cuentan las de todas sus
-- evaluaciones, también las de las evaluaciones dadas de baja, que
-- trg_asignacion_docente_evaluaciones_vigentes no cubre
CREATE FUNCTION fn_asignacion_docente_calificaciones_vigentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1
                 FROM evaluacion e
                 JOIN calificacion c ON c.evaluacion_id = e.evaluacion_id
                WHERE e.asignacion_docente_id = OLD.asignacion_docente_id
                  AND c.fecha_eliminacion IS NULL) THEN
        RAISE EXCEPTION 'La asignación docente % tiene calificaciones vigentes',
                        OLD.asignacion_docente_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_asignacion_docente_calificaciones_vigentes';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asignacion_docente_calificaciones_vigentes
    BEFORE UPDATE ON asignacion_docente
    FOR EACH ROW
    WHEN (NEW.curso_id <> OLD.curso_id)
    EXECUTE FUNCTION fn_asignacion_docente_calificaciones_vigentes();

COMMIT;
