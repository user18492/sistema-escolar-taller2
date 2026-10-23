const { query } = require('../database/connection');
const { Enrollment } = require('../models/enrollment.model');
const { Student } = require('../models/student.model');
const { Course } = require('../models/course.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE, COLUMN_VALUE_BY_EDUCATION_LEVEL } = require('./grade.repository');
const { SHIFT_BY_COLUMN_VALUE, COLUMN_VALUE_BY_SHIFT } = require('./course.repository');

// Listado de las inscripciones de un curso, con su alumno: las activas y las finalizadas (valores
// de inscripcion_estado.nombre), que son las que cuentan para el promedio. Las canceladas quedan
// afuera: el alumno dejó de cursar ese curso. No hace falta la institución: el alumno es de la
// misma que el curso (trg_inscripcion_coherencia, db/schema.sql). `activa` indica si el estado de
// la inscripción es ACTIVA; si no, es FINALIZADA.
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
     AND ie.nombre IN ('ACTIVA', 'FINALIZADA')
   ORDER BY al.apellido, al.nombre, al.alumno_id, i.inscripcion_id
`;

// Cantidad de inscripciones activas (de estado ACTIVA, un valor de inscripcion_estado.nombre) de una
// institución en el ciclo lectivo del año en curso. La institución y el ciclo lectivo son los del
// curso: la inscripción no los guarda. El año en curso lo resuelve la base (CURRENT_DATE), así que
// las de ciclos anteriores quedan afuera sin que nadie las descuente: la cuenta vuelve a 0 cuando
// empieza un año. Solo cuenta el estado de la inscripción, no el del alumno ni la baja del curso.
const COUNT_ACTIVE_IN_CURRENT_SCHOOL_YEAR_SQL = `
  SELECT COUNT(*)::INT AS total
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN curso c ON c.curso_id = i.curso_id
   WHERE c.institucion_id = $1
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

// Inscripciones activas y finalizadas del curso `courseId` (un curso_id), sin las canceladas,
// ordenadas por alumno (apellido y nombre). Que el curso se pueda consultar lo comprueba el
// servicio.
async function findActiveOrFinishedByCourse(courseId) {
  const { rows } = await query(FIND_ACTIVE_OR_FINISHED_BY_COURSE_SQL, [courseId]);
  return rows.map(toEnrollment);
}

// Cantidad de inscripciones activas de la institución en el ciclo lectivo del año en curso.
async function countActiveInCurrentSchoolYear(institutionId) {
  const { rows } = await query(COUNT_ACTIVE_IN_CURRENT_SCHOOL_YEAR_SQL, [institutionId]);
  return rows[0].total;
}

module.exports = {
  findActiveOrFinishedByCourse,
  countActiveInCurrentSchoolYear,
  countNotDeletedByInstitution,
  findPageNotDeletedByInstitution,
  findNotDeletedByInstitution,
  STATUSES,
};
