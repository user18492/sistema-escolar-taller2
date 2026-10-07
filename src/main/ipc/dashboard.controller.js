const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const dashboardService = require('../services/dashboard.service');

// Nunca rechaza: si una consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function getAdminSummary(currentUser) {
  try {
    return { ok: true, summary: await dashboardService.getAdminSummary(currentUser) };
  } catch (error) {
    console.error('Error al obtener los indicadores del inicio:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los indicadores. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerDashboardHandlers(browserWindow) {
  handleProtected(browserWindow, 'dashboard:get-admin-summary', ['ADMIN'], getAdminSummary);
}

module.exports = { registerDashboardHandlers };
