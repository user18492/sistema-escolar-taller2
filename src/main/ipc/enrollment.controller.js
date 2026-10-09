const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const enrollmentService = require('../services/enrollment.service');
const { TeacherAssignmentError } = require('../services/teacher-assignment.service');

// Rango de asignacion_docente.asignacion_docente_id (INT): fuera de él, PostgreSQL rechazaría el
// parámetro.
const MAX_ID = 2 ** 31 - 1;

function isId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_ID;
}

// `teacherAssignmentId` es el id de una asignación del profesor de la sesión: que esté a su cargo
// lo comprueba el servicio.
// Nunca rechaza: los errores previstos (los de la asignación) llevan su mensaje y el resto, uno
// genérico con el detalle en la consola.
async function listOwnAssignmentEnrollments(currentUser, teacherAssignmentId) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  try {
    return {
      ok: true,
      enrollments: await enrollmentService.listOwnAssignmentEnrollments(currentUser, teacherAssignmentId),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al listar las inscripciones del curso de la asignación:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los alumnos. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerEnrollmentHandlers(browserWindow) {
  handleProtected(browserWindow, 'enrollments:list-by-own-assignment', ['PROFESOR'], listOwnAssignmentEnrollments);
}

module.exports = { registerEnrollmentHandlers };
