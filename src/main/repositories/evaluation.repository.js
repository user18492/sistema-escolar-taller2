const { query } = require('../database/connection');
const { Evaluation } = require('../models/evaluation.model');

// Listado de las evaluaciones vigentes de una asignación docente (sin las dadas de baja).
// El orden es total: la fecha (la más antigua primero) y, entre las del mismo día, el título, que
// no se repite entre las vigentes de una asignación (uq_evaluacion_asignacion_docente_titulo,
// db/schema.sql), así dos consultas sobre los mismos datos dan siempre el mismo orden.
const FIND_BY_TEACHER_ASSIGNMENT_SQL = `
  SELECT e.evaluacion_id,
         e.asignacion_docente_id,
         e.titulo,
         e.fecha_evaluacion
    FROM evaluacion e
   WHERE e.asignacion_docente_id = $1
     AND e.fecha_eliminacion IS NULL
   ORDER BY e.fecha_evaluacion, e.titulo
`;

// Una evaluación vigente de una asignación docente: una de las que lista
// FIND_BY_TEACHER_ASSIGNMENT_SQL.
const FIND_ACTIVE_BY_ID_AND_TEACHER_ASSIGNMENT_SQL = `
  SELECT e.evaluacion_id,
         e.asignacion_docente_id,
         e.titulo,
         e.fecha_evaluacion
    FROM evaluacion e
   WHERE e.evaluacion_id = $1
     AND e.asignacion_docente_id = $2
     AND e.fecha_eliminacion IS NULL
`;

// Alta: una evaluación vigente de la asignación docente. Devuelve la fila creada.
const CREATE_SQL = `
  INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion)
  VALUES ($1, $2, $3)
  RETURNING evaluacion_id, asignacion_docente_id, titulo, fecha_evaluacion
`;

// Índice único y restricción de evaluacion (con los nombres que les da db/schema.sql) que rechazan
// un alta por un motivo previsto: la asignación ya tiene una evaluación vigente con ese título, o
// la fecha no es del ciclo lectivo de su curso (la informa trg_evaluacion_fecha_ciclo_lectivo).
// PostgreSQL informa el nombre del índice como el de una restricción.
const UNIQUE_INDEX = 'uq_evaluacion_asignacion_docente_titulo';
const SCHOOL_YEAR_CONSTRAINT = 'ck_evaluacion_fecha_ciclo_lectivo';

function toEvaluation(row) {
  return new Evaluation({
    id: row.evaluacion_id,
    teacherAssignmentId: row.asignacion_docente_id,
    title: row.titulo,
    evaluationDate: row.fecha_evaluacion,
  });
}

// Evaluaciones vigentes de la asignación docente `teacherAssignmentId` (un asignacion_docente_id),
// ordenadas por fecha. Que la asignación se pueda consultar lo comprueba el servicio.
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
// título (isDuplicateError) o si la fecha no es del ciclo lectivo de su curso
// (isDateOutOfSchoolYearError). Que la asignación se pueda usar y que los datos sean válidos lo
// comprueba el servicio.
async function create(teacherAssignmentId, { title, evaluationDate }) {
  const { rows } = await query(CREATE_SQL, [teacherAssignmentId, title, evaluationDate]);
  return toEvaluation(rows[0]);
}

// true si `error` es la violación del índice único de evaluacion: la asignación ya tiene una
// evaluación vigente con ese título.
function isDuplicateError(error) {
  return error?.code === '23505' && error.constraint === UNIQUE_INDEX;
}

// true si `error` indica que el año de la fecha no es el ciclo lectivo del curso de la asignación.
function isDateOutOfSchoolYearError(error) {
  return error?.code === '23514' && error.constraint === SCHOOL_YEAR_CONSTRAINT;
}

module.exports = {
  findByTeacherAssignment,
  findActiveByIdAndTeacherAssignment,
  create,
  isDuplicateError,
  isDateOutOfSchoolYearError,
};
