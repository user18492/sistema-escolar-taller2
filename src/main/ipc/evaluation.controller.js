const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const evaluationService = require('../services/evaluation.service');
const { TeacherAssignmentError } = require('../services/teacher-assignment.service');

const { EvaluationError } = evaluationService;

// Rango de asignacion_docente.asignacion_docente_id (INT): fuera de él, PostgreSQL rechazaría el
// parámetro.
const MAX_ID = 2 ** 31 - 1;

function isId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_ID;
}

// Un objeto con `title` y `evaluationDate` como strings; el servicio valida su contenido. Si trae
// otros campos, el servicio no los usa.
function isEvaluationData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.title === 'string' &&
    typeof value.evaluationDate === 'string'
  );
}

// `teacherAssignmentId` es el id de una asignación del profesor de la sesión: que esté a su cargo
// lo comprueba el servicio.
// Nunca rechaza: los errores previstos (los de la asignación) llevan su mensaje y el resto, uno
// genérico con el detalle en la consola.
async function listOwnAssignmentEvaluations(currentUser, teacherAssignmentId) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  try {
    return {
      ok: true,
      evaluations: await evaluationService.listOwnAssignmentEvaluations(currentUser, teacherAssignmentId),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al listar las evaluaciones de la asignación:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las evaluaciones. Intentá nuevamente.');
  }
}

// `teacherAssignmentId` es el id de la asignación del profesor de la sesión donde se crea la
// evaluación: que esté a su cargo lo comprueba el servicio.
// Nunca rechaza: los errores previstos (los de la asignación y los de la evaluación) llevan su
// mensaje (y fieldErrors, si son de un campo) y el resto, uno genérico con el detalle en la consola.
async function createOwnAssignmentEvaluation(currentUser, teacherAssignmentId, data) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  if (!isEvaluationData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return {
      ok: true,
      evaluation: await evaluationService.createOwnAssignmentEvaluation(currentUser, teacherAssignmentId, data),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError || error instanceof EvaluationError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al crear la evaluación:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo crear la evaluación. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerEvaluationHandlers(browserWindow) {
  handleProtected(browserWindow, 'evaluations:list-by-own-assignment', ['PROFESOR'], listOwnAssignmentEvaluations);
  handleProtected(browserWindow, 'evaluations:create', ['PROFESOR'], createOwnAssignmentEvaluation);
}

module.exports = { registerEvaluationHandlers };
