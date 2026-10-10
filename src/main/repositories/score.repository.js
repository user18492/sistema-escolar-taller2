const { query } = require('../database/connection');
const { Score } = require('../models/score.model');

// Calificaciones cargadas de una evaluación: una fila por cada inscripción que ya tiene nota. Las
// inscripciones del curso que todavía no fueron calificadas no tienen fila.
const FIND_BY_EVALUATION_SQL = `
  SELECT ca.calificacion_id,
         ca.evaluacion_id,
         ca.inscripcion_id,
         ca.nota
    FROM calificacion ca
   WHERE ca.evaluacion_id = $1
`;

// Alta: la primera nota de una inscripción en una evaluación. Devuelve la fila creada.
const CREATE_SQL = `
  INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota)
  VALUES ($1, $2, $3)
  RETURNING calificacion_id, evaluacion_id, inscripcion_id, nota
`;

// Corrección: cambia la nota de la fila que ya existe para esa evaluación y esa inscripción
// (uq_calificacion_evaluacion_inscripcion: hay una sola). Devuelve la fila como quedó.
const UPDATE_SQL = `
  UPDATE calificacion
     SET nota = $3
   WHERE evaluacion_id = $1
     AND inscripcion_id = $2
  RETURNING calificacion_id, evaluacion_id, inscripcion_id, nota
`;

// Restricciones de calificacion, con los nombres que les da db/schema.sql. Las dos últimas las
// informa trg_calificacion_coherencia, al cargar una nota y al corregirla.
const UNIQUE_CONSTRAINT = 'uq_calificacion_evaluacion_inscripcion';
const ENROLLMENT_FOREIGN_KEY = 'fk_calificacion_inscripcion';
const SAME_COURSE_CONSTRAINT = 'ck_calificacion_mismo_curso';
const ACTIVE_ENROLLMENT_CONSTRAINT = 'ck_calificacion_inscripcion_activa';

// pg devuelve NUMERIC como texto ('7.25'): la nota se entrega como número.
function toScore(row) {
  return new Score({
    id: row.calificacion_id,
    evaluationId: row.evaluacion_id,
    enrollmentId: row.inscripcion_id,
    value: Number(row.nota),
  });
}

// Calificaciones cargadas de la evaluación `evaluationId` (un evaluacion_id), sin un orden
// definido. Que la evaluación se pueda consultar lo comprueba el servicio.
async function findByEvaluation(evaluationId) {
  const { rows } = await query(FIND_BY_EVALUATION_SQL, [evaluationId]);
  return rows.map(toScore);
}

// Carga la nota `value` de la inscripción `enrollmentId` (un inscripcion_id) en la evaluación
// `evaluationId` y devuelve la calificación creada. PostgreSQL rechaza el alta si la inscripción ya
// tiene una nota en esa evaluación (isDuplicateError), si no es del curso de la evaluación
// (isEnrollmentNotInCourseError) o si no está activa (isEnrollmentNotActiveError). Que la
// evaluación se pueda calificar y que la nota sea válida lo comprueba el servicio.
async function create(evaluationId, enrollmentId, value) {
  const { rows } = await query(CREATE_SQL, [evaluationId, enrollmentId, value]);
  return toScore(rows[0]);
}

// Cambia por `value` la nota que la inscripción `enrollmentId` ya tiene en la evaluación
// `evaluationId` y devuelve la calificación como quedó; null si todavía no tiene ninguna.
// PostgreSQL rechaza el cambio si la inscripción dejó de estar activa
// (isEnrollmentNotActiveError). Lo demás lo comprueba el servicio, como en create.
async function update(evaluationId, enrollmentId, value) {
  const { rows } = await query(UPDATE_SQL, [evaluationId, enrollmentId, value]);
  return rows.length > 0 ? toScore(rows[0]) : null;
}

// true si `error` es la violación de la restricción única de calificacion: la inscripción ya tiene
// una nota en esa evaluación.
function isDuplicateError(error) {
  return error?.code === '23505' && error.constraint === UNIQUE_CONSTRAINT;
}

// true si `error` indica que la inscripción no se puede calificar en esa evaluación porque no
// existe (la rechaza su clave foránea) o porque es de otro curso.
function isEnrollmentNotInCourseError(error) {
  return (
    (error?.code === '23503' && error.constraint === ENROLLMENT_FOREIGN_KEY) ||
    (error?.code === '23514' && error.constraint === SAME_COURSE_CONSTRAINT)
  );
}

// true si `error` indica que la inscripción no está activa (fue cancelada, finalizada o
// trasladada): sus calificaciones se conservan, pero no se cargan ni se corrigen.
function isEnrollmentNotActiveError(error) {
  return error?.code === '23514' && error.constraint === ACTIVE_ENROLLMENT_CONSTRAINT;
}

module.exports = {
  findByEvaluation,
  create,
  update,
  isDuplicateError,
  isEnrollmentNotInCourseError,
  isEnrollmentNotActiveError,
};
