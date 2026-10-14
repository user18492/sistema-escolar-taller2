const { query } = require('../database/connection');
const { Score } = require('../models/score.model');

// Calificaciones vigentes de una evaluación (sin las dadas de baja): una fila por cada inscripción
// que tiene nota. Las inscripciones del curso que todavía no fueron calificadas, o cuya
// calificación se dio de baja, no tienen fila.
const FIND_BY_EVALUATION_SQL = `
  SELECT ca.calificacion_id,
         ca.evaluacion_id,
         ca.inscripcion_id,
         ca.nota
    FROM calificacion ca
   WHERE ca.evaluacion_id = $1
     AND ca.fecha_eliminacion IS NULL
`;

// Alta: la nota de una inscripción que no tiene una calificación vigente en la evaluación. Devuelve
// la fila creada.
const CREATE_SQL = `
  INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota)
  VALUES ($1, $2, $3)
  RETURNING calificacion_id, evaluacion_id, inscripcion_id, nota
`;

// Corrección: cambia la nota de la calificación vigente de esa inscripción en esa evaluación
// (uq_calificacion_evaluacion_inscripcion: hay una sola). Las dadas de baja no se tocan. Devuelve
// la fila como quedó.
const UPDATE_SQL = `
  UPDATE calificacion
     SET nota = $3
   WHERE evaluacion_id = $1
     AND inscripcion_id = $2
     AND fecha_eliminacion IS NULL
  RETURNING calificacion_id, evaluacion_id, inscripcion_id, nota
`;

// Baja lógica: la fila se conserva con su última nota y la fecha de baja. Solo marca la
// calificación vigente de esa inscripción en esa evaluación, así una segunda baja (repetida o
// simultánea) no pisa la fecha de la primera. Devuelve la fila.
const MARK_AS_DELETED_SQL = `
  UPDATE calificacion
     SET fecha_eliminacion = NOW()
   WHERE evaluacion_id = $1
     AND inscripcion_id = $2
     AND fecha_eliminacion IS NULL
  RETURNING calificacion_id, evaluacion_id, inscripcion_id, nota
`;

// Restricciones de calificacion, con los nombres que les da db/schema.sql. Las dos últimas las
// informa trg_calificacion_coherencia, al cargar una nota, al corregirla y al darla de baja.
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

// Calificaciones vigentes de la evaluación `evaluationId` (un evaluacion_id), sin un orden
// definido. Que la evaluación se pueda consultar lo comprueba el servicio.
async function findByEvaluation(evaluationId) {
  const { rows } = await query(FIND_BY_EVALUATION_SQL, [evaluationId]);
  return rows.map(toScore);
}

// Carga la nota `value` de la inscripción `enrollmentId` (un inscripcion_id) en la evaluación
// `evaluationId` y devuelve la calificación creada. PostgreSQL rechaza el alta si la inscripción ya
// tiene una calificación vigente en esa evaluación (isDuplicateError; una dada de baja no cuenta),
// si no es del curso de la evaluación (isEnrollmentNotInCourseError) o si no está activa
// (isEnrollmentNotActiveError). Que la evaluación se pueda calificar y que la nota sea válida lo
// comprueba el servicio.
async function create(evaluationId, enrollmentId, value) {
  const { rows } = await query(CREATE_SQL, [evaluationId, enrollmentId, value]);
  return toScore(rows[0]);
}

// Cambia por `value` la nota de la calificación vigente que la inscripción `enrollmentId` tiene en
// la evaluación `evaluationId` y la devuelve como quedó; null si no tiene ninguna (todavía no fue
// calificada o su calificación se dio de baja). PostgreSQL rechaza el cambio si la inscripción dejó
// de estar activa (isEnrollmentNotActiveError). Lo demás lo comprueba el servicio, como en create.
async function update(evaluationId, enrollmentId, value) {
  const { rows } = await query(UPDATE_SQL, [evaluationId, enrollmentId, value]);
  return rows.length > 0 ? toScore(rows[0]) : null;
}

// Da de baja la calificación vigente que la inscripción `enrollmentId` tiene en la evaluación
// `evaluationId`: deja de listarse y de contar para el índice único, así que a la inscripción se le
// puede cargar otra nota en esa evaluación. Devuelve la calificación dada de baja, con la nota que
// tenía; null si la inscripción no tiene ninguna vigente (nunca la tuvo o ya se dio de baja).
// PostgreSQL rechaza la baja si la inscripción dejó de estar activa (isEnrollmentNotActiveError).
// Que la evaluación se pueda calificar lo comprueba el servicio.
async function markAsDeleted(evaluationId, enrollmentId) {
  const { rows } = await query(MARK_AS_DELETED_SQL, [evaluationId, enrollmentId]);
  return rows.length > 0 ? toScore(rows[0]) : null;
}

// true si `error` es la violación del índice único de calificacion: la inscripción ya tiene una
// calificación vigente en esa evaluación. PostgreSQL informa el nombre del índice como el de una
// restricción.
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

// true si `error` indica que la inscripción no está activa (fue finalizada o cancelada): sus
// calificaciones se conservan, pero no se cargan, no se corrigen ni se dan de baja.
function isEnrollmentNotActiveError(error) {
  return error?.code === '23514' && error.constraint === ACTIVE_ENROLLMENT_CONSTRAINT;
}

module.exports = {
  findByEvaluation,
  create,
  update,
  markAsDeleted,
  isDuplicateError,
  isEnrollmentNotInCourseError,
  isEnrollmentNotActiveError,
};
