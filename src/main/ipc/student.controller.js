const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const studentService = require('../services/student.service');

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listStudents(currentUser) {
  try {
    return { ok: true, students: await studentService.listStudents(currentUser) };
  } catch (error) {
    console.error('Error al listar los alumnos:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los alumnos. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerStudentHandlers(browserWindow) {
  handleProtected(browserWindow, 'students:list', ['SECRETARIO'], listStudents);
}

module.exports = { registerStudentHandlers };
