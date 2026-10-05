const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const teacherAssignmentService = require('../services/teacher-assignment.service');

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listTeacherAssignments(currentUser) {
  try {
    return {
      ok: true,
      teacherAssignments: await teacherAssignmentService.listTeacherAssignments(currentUser),
    };
  } catch (error) {
    console.error('Error al listar las asignaciones docentes:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las asignaciones docentes. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerTeacherAssignmentHandlers(browserWindow) {
  handleProtected(browserWindow, 'teacher-assignments:list', ['ADMIN'], listTeacherAssignments);
}

module.exports = { registerTeacherAssignmentHandlers };
