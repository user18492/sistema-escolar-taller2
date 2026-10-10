const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const scoreService = require('../services/score.service');
const { TeacherAssignmentError } = require('../services/teacher-assignment.service');
const { EvaluationError } = require('../services/evaluation.service');

const { ScoreError } = scoreService;

// Rango de asignacion_docente.asignacion_docente_id, evaluacion.evaluacion_id e
// inscripcion.inscripcion_id (INT): fuera de él, PostgreSQL rechazaría el parámetro.
const MAX_ID = 2 ** 31 - 1;

function isId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_ID;
}

// Un objeto con `enrollmentId` (un inscripcion_id) y con `value`, la nota, como número; el servicio
// valida su rango. Si trae otros campos, el servicio no los usa.
function isScoreData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isId(value.enrollmentId) &&
    typeof value.value === 'number'
  );
}

// Errores previstos de las dos operaciones: los de la asignación, los de la evaluación y los de la
// calificación.
function isExpectedError(error) {
  return error instanceof TeacherAssignmentError || error instanceof EvaluationError || error instanceof ScoreError;
}

// `teacherAssignmentId` es el id de una asignación del profesor de la sesión y `evaluationId`, el
// de una de sus evaluaciones: que la asignación esté a su cargo y que la evaluación sea de esa
// asignación lo comprueba el servicio.
// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en
// la consola.
async function listOwnEvaluationScores(currentUser, teacherAssignmentId, evaluationId) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  if (!isId(evaluationId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la evaluación.');
  }
  try {
    const { evaluation, scores } = await scoreService.listOwnEvaluationScores(
      currentUser,
      teacherAssignmentId,
      evaluationId
    );
    return { ok: true, evaluation, scores };
  } catch (error) {
    if (isExpectedError(error)) {
      return failure(error.code, error.message);
    }
    console.error('Error al listar las calificaciones de la evaluación:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las calificaciones. Intentá nuevamente.');
  }
}

// Nunca rechaza, como listOwnEvaluationScores.
async function saveOwnEvaluationScore(currentUser, teacherAssignmentId, evaluationId, data) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  if (!isId(evaluationId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la evaluación.');
  }
  if (!isScoreData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return {
      ok: true,
      score: await scoreService.saveOwnEvaluationScore(currentUser, teacherAssignmentId, evaluationId, data),
    };
  } catch (error) {
    if (isExpectedError(error)) {
      return failure(error.code, error.message);
    }
    console.error('Error al guardar la calificación:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo guardar la calificación. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerScoreHandlers(browserWindow) {
  handleProtected(browserWindow, 'scores:list-by-own-evaluation', ['PROFESOR'], listOwnEvaluationScores);
  handleProtected(browserWindow, 'scores:save', ['PROFESOR'], saveOwnEvaluationScore);
}

module.exports = { registerScoreHandlers };
