const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const courseService = require('../services/course.service');

const { CourseError } = courseService;

// Rango de grado.grado_id (INT): fuera de él, PostgreSQL rechazaría el parámetro.
const MAX_GRADE_ID = 2 ** 31 - 1;

function isGradeId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_GRADE_ID;
}

// Un objeto con `gradeId` (un grado_id) y con `division` y `shift` como strings; el servicio valida
// su contenido. Si trae otros campos, el servicio no los usa.
function isCourseData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isGradeId(value.gradeId) &&
    typeof value.division === 'string' &&
    typeof value.shift === 'string'
  );
}

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listCourses(currentUser) {
  try {
    return { ok: true, courses: await courseService.listCourses(currentUser) };
  } catch (error) {
    console.error('Error al listar los cursos:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los cursos. Intentá nuevamente.');
  }
}

// Nunca rechaza: los errores previstos llevan su mensaje (y fieldErrors, si son de un campo) y el
// resto, uno genérico con el detalle en la consola.
async function createCourse(currentUser, data) {
  if (!isCourseData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return { ok: true, course: await courseService.createCourse(currentUser, data) };
  } catch (error) {
    if (error instanceof CourseError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al crear el curso:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo crear el curso. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerCourseHandlers(browserWindow) {
  handleProtected(browserWindow, 'courses:list', ['ADMIN'], listCourses);
  handleProtected(browserWindow, 'courses:create', ['ADMIN'], createCourse);
}

module.exports = { registerCourseHandlers };
