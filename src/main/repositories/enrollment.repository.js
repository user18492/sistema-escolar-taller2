const { query, runInTransaction } = require('../database/connection');
const { Enrollment } = require('../models/enrollment.model');
const { Student } = require('../models/student.model');
const { Course } = require('../models/course.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE, COLUMN_VALUE_BY_EDUCATION_LEVEL } = require('./grade.repository');
const { SHIFT_BY_COLUMN_VALUE, COLUMN_VALUE_BY_SHIFT } = require('./course.repository');

// Listado de las inscripciones vigentes (sin baja lógica) de un curso, con su alumno: las activas y
// las finalizadas (valores de inscripcion_estado.nombre), que son las que cuentan para el promedio.
// Las canceladas quedan afuera: el alumno dejó de cursar ese curso. Las dadas de baja también, en
// cualquier estado. No hace falta la institución: el alumno es de la misma que el curso
// (trg_inscripcion_coherencia, db/schema.sql). `activa` indica si el estado de la inscripción es
// ACTIVA; si no, es FINALIZADA.
// El orden es total: el alumno (por apellido y nombre; alumno_id mantiene juntas las de dos alumnos
// que se llaman igual) y, si un alumno tiene más de una inscripción en el curso, la más antigua
// primero (inscripcion_id), así dos consultas sobre los mismos datos dan siempre el mismo orden.
const FIND_ACTIVE_OR_FINISHED_BY_COURSE_SQL = `
  SELECT i.inscripcion_id,
         i.curso_id,
         i.fecha_inscripcion,
         (ie.nombre = 'ACTIVA') AS activa,
         al.alumno_id,
         al.nombre,
         al.apellido,
         al.dni
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN alumno al ON al.alumno_id = i.alumno_id
   WHERE i.curso_id = $1
     AND i.fecha_eliminacion IS NULL
     AND ie.nombre IN ('ACTIVA', 'FINALIZADA')
   ORDER BY al.apellido, al.nombre, al.alumno_id, i.inscripcion_id
`;

// Cantidad de inscripciones vigentes (sin baja lógica) y activas (de estado ACTIVA, un valor de
// inscripcion_estado.nombre) de una institución en el ciclo lectivo del año en curso. La institución
// y el ciclo lectivo son los del curso: la inscripción no los guarda. El año en curso lo resuelve la
// base (CURRENT_DATE), así que las de ciclos anteriores quedan afuera sin que nadie las descuente: la
// cuenta vuelve a 0 cuando empieza un año. Solo cuentan la baja y el estado de la inscripción, no el
// estado del alumno ni la baja del curso.
const COUNT_ACTIVE_IN_CURRENT_SCHOOL_YEAR_SQL = `
  SELECT COUNT(*)::INT AS total
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN curso c ON c.curso_id = i.curso_id
   WHERE c.institucion_id = $1
     AND i.fecha_eliminacion IS NULL
     AND ie.nombre = 'ACTIVA'
     AND c.anio_ciclo_lectivo = EXTRACT(YEAR FROM CURRENT_DATE)::INT
`;

// Inscripciones vigentes (sin baja lógica) de alumnos vigentes de la institución $1 que pasan los
// filtros $2 a $8, en cualquier estado. La institución es la del curso: la inscripción no la guarda.
// Las de un alumno dado de baja quedan afuera, todas: su baja no da de baja sus inscripciones (solo
// cancela la activa, sp_alumno_dar_de_baja en db/schema.sql), así que al restaurarlo vuelven a
// listarse completas. La baja del curso no cuenta.
// Cada filtro es un arreglo, vacío si no filtra: inscripciones ($2, inscripcion_id), alumnos ($3,
// alumno_id), grados ($4 los niveles educativos y $5 los nombres, de a pares en la misma
// posición), divisiones ($6), turnos ($7) y estados ($8, valores de inscripcion_estado.nombre).
// Una inscripción pasa un filtro si coincide con alguno de sus valores; entre sí se combinan con Y.
const FILTERED_NOT_DELETED_BY_INSTITUTION_SQL = `
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN alumno al ON al.alumno_id = i.alumno_id
    JOIN curso c ON c.curso_id = i.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
   WHERE c.institucion_id = $1
     AND i.fecha_eliminacion IS NULL
     AND al.fecha_eliminacion IS NULL
     AND (CARDINALITY($2::INT[]) = 0 OR i.inscripcion_id = ANY($2::INT[]))
     AND (CARDINALITY($3::INT[]) = 0 OR i.alumno_id = ANY($3::INT[]))
     AND (CARDINALITY($4::TEXT[]) = 0
          OR (g.nivel_educativo, g.nombre) IN (SELECT * FROM UNNEST($4::TEXT[], $5::TEXT[])))
     AND (CARDINALITY($6::TEXT[]) = 0 OR c.division = ANY($6::TEXT[]))
     AND (CARDINALITY($7::TEXT[]) = 0 OR c.turno = ANY($7::TEXT[]))
     AND (CARDINALITY($8::TEXT[]) = 0 OR ie.nombre = ANY($8::TEXT[]))`;

// Cantidad de inscripciones de FILTERED_NOT_DELETED_BY_INSTITUTION_SQL.
const COUNT_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL = `
  SELECT COUNT(*)::INT AS total
  ${FILTERED_NOT_DELETED_BY_INSTITUTION_SQL}
`;

// Una página de las inscripciones de FILTERED_NOT_DELETED_BY_INSTITUTION_SQL: hasta $9 a partir de
// la posición $10 (0 es la primera), con su alumno, su curso y su estado.
// El orden es total, como en FIND_ACTIVE_OR_FINISHED_BY_COURSE_SQL: el alumno (por apellido y
// nombre; alumno_id mantiene juntas las de dos alumnos que se llaman igual) y, si un alumno tiene
// más de una inscripción, la más antigua primero (inscripcion_id). Así dos consultas sobre los
// mismos datos dan siempre el mismo orden y las páginas no se pisan.
const FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL = `
  SELECT i.inscripcion_id,
         i.fecha_inscripcion,
         ie.nombre AS estado,
         al.alumno_id,
         al.nombre,
         al.apellido,
         c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo
  ${FILTERED_NOT_DELETED_BY_INSTITUTION_SQL}
   ORDER BY al.apellido, al.nombre, al.alumno_id, i.inscripcion_id
   LIMIT $9 OFFSET $10
`;

// Todas las inscripciones vigentes de alumnos vigentes de la institución, sin filtros, con los datos
// de su alumno que necesitan las opciones de los filtros Número de inscripción y Alumno. Mismas
// inscripciones y mismo orden que FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL sin filtros.
const FIND_NOT_DELETED_BY_INSTITUTION_SQL = `
  SELECT i.inscripcion_id,
         al.alumno_id,
         al.nombre,
         al.apellido,
         al.email
    FROM inscripcion i
    JOIN alumno al ON al.alumno_id = i.alumno_id
    JOIN curso c ON c.curso_id = i.curso_id
   WHERE c.institucion_id = $1
     AND i.fecha_eliminacion IS NULL
     AND al.fecha_eliminacion IS NULL
   ORDER BY al.apellido, al.nombre, al.alumno_id, i.inscripcion_id
`;

// Posición de la inscripción $9 entre las de FILTERED_NOT_DELETED_BY_INSTITUTION_SQL, en el orden de
// FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL: cuántas la preceden (0 si es la primera). Ninguna
// fila si la inscripción no pasa los filtros. La comparación de filas sigue el mismo orden total que
// el ORDER BY del listado: apellido, nombre, alumno_id e inscripcion_id.
const FIND_POSITION_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL = `
  WITH filtered AS (
    SELECT al.apellido,
           al.nombre,
           al.alumno_id,
           i.inscripcion_id
    ${FILTERED_NOT_DELETED_BY_INSTITUTION_SQL}
  )
  SELECT (SELECT COUNT(*)::INT
            FROM filtered f
           WHERE (f.apellido, f.nombre, f.alumno_id, f.inscripcion_id)
                 < (t.apellido, t.nombre, t.alumno_id, t.inscripcion_id)) AS preceding_count
    FROM filtered t
   WHERE t.inscripcion_id = $9
`;

// Alta: inscribe al alumno $1 en el curso $2, siempre ACTIVA, con la fecha del día (DEFAULT
// CURRENT_DATE de inscripcion.fecha_inscripcion). Solo inserta si el alumno está vigente y ACTIVO,
// y el curso está vigente y es del nivel educativo $4, los dos de la institución $3; si no, no
// inserta nada. Devuelve la fila creada con los campos de FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL.
// El servicio ya comprobó todo eso, pero otra sesión pudo cambiarlo después. FOR NO KEY UPDATE (el
// alumno) y FOR SHARE (el curso) son los mismos bloqueos que toman después trg_inscripcion_coherencia
// y trg_inscripcion_fecha_ciclo_lectivo (db/schema.sql), pero antes de comprobar las condiciones: una
// baja, un egreso o un cambio simultáneo del alumno o del curso espera a que termine esta inscripción
// o, si llegó antes, las condiciones se vuelven a evaluar sobre la fila que dejó y no se inserta nada.
// Los triggers rechazan el alta si el alumno ya tiene una inscripción activa o si el curso no es
// del ciclo lectivo del año en curso: ver isSecondActiveEnrollmentError e isDateOutOfSchoolYearError.
const CREATE_SQL = `
  WITH created AS (
    INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id)
    SELECT al.alumno_id,
           c.curso_id,
           (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA')
      FROM alumno al
     CROSS JOIN curso c
     WHERE al.alumno_id = $1
       AND al.institucion_id = $3
       AND al.fecha_eliminacion IS NULL
       AND al.alumno_estado_id = (SELECT alumno_estado_id FROM alumno_estado WHERE nombre = 'ACTIVO')
       AND c.curso_id = $2
       AND c.institucion_id = $3
       AND c.fecha_eliminacion IS NULL
       AND c.grado_id IN (SELECT grado_id FROM grado WHERE nivel_educativo = $4)
       FOR NO KEY UPDATE OF al
       FOR SHARE OF c
    RETURNING inscripcion_id, alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion
  )
  SELECT i.inscripcion_id,
         i.fecha_inscripcion,
         ie.nombre AS estado,
         al.alumno_id,
         al.nombre,
         al.apellido,
         c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo
    FROM created i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN alumno al ON al.alumno_id = i.alumno_id
    JOIN curso c ON c.curso_id = i.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
`;

// La inscripción $1 de la institución $2, vigente o dada de baja (fecha_eliminacion), con los campos
// de FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL. La institución es la del curso: la inscripción no
// la guarda. Ninguna fila si no existe en la institución. No mira al alumno ni al curso: los trae
// aunque estén dados de baja.
const FIND_BY_ID_SQL = `
  SELECT i.inscripcion_id,
         i.fecha_inscripcion,
         i.fecha_eliminacion,
         ie.nombre AS estado,
         al.alumno_id,
         al.nombre,
         al.apellido,
         c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN alumno al ON al.alumno_id = i.alumno_id
    JOIN curso c ON c.curso_id = i.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
   WHERE i.inscripcion_id = $1
     AND c.institucion_id = $2
`;

// Edición: pasa la inscripción $1 de la institución $2 al estado $3 (un valor de
// inscripcion_estado.nombre), solo si está vigente y tiene otro estado; si no, no cambia nada. El
// alumno, el curso y la fecha no cambian. Devuelve la fila como quedó, con los campos de
// FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL.
// El servicio ya comprobó todo eso, pero otra sesión pudo cambiarlo después: si la fila cambió
// mientras el UPDATE esperaba su bloqueo, PostgreSQL vuelve a evaluar las condiciones sobre la fila
// que dejó y, si ya no las cumple, no la cambia.
// trg_inscripcion_coherencia (db/schema.sql) rechaza el cambio a ACTIVA si el alumno ya tiene otra
// inscripción activa: ver isSecondActiveEnrollmentError. El resto de los controles de los triggers de
// inscripcion no pueden fallar, porque solo cambia el estado: ck_inscripcion_misma_institucion y
// ck_inscripcion_fecha_ciclo_lectivo se vuelven a evaluar sobre el mismo alumno, el mismo curso y la
// misma fecha, que ya los cumplían (el alumno y el curso no cambian de institución, ni el curso de
// ciclo lectivo, mientras tengan inscripciones), y trg_inscripcion_calificaciones_vigentes solo se
// dispara si cambia el curso.
const UPDATE_STATUS_SQL = `
  WITH updated AS (
    UPDATE inscripcion i
       SET inscripcion_estado_id = ie.inscripcion_estado_id
      FROM inscripcion_estado ie,
           curso c
     WHERE i.inscripcion_id = $1
       AND c.curso_id = i.curso_id
       AND c.institucion_id = $2
       AND i.fecha_eliminacion IS NULL
       AND ie.nombre = $3
       AND i.inscripcion_estado_id <> ie.inscripcion_estado_id
    RETURNING i.inscripcion_id, i.alumno_id, i.curso_id, i.inscripcion_estado_id, i.fecha_inscripcion
  )
  SELECT i.inscripcion_id,
         i.fecha_inscripcion,
         ie.nombre AS estado,
         al.alumno_id,
         al.nombre,
         al.apellido,
         c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo
    FROM updated i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN alumno al ON al.alumno_id = i.alumno_id
    JOIN curso c ON c.curso_id = i.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
`;

// Bloquea la inscripción $1 de la institución $2 hasta el fin de la transacción, solo si está
// vigente. Ninguna fila si no existe en la institución o ya está dada de baja. Es el bloqueo que
// toma después MARK_AS_DELETED_SQL, pero antes de que busque calificaciones: ver markAsDeleted.
const LOCK_NOT_DELETED_SQL = `
  SELECT i.inscripcion_id
    FROM inscripcion i
    JOIN curso c ON c.curso_id = i.curso_id
   WHERE i.inscripcion_id = $1
     AND c.institucion_id = $2
     AND i.fecha_eliminacion IS NULL
     FOR NO KEY UPDATE OF i
`;

// Baja lógica: completa la fecha_eliminacion de la inscripción $1 de la institución $2, solo si está
// vigente y no tiene calificaciones vigentes (las dadas de baja no cuentan; las de una evaluación
// dada de baja sí, porque siguen vigentes); si no, no cambia nada. El estado, el alumno, el curso y
// la fecha de inscripción no cambian. Devuelve la fila como quedó, con los campos de
// FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL.
// Solo marca una inscripción vigente, así una segunda baja (repetida o simultánea) no pisa la fecha
// de la primera: si la fila cambió mientras el UPDATE esperaba su bloqueo, PostgreSQL vuelve a
// evaluar las condiciones sobre la fila que dejó y, si ya no las cumple, no la cambia.
// Ningún trigger de inscripcion puede rechazar la baja: trg_inscripcion_coherencia y
// trg_inscripcion_fecha_ciclo_lectivo se vuelven a evaluar sobre el mismo alumno, el mismo curso, el
// mismo estado y la misma fecha, que ya los cumplían, y trg_inscripcion_calificaciones_vigentes solo
// se dispara si cambia el curso.
const MARK_AS_DELETED_SQL = `
  WITH deleted AS (
    UPDATE inscripcion i
       SET fecha_eliminacion = NOW()
      FROM curso c
     WHERE i.inscripcion_id = $1
       AND c.curso_id = i.curso_id
       AND c.institucion_id = $2
       AND i.fecha_eliminacion IS NULL
       AND NOT EXISTS (SELECT 1
                         FROM calificacion ca
                        WHERE ca.inscripcion_id = i.inscripcion_id
                          AND ca.fecha_eliminacion IS NULL)
    RETURNING i.inscripcion_id, i.alumno_id, i.curso_id, i.inscripcion_estado_id, i.fecha_inscripcion
  )
  SELECT i.inscripcion_id,
         i.fecha_inscripcion,
         ie.nombre AS estado,
         al.alumno_id,
         al.nombre,
         al.apellido,
         c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo
    FROM deleted i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN alumno al ON al.alumno_id = i.alumno_id
    JOIN curso c ON c.curso_id = i.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
`;

// La inscripción activa del alumno $1, si tiene una: la misma que cuenta trg_inscripcion_coherencia
// para la regla de una sola activa por alumno, así que puede ser de un curso dado de baja. Si hubiera
// más de una (la regla no lo permite), la más antigua.
const FIND_ACTIVE_BY_STUDENT_SQL = `
  SELECT i.inscripcion_id,
         i.curso_id
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
   WHERE i.alumno_id = $1
     AND ie.nombre = 'ACTIVA'
   ORDER BY i.inscripcion_id
   LIMIT 1
`;

// Restricciones de los triggers de inscripcion (con los nombres que les da db/schema.sql) que
// rechazan un alta o una edición por un motivo previsto: el alumno ya tiene otra inscripción activa,
// o el año de la fecha de inscripción (la del día) no es el ciclo lectivo del curso (solo en el alta).
const ONE_ACTIVE_CONSTRAINT = 'ck_inscripcion_alumno_una_activa';
const SCHOOL_YEAR_CONSTRAINT = 'ck_inscripcion_fecha_ciclo_lectivo';

// La base guarda el estado de la inscripción en español (ck_inscripcion_estado_nombre,
// db/schema.sql); el resto del sistema usa estos códigos.
const STATUS_BY_COLUMN_VALUE = {
  ACTIVA: 'ACTIVE',
  FINALIZADA: 'COMPLETED',
  CANCELADA: 'CANCELLED',
};

const COLUMN_VALUE_BY_STATUS = Object.fromEntries(
  Object.entries(STATUS_BY_COLUMN_VALUE).map(([columnValue, status]) => [status, columnValue])
);

// Estados que admite inscripcion_estado.nombre, con los códigos del sistema.
const STATUSES = Object.keys(COLUMN_VALUE_BY_STATUS);

function toEnrollment(row) {
  return new Enrollment({
    id: row.inscripcion_id,
    student: new Student({
      id: row.alumno_id,
      firstName: row.nombre,
      lastName: row.apellido,
      dni: row.dni,
    }),
    courseId: row.curso_id,
    enrollmentDate: row.fecha_inscripcion,
    isActive: row.activa,
  });
}

function toInstitutionEnrollment(row) {
  return new Enrollment({
    id: row.inscripcion_id,
    student: new Student({
      id: row.alumno_id,
      firstName: row.nombre,
      lastName: row.apellido,
    }),
    course: new Course({
      id: row.curso_id,
      institutionId: row.institucion_id,
      gradeId: row.grado_id,
      gradeName: row.grado_nombre,
      educationLevel: EDUCATION_LEVEL_BY_COLUMN_VALUE[row.nivel_educativo],
      division: row.division,
      shift: SHIFT_BY_COLUMN_VALUE[row.turno],
      schoolYear: row.anio_ciclo_lectivo,
    }),
    courseId: row.curso_id,
    enrollmentDate: row.fecha_inscripcion,
    status: STATUS_BY_COLUMN_VALUE[row.estado],
    isActive: row.estado === 'ACTIVA',
    deletedAt: row.fecha_eliminacion,
  });
}

// Parámetros $1 a $8 de FILTERED_NOT_DELETED_BY_INSTITUTION_SQL. `filters` trae los códigos del
// sistema; acá pasan a los valores de las columnas.
function filterParams(institutionId, { enrollmentIds, studentIds, grades, divisions, shifts, statuses }) {
  return [
    institutionId,
    enrollmentIds,
    studentIds,
    grades.map(({ educationLevel }) => COLUMN_VALUE_BY_EDUCATION_LEVEL[educationLevel]),
    grades.map(({ gradeName }) => gradeName),
    divisions,
    shifts.map((shift) => COLUMN_VALUE_BY_SHIFT[shift]),
    statuses.map((status) => COLUMN_VALUE_BY_STATUS[status]),
  ];
}

// Cantidad de inscripciones vigentes de alumnos vigentes de la institución, en cualquier estado, que
// pasan `filters`: { enrollmentIds, studentIds, grades, divisions, shifts, statuses }, cada uno un
// arreglo, vacío si no filtra. `grades` son pares { educationLevel, gradeName } (PRIMARY o SECONDARY
// y el nombre del grado, 1° a 6°), `divisions` letras mayúsculas, `shifts` valores de SHIFTS
// (course.repository.js) y `statuses`, de STATUSES.
async function countNotDeletedByInstitution(institutionId, filters) {
  const { rows } = await query(COUNT_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL, filterParams(institutionId, filters));
  return rows[0].total;
}

// Hasta `limit` inscripciones vigentes de alumnos vigentes de la institución que pasan `filters`
// (como en countNotDeletedByInstitution), a partir de la posición `offset` (0 es la primera),
// ordenadas por alumno (apellido y nombre), con su alumno, su curso y su estado.
async function findPageNotDeletedByInstitution(institutionId, filters, { offset, limit }) {
  const { rows } = await query(FIND_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL, [
    ...filterParams(institutionId, filters),
    limit,
    offset,
  ]);
  return rows.map(toInstitutionEnrollment);
}

// Posición de la inscripción `enrollmentId` (un inscripcion_id) entre las vigentes de alumnos
// vigentes de la institución que pasan `filters` (como en countNotDeletedByInstitution), en el orden
// de findPageNotDeletedByInstitution: cuántas la preceden (0 si es la primera). null si no es una de
// ellas (no existe, es de otra institución o no pasa los filtros).
async function findPositionNotDeletedByInstitution(institutionId, filters, enrollmentId) {
  const { rows } = await query(FIND_POSITION_FILTERED_NOT_DELETED_BY_INSTITUTION_SQL, [
    ...filterParams(institutionId, filters),
    enrollmentId,
  ]);
  return rows.length > 0 ? rows[0].preceding_count : null;
}

// Todas las inscripciones vigentes de alumnos vigentes de la institución, sin filtrar, ordenadas
// como findPageNotDeletedByInstitution. Cada una trae solo su id y su alumno (id, nombre, apellido y
// email).
async function findNotDeletedByInstitution(institutionId) {
  const { rows } = await query(FIND_NOT_DELETED_BY_INSTITUTION_SQL, [institutionId]);
  return rows.map((row) => new Enrollment({
    id: row.inscripcion_id,
    student: new Student({
      id: row.alumno_id,
      firstName: row.nombre,
      lastName: row.apellido,
      email: row.email,
    }),
  }));
}

// Inscripciones vigentes, activas y finalizadas del curso `courseId` (un curso_id), sin las
// canceladas ni las dadas de baja, ordenadas por alumno (apellido y nombre). Que el curso se pueda
// consultar lo comprueba el servicio.
async function findActiveOrFinishedByCourse(courseId) {
  const { rows } = await query(FIND_ACTIVE_OR_FINISHED_BY_COURSE_SQL, [courseId]);
  return rows.map(toEnrollment);
}

// Cantidad de inscripciones vigentes y activas de la institución en el ciclo lectivo del año en
// curso.
async function countActiveInCurrentSchoolYear(institutionId) {
  const { rows } = await query(COUNT_ACTIVE_IN_CURRENT_SCHOOL_YEAR_SQL, [institutionId]);
  return rows[0].total;
}

// Inscribe al alumno `studentId` (un alumno_id) en el curso `courseId` (un curso_id) de la
// institución: la inscripción nace vigente, ACTIVA y con la fecha del día. `educationLevel` es el
// nivel educativo elegido (PRIMARY o SECONDARY), que tiene que ser el del grado del curso. Devuelve
// la inscripción creada, con su alumno, su curso y su estado, como findPageNotDeletedByInstitution;
// null si el alumno no está vigente y activo en la institución, o si el curso no está vigente en
// ella o es de otro nivel educativo. PostgreSQL rechaza el alta si el alumno ya tiene una
// inscripción activa (ver isSecondActiveEnrollmentError) o si el curso no es del ciclo lectivo del
// año en curso (ver isDateOutOfSchoolYearError).
async function create(institutionId, { studentId, courseId, educationLevel }) {
  const { rows } = await query(CREATE_SQL, [
    studentId,
    courseId,
    institutionId,
    COLUMN_VALUE_BY_EDUCATION_LEVEL[educationLevel],
  ]);
  return rows.length > 0 ? toInstitutionEnrollment(rows[0]) : null;
}

// La inscripción `enrollmentId` (un inscripcion_id) de la institución, vigente o dada de baja, con su
// alumno, su curso y su estado, como findPageNotDeletedByInstitution, y `deletedAt`, el instante de
// su baja lógica (null si está vigente); null si no existe en la institución.
async function findById(enrollmentId, institutionId) {
  const { rows } = await query(FIND_BY_ID_SQL, [enrollmentId, institutionId]);
  return rows.length > 0 ? toInstitutionEnrollment(rows[0]) : null;
}

// Pasa la inscripción vigente `enrollmentId` (un inscripcion_id) de la institución al estado `status`
// (de STATUSES), sin cambiar nada más, y la devuelve como quedó, con su alumno, su curso y su estado,
// como findPageNotDeletedByInstitution; null si no cambió nada: no existe en la institución, está
// dada de baja o ya tenía ese estado. PostgreSQL rechaza el cambio a ACTIVE si el alumno ya tiene
// otra inscripción activa (ver isSecondActiveEnrollmentError).
async function updateStatus(enrollmentId, institutionId, status) {
  const { rows } = await query(UPDATE_STATUS_SQL, [enrollmentId, institutionId, COLUMN_VALUE_BY_STATUS[status]]);
  return rows.length > 0 ? toInstitutionEnrollment(rows[0]) : null;
}

// Da de baja la inscripción vigente `enrollmentId` (un inscripcion_id) de la institución, si no tiene
// calificaciones vigentes: deja de listarse, sin cambiar nada más, y la devuelve con su alumno, su
// curso y su estado, como findPageNotDeletedByInstitution; null si no cambió nada: no existe en la
// institución, ya estaba dada de baja o tiene calificaciones vigentes.
async function markAsDeleted(enrollmentId, institutionId) {
  // En una transacción, con la fila bloqueada antes de buscar calificaciones: trg_calificacion_coherencia
  // (db/schema.sql) retiene la inscripción FOR SHARE al cargar, corregir o dar de baja una nota, así
  // que una carga o una baja simultánea termina antes de que el UPDATE, que es otra sentencia, busque
  // calificaciones, y este ya la ve. En una sola sentencia no la vería: PostgreSQL buscaría con la
  // foto de los datos tomada antes de esperar el bloqueo.
  return runInTransaction(async (transactionQuery) => {
    const locked = await transactionQuery(LOCK_NOT_DELETED_SQL, [enrollmentId, institutionId]);
    if (locked.rows.length === 0) return null;

    const { rows } = await transactionQuery(MARK_AS_DELETED_SQL, [enrollmentId, institutionId]);
    return rows.length > 0 ? toInstitutionEnrollment(rows[0]) : null;
  });
}

// La inscripción activa del alumno `studentId` (un alumno_id), solo con su id y el de su curso
// (`courseId`); null si no tiene ninguna.
async function findActiveByStudent(studentId) {
  const { rows } = await query(FIND_ACTIVE_BY_STUDENT_SQL, [studentId]);
  return rows.length > 0 ? new Enrollment({ id: rows[0].inscripcion_id, courseId: rows[0].curso_id }) : null;
}

// true si `error` es el rechazo de trg_inscripcion_coherencia a una segunda inscripción activa del
// mismo alumno, al crearla o al pasarla a activa: solo puede tener una.
function isSecondActiveEnrollmentError(error) {
  return error?.code === '23514' && error.constraint === ONE_ACTIVE_CONSTRAINT;
}

// true si `error` indica que el año de la fecha de inscripción no es el ciclo lectivo del curso.
function isDateOutOfSchoolYearError(error) {
  return error?.code === '23514' && error.constraint === SCHOOL_YEAR_CONSTRAINT;
}

module.exports = {
  findActiveOrFinishedByCourse,
  countActiveInCurrentSchoolYear,
  countNotDeletedByInstitution,
  findPageNotDeletedByInstitution,
  findPositionNotDeletedByInstitution,
  findNotDeletedByInstitution,
  create,
  findById,
  updateStatus,
  markAsDeleted,
  findActiveByStudent,
  isSecondActiveEnrollmentError,
  isDateOutOfSchoolYearError,
  STATUSES,
};
