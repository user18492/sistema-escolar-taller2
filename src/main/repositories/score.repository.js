const { query, runInTransaction } = require('../database/connection');
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

// Cantidad de calificaciones vigentes de cada evaluación vigente de una asignación docente, solo de
// las inscripciones que muestra Calificaciones: vigentes y activas o finalizadas (valores de
// inscripcion_estado.nombre), con el mismo criterio que FIND_ACTIVE_OR_FINISHED_BY_COURSE_SQL
// (enrollment.repository.js). No hace falta el curso: la inscripción es del de la asignación
// (trg_calificacion_coherencia, db/schema.sql). Una evaluación sin ninguna no tiene fila.
const COUNT_VISIBLE_BY_TEACHER_ASSIGNMENT_SQL = `
  SELECT ca.evaluacion_id,
         COUNT(*)::INT AS total
    FROM calificacion ca
    JOIN evaluacion e ON e.evaluacion_id = ca.evaluacion_id
    JOIN inscripcion i ON i.inscripcion_id = ca.inscripcion_id
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
   WHERE e.asignacion_docente_id = $1
     AND e.fecha_eliminacion IS NULL
     AND ca.fecha_eliminacion IS NULL
     AND i.fecha_eliminacion IS NULL
     AND ie.nombre IN ('ACTIVA', 'FINALIZADA')
   GROUP BY ca.evaluacion_id
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

// Restricciones de calificacion, con los nombres que les da db/schema.sql. Las del curso y de la
// inscripción (SAME_COURSE, NOT_DELETED_ENROLLMENT y ACTIVE_ENROLLMENT) las informa
// trg_calificacion_coherencia al cargar una nota, al corregirla y al darla de baja, y las de la
// evaluación (DELETED_EVALUATION y FUTURE_EVALUATION), solo al cargarla o corregirla. La del ciclo
// lectivo cerrado la informa trg_calificacion_ciclo_lectivo, en los tres casos. La baja en cascada
// de una evaluación (trg_evaluacion_baja_calificaciones) no pasa por acá: no mira si la inscripción
// está activa ni vigente, y su rechazo por una inscripción finalizada lo traduce
// evaluation.repository.js.
const UNIQUE_CONSTRAINT = 'uq_calificacion_evaluacion_inscripcion';
const ENROLLMENT_FOREIGN_KEY = 'fk_calificacion_inscripcion';
const CLOSED_SCHOOL_YEAR_CONSTRAINT = 'ck_calificacion_ciclo_lectivo_cerrado';
const SAME_COURSE_CONSTRAINT = 'ck_calificacion_mismo_curso';
const NOT_DELETED_ENROLLMENT_CONSTRAINT = 'ck_calificacion_inscripcion_vigente';
const ACTIVE_ENROLLMENT_CONSTRAINT = 'ck_calificacion_inscripcion_activa';
const DELETED_EVALUATION_CONSTRAINT = 'ck_calificacion_evaluacion_vigente';
const FUTURE_EVALUATION_CONSTRAINT = 'ck_calificacion_evaluacion_futura';

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

// Cuántas calificaciones vigentes tiene cada evaluación vigente de la asignación docente
// `teacherAssignmentId` (un asignacion_docente_id), contando solo las de inscripciones vigentes,
// activas o finalizadas: las que el profesor ve en Calificaciones. Devuelve un Map evaluacion_id →
// cantidad, sin las evaluaciones que no tienen ninguna. Que la asignación se pueda consultar lo
// comprueba el servicio.
async function countVisibleByTeacherAssignment(teacherAssignmentId) {
  const { rows } = await query(COUNT_VISIBLE_BY_TEACHER_ASSIGNMENT_SQL, [teacherAssignmentId]);
  return new Map(rows.map((row) => [row.evaluacion_id, row.total]));
}

// Carga la nota `value` de la inscripción `enrollmentId` (un inscripcion_id) en la evaluación
// `evaluationId` y devuelve la calificación creada. PostgreSQL rechaza el alta si la inscripción ya
// tiene una calificación vigente en esa evaluación (isDuplicateError; una dada de baja no cuenta),
// si no es del curso de la evaluación (isEnrollmentNotInCourseError), si está dada de baja
// (isEnrollmentDeletedError) o si no está activa (isEnrollmentNotActiveError), y también si la
// evaluación se dio de baja (isEvaluationDeletedError), si su fecha todavía no llegó
// (isFutureEvaluationError) o si es de un ciclo lectivo cerrado (isClosedSchoolYearError). Que la
// evaluación se pueda calificar y que la nota sea válida lo comprueba el servicio.
// `run` es la función con la que se ejecuta la consulta: `query` o, dentro de una transacción, la
// de runInTransaction (saveChanges); vale también para update y markAsDeleted.
async function create(evaluationId, enrollmentId, value, run = query) {
  const { rows } = await run(CREATE_SQL, [evaluationId, enrollmentId, value]);
  return toScore(rows[0]);
}

// Cambia por `value` la nota de la calificación vigente que la inscripción `enrollmentId` tiene en
// la evaluación `evaluationId` y la devuelve como quedó; null si no tiene ninguna (todavía no fue
// calificada o su calificación se dio de baja). PostgreSQL rechaza el cambio si la inscripción se
// dio de baja (isEnrollmentDeletedError) o dejó de estar activa (isEnrollmentNotActiveError), y si
// la evaluación se dio de baja (isEvaluationDeletedError), si su fecha todavía no llegó
// (isFutureEvaluationError) o si es de un ciclo lectivo cerrado (isClosedSchoolYearError). Lo demás
// lo comprueba el servicio, como en create.
async function update(evaluationId, enrollmentId, value, run = query) {
  const { rows } = await run(UPDATE_SQL, [evaluationId, enrollmentId, value]);
  return rows.length > 0 ? toScore(rows[0]) : null;
}

// Da de baja la calificación vigente que la inscripción `enrollmentId` tiene en la evaluación
// `evaluationId`: deja de listarse y de contar para el índice único, así que a la inscripción se le
// puede cargar otra nota en esa evaluación. Devuelve la calificación dada de baja, con la nota que
// tenía; null si la inscripción no tiene ninguna vigente (nunca la tuvo o ya se dio de baja).
// PostgreSQL rechaza la baja si la inscripción se dio de baja (isEnrollmentDeletedError) o dejó de
// estar activa (isEnrollmentNotActiveError), y si la evaluación es de un ciclo lectivo cerrado
// (isClosedSchoolYearError). Que la evaluación se pueda calificar lo comprueba el servicio.
async function markAsDeleted(evaluationId, enrollmentId, run = query) {
  const { rows } = await run(MARK_AS_DELETED_SQL, [evaluationId, enrollmentId]);
  return rows.length > 0 ? toScore(rows[0]) : null;
}

// Guarda la nota `value` de la inscripción `enrollmentId` en la evaluación `evaluationId` dentro de
// la transacción de `run`: si ya tiene una calificación vigente, se corrige esa fila (UPDATE); si no,
// se carga una (INSERT), aunque haya tenido otra que se dio de baja, que queda como está. Si otra
// sesión la cargó entre las dos consultas, PostgreSQL rechaza el alta por duplicada y entonces se
// corrige la fila que ya existe; si para entonces también la dio de baja, se carga una nueva. El
// alta va en un savepoint: el rechazo por duplicada no anula el resto de la transacción.
async function createOrUpdate(run, evaluationId, enrollmentId, value) {
  const updatedScore = await update(evaluationId, enrollmentId, value, run);
  if (updatedScore) return updatedScore;
  await run('SAVEPOINT calificacion_alta');
  try {
    const createdScore = await create(evaluationId, enrollmentId, value, run);
    await run('RELEASE SAVEPOINT calificacion_alta');
    return createdScore;
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
    await run('ROLLBACK TO SAVEPOINT calificacion_alta');
    return (
      (await update(evaluationId, enrollmentId, value, run)) ?? create(evaluationId, enrollmentId, value, run)
    );
  }
}

// Aplica en la evaluación `evaluationId`, en una sola transacción, los cambios `changes`
// ([{ enrollmentId, value }], uno por inscripción): con una nota, la guarda (createOrUpdate); con
// value null, da de baja la calificación vigente de la inscripción (markAsDeleted) y, si no tiene
// ninguna (nunca la tuvo o ya se dio de baja), no hace nada. O se guardan todos o ninguno: si
// PostgreSQL rechaza uno, se deshace la transacción y se relanza su error, con el enrollmentId del
// cambio rechazado en `error.enrollmentId`; los rechazos son los de create, update y markAsDeleted.
// Los cambios se aplican en el orden de las inscripciones, así dos guardados simultáneos toman los
// bloqueos de los triggers en el mismo orden. Devuelve [{ enrollmentId, value }] en ese orden, con
// cada nota como quedó guardada (null en las bajas). Que la evaluación se pueda calificar y que las
// notas sean válidas lo comprueba el servicio.
async function saveChanges(evaluationId, changes) {
  const orderedChanges = [...changes].sort((a, b) => a.enrollmentId - b.enrollmentId);
  return runInTransaction(async (run) => {
    const savedScores = [];
    for (const { enrollmentId, value } of orderedChanges) {
      try {
        if (value === null) {
          await markAsDeleted(evaluationId, enrollmentId, run);
          savedScores.push({ enrollmentId, value: null });
        } else {
          const score = await createOrUpdate(run, evaluationId, enrollmentId, value);
          savedScores.push({ enrollmentId: score.enrollmentId, value: score.value });
        }
      } catch (error) {
        error.enrollmentId = enrollmentId;
        throw error;
      }
    }
    return savedScores;
  });
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

// true si `error` indica que la inscripción está dada de baja (baja lógica), aunque siga activa:
// sus calificaciones se conservan, pero no se cargan, no se corrigen ni se dan de baja.
function isEnrollmentDeletedError(error) {
  return error?.code === '23514' && error.constraint === NOT_DELETED_ENROLLMENT_CONSTRAINT;
}

// true si `error` indica que la inscripción no está activa (fue finalizada o cancelada): sus
// calificaciones se conservan, pero no se cargan, no se corrigen ni se dan de baja.
function isEnrollmentNotActiveError(error) {
  return error?.code === '23514' && error.constraint === ACTIVE_ENROLLMENT_CONSTRAINT;
}

// true si `error` indica que el curso de la asignación de la evaluación es de un ciclo lectivo
// cerrado: sus calificaciones se conservan, pero no se cargan, no se corrigen ni se dan de baja.
function isClosedSchoolYearError(error) {
  return error?.code === '23514' && error.constraint === CLOSED_SCHOOL_YEAR_CONSTRAINT;
}

// true si `error` indica que la evaluación se dio de baja (baja lógica): sus calificaciones se
// dieron de baja con ella, y ya no se cargan ni se corrigen.
function isEvaluationDeletedError(error) {
  return error?.code === '23514' && error.constraint === DELETED_EVALUATION_CONSTRAINT;
}

// true si `error` indica que la fecha de la evaluación todavía no llegó: se califica a partir de ese
// día.
function isFutureEvaluationError(error) {
  return error?.code === '23514' && error.constraint === FUTURE_EVALUATION_CONSTRAINT;
}

module.exports = {
  findByEvaluation,
  countVisibleByTeacherAssignment,
  create,
  update,
  markAsDeleted,
  saveChanges,
  isDuplicateError,
  isEnrollmentNotInCourseError,
  isEnrollmentDeletedError,
  isEnrollmentNotActiveError,
  isClosedSchoolYearError,
  isEvaluationDeletedError,
  isFutureEvaluationError,
};
