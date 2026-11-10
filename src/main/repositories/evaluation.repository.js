const { query } = require('../database/connection');
const { Evaluation } = require('../models/evaluation.model');
const { Course } = require('../models/course.model');
const { Subject } = require('../models/subject.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE } = require('./grade.repository');
const { SHIFT_BY_COLUMN_VALUE } = require('./course.repository');

// Columnas del trimestre de la evaluación, con su fecha (`dateColumn`): trimestre, su número (1, 2 o
// 3) con los cortes de fn_trimestre (db/schema.sql), los mismos de los promedios
// (vw_promedio_trimestral), y trimestre_cerrado, si ese trimestre está cerrado
// (fn_trimestre_cerrado), con la fecha de la base. Los calcula la base, que es la que rechaza
// después las escrituras en ese trimestre (trg_evaluacion_trimestre_cerrado).
const termColumns = (dateColumn) =>
  `fn_trimestre(${dateColumn}) AS trimestre,
   fn_trimestre_cerrado(EXTRACT(YEAR FROM ${dateColumn})::INT, fn_trimestre(${dateColumn})) AS trimestre_cerrado`;

// Listado de las evaluaciones vigentes de una asignación docente (sin las dadas de baja), con
// trimestre y trimestre_cerrado. El orden es total: la fecha (la más antigua primero) y, entre las
// del mismo día, el título, que no se repite entre las vigentes de una asignación
// (uq_evaluacion_asignacion_docente_titulo, db/schema.sql), así dos consultas sobre los mismos datos
// dan siempre el mismo orden.
const FIND_BY_TEACHER_ASSIGNMENT_SQL = `
  SELECT e.evaluacion_id,
         e.asignacion_docente_id,
         e.titulo,
         e.fecha_evaluacion,
         ${termColumns('e.fecha_evaluacion')}
    FROM evaluacion e
   WHERE e.asignacion_docente_id = $1
     AND e.fecha_eliminacion IS NULL
   ORDER BY e.fecha_evaluacion, e.titulo
`;

// Una evaluación vigente de una asignación docente: una de las que lista
// FIND_BY_TEACHER_ASSIGNMENT_SQL, también con trimestre y trimestre_cerrado.
const FIND_ACTIVE_BY_ID_AND_TEACHER_ASSIGNMENT_SQL = `
  SELECT e.evaluacion_id,
         e.asignacion_docente_id,
         e.titulo,
         e.fecha_evaluacion,
         ${termColumns('e.fecha_evaluacion')}
    FROM evaluacion e
   WHERE e.evaluacion_id = $1
     AND e.asignacion_docente_id = $2
     AND e.fecha_eliminacion IS NULL
`;

// Alta: una evaluación vigente de la asignación docente. Devuelve la fila creada, con
// trimestre y trimestre_cerrado (como las de la edición y la baja).
const CREATE_SQL = `
  INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion)
  VALUES ($1, $2, $3)
  RETURNING evaluacion_id, asignacion_docente_id, titulo, fecha_evaluacion,
            ${termColumns('fecha_evaluacion')}
`;

// Edición: solo modifica el título y la fecha de una evaluación vigente de la asignación docente,
// que conserva su asignación. Devuelve la fila como quedó.
const UPDATE_SQL = `
  UPDATE evaluacion
     SET titulo = $3,
         fecha_evaluacion = $4
   WHERE evaluacion_id = $1
     AND asignacion_docente_id = $2
     AND fecha_eliminacion IS NULL
  RETURNING evaluacion_id, asignacion_docente_id, titulo, fecha_evaluacion,
            ${termColumns('fecha_evaluacion')}
`;

// Baja lógica: la fila se conserva con la fecha de baja, y trg_evaluacion_baja_calificaciones
// (db/schema.sql) da de baja en la misma operación sus calificaciones vigentes (calificacion), con
// esa misma fecha. Solo marca una evaluación vigente de la asignación docente, así una segunda baja
// (repetida o simultánea) no pisa la fecha de la primera. Devuelve la fila.
const MARK_AS_DELETED_SQL = `
  UPDATE evaluacion
     SET fecha_eliminacion = NOW()
   WHERE evaluacion_id = $1
     AND asignacion_docente_id = $2
     AND fecha_eliminacion IS NULL
  RETURNING evaluacion_id, asignacion_docente_id, titulo, fecha_evaluacion,
            ${termColumns('fecha_evaluacion')}
`;

// Calificaciones pendientes de carga del profesor $1 (un usuario_id) en la institución $2: una fila
// por evaluación vigente de sus asignaciones vigentes de cursos de la institución del ciclo lectivo
// actual, ya tomada (de hoy o anterior, con la fecha de la base) y de un trimestre abierto, con al
// menos un alumno pendiente. Solo hace falta mirar la baja de la asignación: su curso está vigente
// (como en FIND_BY_TEACHER_SQL, teacher-assignment.repository.js).
// Los alumnos que deben tener nota en la evaluación replican el criterio de vw_promedio_trimestral
// (db/schema.sql): inscripciones vigentes del curso, con fecha de inscripción no posterior a la de
// la evaluación, salvo las FINALIZADA, que no se pueden calificar: solo las ACTIVA. El LEFT JOIN
// trae a lo sumo una calificación vigente por evaluación e inscripción
// (uq_calificacion_evaluacion_inscripcion), así que COUNT(*) cuenta inscripciones:
//   - alumnos: las que deben tener nota, con nota o sin ella;
//   - pendientes: las que no tienen una calificación vigente (sin fila o con la fila dada de baja).
// fecha_cierre es el último día en que todavía se puede cargar en el trimestre de la evaluación
// (fn_trimestre_fecha_cierre) y dias_restantes, los días desde hoy hasta esa fecha (0 si es hoy): los
// calcula la base, con su fecha. El orden es total: el cierre más próximo primero y, después, la
// fecha de la evaluación, el curso (primaria antes que secundaria, grado, división y turno), la
// materia, el título y evaluacion_id.
const FIND_PENDING_SCORES_BY_TEACHER_SQL = `
  SELECT e.evaluacion_id,
         e.titulo,
         to_char(e.fecha_evaluacion, 'YYYY-MM-DD') AS fecha_evaluacion,
         fn_trimestre(e.fecha_evaluacion) AS trimestre,
         a.asignacion_docente_id,
         c.curso_id,
         g.nombre AS grado_nombre,
         g.nivel_educativo,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         m.materia_id,
         m.nombre AS materia_nombre,
         COUNT(*) FILTER (WHERE cal.calificacion_id IS NULL)::INT AS pendientes,
         COUNT(*)::INT AS alumnos,
         to_char(fn_trimestre_fecha_cierre(c.anio_ciclo_lectivo, fn_trimestre(e.fecha_evaluacion)), 'YYYY-MM-DD') AS fecha_cierre,
         fn_trimestre_fecha_cierre(c.anio_ciclo_lectivo, fn_trimestre(e.fecha_evaluacion)) - fn_fecha_actual() AS dias_restantes
    FROM asignacion_docente a
    JOIN curso c ON c.curso_id = a.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
    JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
    JOIN materia m ON m.materia_id = gm.materia_id
    JOIN evaluacion e ON e.asignacion_docente_id = a.asignacion_docente_id
    JOIN inscripcion i ON i.curso_id = c.curso_id
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    LEFT JOIN calificacion cal ON cal.evaluacion_id = e.evaluacion_id
                              AND cal.inscripcion_id = i.inscripcion_id
                              AND cal.fecha_eliminacion IS NULL
   WHERE a.usuario_id = $1
     AND c.institucion_id = $2
     AND a.fecha_eliminacion IS NULL
     AND e.fecha_eliminacion IS NULL
     AND i.fecha_eliminacion IS NULL
     AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
     AND e.fecha_evaluacion <= fn_fecha_actual()
     AND NOT fn_trimestre_cerrado(c.anio_ciclo_lectivo, fn_trimestre(e.fecha_evaluacion))
     AND ie.nombre = 'ACTIVA'
     AND i.fecha_inscripcion <= e.fecha_evaluacion
   GROUP BY e.evaluacion_id, a.asignacion_docente_id, c.curso_id, g.grado_id, m.materia_id
  HAVING COUNT(*) FILTER (WHERE cal.calificacion_id IS NULL) > 0
   ORDER BY fn_trimestre_fecha_cierre(c.anio_ciclo_lectivo, fn_trimestre(e.fecha_evaluacion)),
            e.fecha_evaluacion,
            g.nivel_educativo, g.nombre, c.division, c.turno,
            m.nombre, e.titulo, e.evaluacion_id
`;

// Índice único y restricciones (con los nombres que les da db/schema.sql) que rechazan un alta, una
// edición o una baja de una evaluación por un motivo previsto: la asignación ya tiene otra
// evaluación vigente con ese título, la fecha no es del ciclo lectivo de su curso (la informa
// trg_evaluacion_fecha_ciclo_lectivo), ese curso es de un ciclo lectivo cerrado (la informa
// trg_evaluacion_ciclo_lectivo), en el alta o la edición, la asignación está dada de baja (la
// informa trg_evaluacion_coherencia), solo en la edición, la evaluación tiene calificaciones
// vigentes y la fecha nueva es futura (la informa trg_evaluacion_futura_calificaciones_vigentes) o,
// solo en la baja, la evaluación tiene calificaciones vigentes de inscripciones finalizadas (la
// informa trg_calificacion_coherencia, en la baja en cascada de sus calificaciones). Además, en los
// tres casos, la fecha (la que tenía o la nueva) es de un trimestre cerrado (la informa
// trg_evaluacion_trimestre_cerrado) y, solo en la edición, la evaluación tiene calificaciones
// vigentes de una inscripción posterior a la fecha nueva (la informa
// trg_evaluacion_fecha_inscripcion_calificaciones_vigentes).
// PostgreSQL informa el nombre del índice como el de una restricción.
const UNIQUE_INDEX = 'uq_evaluacion_asignacion_docente_titulo';
const SCHOOL_YEAR_CONSTRAINT = 'ck_evaluacion_fecha_ciclo_lectivo';
const CLOSED_SCHOOL_YEAR_CONSTRAINT = 'ck_evaluacion_ciclo_lectivo_cerrado';
const NOT_DELETED_ASSIGNMENT_CONSTRAINT = 'ck_evaluacion_asignacion_vigente';
const FUTURE_WITH_SCORES_CONSTRAINT = 'ck_evaluacion_futura_calificaciones_vigentes';
const COMPLETED_SCORES_CONSTRAINT = 'ck_calificacion_inscripcion_finalizada';
const CLOSED_TERM_CONSTRAINT = 'ck_evaluacion_trimestre_cerrado';
const BEFORE_ENROLLMENT_WITH_SCORES_CONSTRAINT = 'ck_evaluacion_fecha_anterior_inscripcion';

function toEvaluation(row) {
  return new Evaluation({
    id: row.evaluacion_id,
    teacherAssignmentId: row.asignacion_docente_id,
    title: row.titulo,
    evaluationDate: row.fecha_evaluacion,
    term: row.trimestre,
    isTermClosed: row.trimestre_cerrado,
  });
}

// Evaluaciones vigentes de la asignación docente `teacherAssignmentId` (un asignacion_docente_id),
// ordenadas por fecha, con term e isTermClosed (los de toEvaluation, como en las demás funciones).
// Que la asignación se pueda consultar lo comprueba el servicio.
async function findByTeacherAssignment(teacherAssignmentId) {
  const { rows } = await query(FIND_BY_TEACHER_ASSIGNMENT_SQL, [teacherAssignmentId]);
  return rows.map(toEvaluation);
}

// La evaluación vigente con ese id, si es de la asignación docente `teacherAssignmentId` (un
// asignacion_docente_id); null si no existe, fue dada de baja o es de otra asignación. Que la
// asignación se pueda consultar lo comprueba el servicio.
async function findActiveByIdAndTeacherAssignment(evaluationId, teacherAssignmentId) {
  const { rows } = await query(FIND_ACTIVE_BY_ID_AND_TEACHER_ASSIGNMENT_SQL, [evaluationId, teacherAssignmentId]);
  return rows.length > 0 ? toEvaluation(rows[0]) : null;
}

// Crea una evaluación vigente en la asignación docente `teacherAssignmentId` (un
// asignacion_docente_id), con el título `title` y el día `evaluationDate` ('AAAA-MM-DD'). Devuelve
// la evaluación creada. PostgreSQL rechaza el alta si la asignación ya tiene una vigente con ese
// título (isDuplicateError), si la fecha no es del ciclo lectivo de su curso
// (isDateOutOfSchoolYearError), si ese ciclo está cerrado (isClosedSchoolYearError), si la
// asignación está dada de baja (isDeletedAssignmentError) o si la fecha es de un trimestre cerrado
// (isClosedTermError). Que la asignación se pueda usar y que los datos sean válidos lo comprueba el
// servicio.
async function create(teacherAssignmentId, { title, evaluationDate }) {
  const { rows } = await query(CREATE_SQL, [teacherAssignmentId, title, evaluationDate]);
  return toEvaluation(rows[0]);
}

// Guarda el título `title` y el día `evaluationDate` ('AAAA-MM-DD') de la evaluación vigente con
// ese id, si es de la asignación docente `teacherAssignmentId` (un asignacion_docente_id), con los
// mismos valores que admite create. Devuelve la evaluación como quedó; null si no existe, fue dada
// de baja o es de otra asignación. PostgreSQL rechaza el cambio si la asignación ya tiene otra
// vigente con ese título (isDuplicateError), si la fecha no es del ciclo lectivo de su curso
// (isDateOutOfSchoolYearError), si ese ciclo está cerrado (isClosedSchoolYearError), si la
// asignación está dada de baja (isDeletedAssignmentError) o si la evaluación tiene calificaciones
// vigentes y la fecha nueva es posterior a hoy, con la fecha de la base (isFutureWithScoresError) o
// anterior a la fecha de inscripción de alguna inscripción calificada
// (isBeforeEnrollmentWithScoresError), y si la fecha que tenía o la nueva es de un trimestre cerrado
// (isClosedTermError). Que la asignación se pueda usar y que los datos sean válidos lo comprueba el
// servicio.
async function update(evaluationId, teacherAssignmentId, { title, evaluationDate }) {
  const { rows } = await query(UPDATE_SQL, [evaluationId, teacherAssignmentId, title, evaluationDate]);
  return rows.length > 0 ? toEvaluation(rows[0]) : null;
}

// Da de baja la evaluación, que deja de listarse y de contar para el índice único: su título se
// puede volver a usar en la asignación. En la misma operación se dan de baja todas sus
// calificaciones vigentes, también las de inscripciones canceladas o dadas de baja. Devuelve la
// evaluación dada de baja; null si no existe, ya estaba dada de baja o es de otra asignación.
// PostgreSQL rechaza la baja, sin cambiar nada, si el curso de la asignación es de un ciclo lectivo
// cerrado (isClosedSchoolYearError), si la evaluación es de un trimestre cerrado
// (isClosedTermError) o si tiene calificaciones vigentes de inscripciones finalizadas
// (isCompletedScoresError). Que la asignación se pueda usar lo comprueba el servicio.
async function markAsDeleted(evaluationId, teacherAssignmentId) {
  const { rows } = await query(MARK_AS_DELETED_SQL, [evaluationId, teacherAssignmentId]);
  return rows.length > 0 ? toEvaluation(rows[0]) : null;
}

// Calificaciones pendientes de carga del profesor `teacherId` (un usuario_id) en la institución
// `institutionId`, con el criterio y el orden de FIND_PENDING_SCORES_BY_TEACHER_SQL: una por
// evaluación ya tomada de un trimestre abierto del ciclo lectivo actual con algún alumno sin nota.
// Cada una, un objeto plano: { id, title, evaluationDate ('AAAA-MM-DD'), term (1, 2 o 3),
// teacherAssignmentId, course (un Course), subject (un Subject), pendingCount (los alumnos sin
// nota), studentCount (los que deben tener nota, con ella o sin ella), closingDate ('AAAA-MM-DD',
// el último día de carga del trimestre) y daysLeft (los días que faltan hasta closingDate) }.
// Lista vacía si no tiene ninguna.
async function findPendingScoresByTeacher(teacherId, institutionId) {
  const { rows } = await query(FIND_PENDING_SCORES_BY_TEACHER_SQL, [teacherId, institutionId]);
  return rows.map((row) => ({
    id: row.evaluacion_id,
    title: row.titulo,
    evaluationDate: row.fecha_evaluacion,
    term: row.trimestre,
    teacherAssignmentId: row.asignacion_docente_id,
    course: new Course({
      id: row.curso_id,
      gradeName: row.grado_nombre,
      educationLevel: EDUCATION_LEVEL_BY_COLUMN_VALUE[row.nivel_educativo],
      division: row.division,
      shift: SHIFT_BY_COLUMN_VALUE[row.turno],
      schoolYear: row.anio_ciclo_lectivo,
    }),
    subject: new Subject({
      id: row.materia_id,
      name: row.materia_nombre,
    }),
    pendingCount: row.pendientes,
    studentCount: row.alumnos,
    closingDate: row.fecha_cierre,
    daysLeft: row.dias_restantes,
  }));
}

// true si `error` es la violación del índice único de evaluacion: la asignación ya tiene otra
// evaluación vigente con ese título.
function isDuplicateError(error) {
  return error?.code === '23505' && error.constraint === UNIQUE_INDEX;
}

// true si `error` indica que el año de la fecha no es el ciclo lectivo del curso de la asignación.
function isDateOutOfSchoolYearError(error) {
  return error?.code === '23514' && error.constraint === SCHOOL_YEAR_CONSTRAINT;
}

// true si `error` indica que el curso de la asignación es de un ciclo lectivo cerrado: ese ciclo
// queda en solo lectura.
function isClosedSchoolYearError(error) {
  return error?.code === '23514' && error.constraint === CLOSED_SCHOOL_YEAR_CONSTRAINT;
}

// true si `error` indica que la asignación está dada de baja: en ella ya no se crean ni se editan
// evaluaciones.
function isDeletedAssignmentError(error) {
  return error?.code === '23514' && error.constraint === NOT_DELETED_ASSIGNMENT_CONSTRAINT;
}

// true si `error` indica que la evaluación tiene calificaciones vigentes y la fecha nueva es futura:
// una evaluación calificada ya se tomó.
function isFutureWithScoresError(error) {
  return error?.code === '23514' && error.constraint === FUTURE_WITH_SCORES_CONSTRAINT;
}

// true si `error` indica que la evaluación tiene calificaciones vigentes de inscripciones
// finalizadas: son histórico y tienen que seguir visibles en la evaluación, así que no se da de baja.
function isCompletedScoresError(error) {
  return error?.code === '23514' && error.constraint === COMPLETED_SCORES_CONSTRAINT;
}

// true si `error` indica que la fecha de la evaluación, la que tenía o la nueva, es de un trimestre
// cerrado: esa evaluación es de solo lectura y ninguna pasa a una fecha de ese trimestre.
function isClosedTermError(error) {
  return error?.code === '23514' && error.constraint === CLOSED_TERM_CONSTRAINT;
}

// true si `error` indica que la evaluación tiene calificaciones vigentes de una inscripción con una
// fecha de inscripción posterior a la fecha nueva: no se califica una evaluación anterior a la
// inscripción.
function isBeforeEnrollmentWithScoresError(error) {
  return error?.code === '23514' && error.constraint === BEFORE_ENROLLMENT_WITH_SCORES_CONSTRAINT;
}

module.exports = {
  findByTeacherAssignment,
  findActiveByIdAndTeacherAssignment,
  create,
  update,
  markAsDeleted,
  findPendingScoresByTeacher,
  isDuplicateError,
  isDateOutOfSchoolYearError,
  isClosedSchoolYearError,
  isDeletedAssignmentError,
  isFutureWithScoresError,
  isCompletedScoresError,
  isClosedTermError,
  isBeforeEnrollmentWithScoresError,
};
