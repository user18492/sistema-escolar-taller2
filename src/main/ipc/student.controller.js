const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const studentService = require('../services/student.service');

const { StudentError } = studentService;

// Rango de alumno.alumno_id (INT): fuera de él, PostgreSQL rechazaría el parámetro.
const MAX_STUDENT_ID = 2 ** 31 - 1;

function isStudentId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_STUDENT_ID;
}

// Campos de texto del formulario de alumno que llegan en el alta y en la edición; el servicio valida
// su contenido.
const STUDENT_TEXT_FIELDS = ['firstName', 'lastName', 'dni', 'email', 'phone', 'street', 'streetNumber', 'birthDate'];

// Un objeto con todos los campos de texto como strings. Si trae otros campos (p. ej., `status` en el
// alta), el servicio no los usa.
function isStudentData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    STUDENT_TEXT_FIELDS.every((field) => typeof value[field] === 'string')
  );
}

// Al editar llega además `status` (string): el estado no se elige en el alta, que siempre registra
// al alumno activo. Que sea ACTIVE o GRADUATED lo comprueba el servicio.
function isStudentUpdateData(value) {
  return isStudentData(value) && typeof value.status === 'string';
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

// Nunca rechaza, como createStudent. Los errores previstos pueden traer fieldErrors.
async function updateStudent(currentUser, studentId, data) {
  if (!isStudentId(studentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar al alumno.');
  }
  if (!isStudentUpdateData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return { ok: true, student: await studentService.updateStudent(currentUser, studentId, data) };
  } catch (error) {
    if (error instanceof StudentError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al guardar el alumno:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron guardar los cambios. Intentá nuevamente.');
  }
}

// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en
// la consola.
async function deleteStudent(currentUser, studentId) {
  if (!isStudentId(studentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar al alumno.');
  }
  try {
    return { ok: true, ...(await studentService.deleteStudent(currentUser, studentId)) };
  } catch (error) {
    if (error instanceof StudentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al eliminar el alumno:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo eliminar el alumno. Intentá nuevamente.');
  }
}

// Nunca rechaza, como deleteStudent. DUPLICATE_VALUE llega sin fieldErrors: no hay un formulario
// donde marcarlos, y su mensaje ya dice qué dato se repite.
async function restoreStudent(currentUser, studentId) {
  if (!isStudentId(studentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar al alumno.');
  }
  try {
    return { ok: true, student: await studentService.restoreStudent(currentUser, studentId) };
  } catch (error) {
    if (error instanceof StudentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al restaurar el alumno:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo restaurar el alumno. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerStudentHandlers(browserWindow) {
  handleProtected(browserWindow, 'students:list', ['SECRETARIO'], listStudents);
  handleProtected(browserWindow, 'students:create', ['SECRETARIO'], createStudent);
  handleProtected(browserWindow, 'students:update', ['SECRETARIO'], updateStudent);
  handleProtected(browserWindow, 'students:delete', ['SECRETARIO'], deleteStudent);
  handleProtected(browserWindow, 'students:restore', ['SECRETARIO'], restoreStudent);
}

module.exports = { registerStudentHandlers };
