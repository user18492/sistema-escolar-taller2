const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const schoolYearService = require('../services/school-year.service');

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
// El ciclo lectivo es el mismo para todas las instituciones: no depende del usuario de la sesión.
async function getCurrentSchoolYear() {
  try {
    return { ok: true, schoolYear: await schoolYearService.getCurrentSchoolYear() };
  } catch (error) {
    console.error('Error al obtener el ciclo lectivo actual:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo obtener el ciclo lectivo actual. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerSchoolYearHandlers(browserWindow) {
  handleProtected(browserWindow, 'school-years:get-current', ['ADMIN', 'SECRETARIO', 'PROFESOR'], getCurrentSchoolYear);
}

module.exports = { registerSchoolYearHandlers };
