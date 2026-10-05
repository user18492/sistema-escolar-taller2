const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const courseService = require('../services/course.service');

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listCourses(currentUser) {
  try {
    return { ok: true, courses: await courseService.listCourses(currentUser) };
  } catch (error) {
    console.error('Error al listar los cursos:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los cursos. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerCourseHandlers(browserWindow) {
  handleProtected(browserWindow, 'courses:list', ['ADMIN'], listCourses);
}

module.exports = { registerCourseHandlers };
