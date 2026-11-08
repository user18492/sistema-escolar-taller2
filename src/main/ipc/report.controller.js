const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const reportService = require('../services/report.service');

const { ReportError } = reportService;

// Los filtros de un reporte llegan en un objeto; el servicio valida su contenido. Si trae otros
// campos, el servicio no los usa.
function isFilters(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Acción de un reporte: `getReport` recibe el usuario de la sesión y los filtros, y resuelve el
// reporte de su institución. `errorLabel` completa el mensaje de la consola.
// Nunca rechaza: los filtros inválidos responden INVALID_INPUT, y si una consulta falla, devuelve
// un mensaje genérico con el detalle en la consola.
function reportAction(getReport, errorLabel) {
  return async (currentUser, filters) => {
    if (!isFilters(filters)) {
      return failure('INVALID_INPUT', 'Los filtros enviados no son válidos.');
    }
    try {
      return { ok: true, report: await getReport(currentUser, filters) };
    } catch (error) {
      if (error instanceof ReportError) {
        return failure(error.code, error.message);
      }
      console.error(`Error al obtener el reporte ${errorLabel}:`, error);
      return failure('UNEXPECTED_ERROR', 'No se pudo cargar el reporte. Intentá nuevamente.');
    }
  };
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerReportHandlers(browserWindow) {
  handleProtected(browserWindow, 'reports:get-subject-coverage', ['ADMIN'],
    reportAction((currentUser, filters) => reportService.getSubjectCoverage(currentUser, filters), 'Materias sin docente por curso'));
}

module.exports = { registerReportHandlers };
