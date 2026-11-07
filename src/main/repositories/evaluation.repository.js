const { query } = require('../database/connection');
const { Evaluation } = require('../models/evaluation.model');

// Columna trimestre_cerrado: si el trimestre de la evaluación está cerrado (fn_trimestre_cerrado,
// db/schema.sql), con su fecha (`dateColumn`) y la de la base. Lo calcula la base, que es la que
// rechaza después las escrituras en ese trimestre (trg_evaluacion_trimestre_cerrado).
const termClosedColumn = (dateColumn) =>
  `fn_trimestre_cerrado(EXTRACT(YEAR FROM ${dateColumn})::INT, fn_trimestre(${dateColumn})) AS trimestre_cerrado`;

// Listado de las evaluaciones vigentes de una asignación docente (sin las dadas de baja), con
// trimestre_cerrado. El orden es total: la fecha (la más antigua primero) y, entre las del mismo
// día, el título, que no se repite entre las vigentes de una asignación
// (uq_evaluacion_asignacion_docente_titulo, db/schema.sql), así dos consultas sobre los mismos datos
// dan siempre el mismo orden.
const FIND_BY_TEACHER_ASSIGNMENT_SQL = `
  SELECT e.evaluacion_id,
         e.asignacion_docente_id,
         e.titulo,
         e.fecha_evaluacion,
         ${termClosedColumn('e.fecha_evaluacion')}
    FROM evaluacion e
   WHERE e.asignacion_docente_id = $1
     AND e.fecha_eliminacion IS NULL
   ORDER BY e.fecha_evaluacion, e.titulo
`;

// Una evaluación vigente de una asignación docente: una de las que lista
// FIND_BY_TEACHER_ASSIGNMENT_SQL, también con trimestre_cerrado.
const FIND_ACTIVE_BY_ID_AND_TEACHER_ASSIGNMENT_SQL = `
  SELECT e.evaluacion_id,
         e.asignacion_docente_id,
         e.titulo,
         e.fecha_evaluacion,
         ${termClosedColumn('e.fecha_evaluacion')}
    FROM evaluacion e
   WHERE e.evaluacion_id = $1
     AND e.asignacion_docente_id = $2
     AND e.fecha_eliminacion IS NULL
`;

// Alta: una evaluación vigente de la asignación docente. Devuelve la fila creada, con
// trimestre_cerrado (como las de la edición y la baja).
const CREATE_SQL = `
  INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion)
  VALUES ($1, $2, $3)
  RETURNING evaluacion_id, asignacion_docente_id, titulo, fecha_evaluacion,
            ${termClosedColumn('fecha_evaluacion')}
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
            ${termClosedColumn('fecha_evaluacion')}
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
            ${termClosedColumn('fecha_evaluacion')}
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
    isTermClosed: row.trimestre_cerrado,
  });
}

// Evaluaciones vigentes de la asignación docente `teacherAssignmentId` (un asignacion_docente_id),
// ordenadas por fecha, con isTermClosed (la de toEvaluation, como en las demás funciones). Que la asignación se pueda consultar lo comprueba el servicio.
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
  isDuplicateError,
  isDateOutOfSchoolYearError,
  isClosedSchoolYearError,
  isDeletedAssignmentError,
  isFutureWithScoresError,
  isCompletedScoresError,
  isClosedTermError,
  isBeforeEnrollmentWithScoresError,
};
