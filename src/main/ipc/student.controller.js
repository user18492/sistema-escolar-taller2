const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const studentService = require('../services/student.service');

const { StudentError } = studentService;

// Campos de texto del formulario de alumno que llegan en el alta; el servicio valida su contenido.
const STUDENT_TEXT_FIELDS = ['firstName', 'lastName', 'dni', 'email', 'phone', 'street', 'streetNumber', 'birthDate'];

// Un objeto con todos los campos de texto como strings. Si trae otros campos (p. ej., `status`), el
// servicio no los usa.
function isStudentData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    STUDENT_TEXT_FIELDS.every((field) => typeof value[field] === 'string')
  );
}

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listStudents(currentUser) {
  try {
    return { ok: true, students: await studentService.listStudents(currentUser) };
  } catch (error) {
    console.error('Error al listar los alumnos:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los alumnos. Intentá nuevamente.');
  }
}

// Nunca rechaza: los errores previstos llevan su mensaje y sus fieldErrors, y el resto, uno genérico
// con el detalle en la consola.
async function createStudent(currentUser, data) {
  if (!isStudentData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return { ok: true, student: await studentService.createStudent(currentUser, data) };
  } catch (error) {
    if (error instanceof StudentError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al crear el alumno:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo crear el alumno. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerStudentHandlers(browserWindow) {
  handleProtected(browserWindow, 'students:list', ['SECRETARIO'], listStudents);
  handleProtected(browserWindow, 'students:create', ['SECRETARIO'], createStudent);
}

module.exports = { registerStudentHandlers };
