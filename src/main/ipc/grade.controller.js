const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const gradeService = require('../services/grade.service');

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
// El catálogo es global: no depende de la institución del usuario de la sesión.
async function listGrades() {
  try {
    return { ok: true, grades: await gradeService.listGrades() };
  } catch (error) {
    console.error('Error al listar los grados:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los grados. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerGradeHandlers(browserWindow) {
  handleProtected(browserWindow, 'grades:list', ['ADMIN'], listGrades);
}

module.exports = { registerGradeHandlers };
