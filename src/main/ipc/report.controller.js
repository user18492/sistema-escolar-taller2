const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const reportService = require('../services/report.service');
const reportCardService = require('../services/report-card.service');
const { PdfError } = require('../services/pdf.service');

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
function reportAction(getReport, errorLabel, fallbackMessage = 'No se pudo cargar el reporte. Intentá nuevamente.') {
  return async (currentUser, filters) => {
    if (!isFilters(filters)) {
      return failure('INVALID_INPUT', 'Los filtros enviados no son válidos.');
    }
    try {
      return { ok: true, report: await getReport(currentUser, filters) };
    } catch (error) {
      if (error instanceof ReportError || error instanceof PdfError) {
        return failure(error.code, error.message);
      }
      console.error(`Error en el reporte ${errorLabel}:`, error);
      return failure('UNEXPECTED_ERROR', fallbackMessage);
    }
  };
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerReportHandlers(browserWindow) {
  handleProtected(browserWindow, 'reports:get-subject-coverage', ['ADMIN'],
    reportAction((currentUser, filters) => reportService.getSubjectCoverage(currentUser, filters), 'Materias sin docente por curso'));
  handleProtected(browserWindow, 'reports:get-teacher-workload', ['ADMIN'],
    reportAction((currentUser, filters) => reportService.getTeacherWorkload(currentUser, filters), 'Carga docente por profesor'));
  handleProtected(browserWindow, 'reports:get-backup-regularity', ['ADMIN'],
    reportAction((currentUser, filters) => reportService.getBackupRegularity(currentUser, filters), 'Regularidad de los backups'));
  handleProtected(browserWindow, 'reports:get-active-enrollments-by-course', ['SECRETARIO'],
    reportAction((currentUser, filters) => reportService.getActiveEnrollmentsByCourse(currentUser, filters), 'Inscripciones activas por curso'));
  // Sin filtros: la vista filtra la lista completa (ver getStudentsWithoutEnrollment)
  handleProtected(browserWindow, 'reports:get-students-without-enrollment', ['SECRETARIO'],
    reportAction((currentUser) => reportService.getStudentsWithoutEnrollment(currentUser), 'Alumnos activos sin inscripción'));
  handleProtected(browserWindow, 'reports:get-report-card-courses', ['SECRETARIO'],
    reportAction(reportCardService.getReportCardCourses, 'Cursos para boletines'));
  handleProtected(browserWindow, 'reports:get-report-card-students', ['SECRETARIO'],
    reportAction(reportCardService.getReportCardStudents, 'Alumnos para boletines'));
  handleProtected(browserWindow, 'reports:open-report-cards', ['SECRETARIO'],
    reportAction(reportCardService.openReportCards, 'Boletines de calificaciones', 'No se pudo abrir el PDF de boletines. Intentá nuevamente.'));
  // Sin filtros: la vista filtra la lista completa (ver getPendingScores)
  handleProtected(browserWindow, 'reports:get-pending-scores', ['PROFESOR'],
    reportAction((currentUser) => reportService.getPendingScores(currentUser), 'Calificaciones pendientes de carga'));
  handleProtected(browserWindow, 'reports:get-evaluation-failure-rates', ['PROFESOR'],
    reportAction(reportService.getEvaluationFailureRates, 'Evaluaciones con alta desaprobación'));
}

module.exports = { registerReportHandlers };
