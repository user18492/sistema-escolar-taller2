const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const enrollmentService = require('../services/enrollment.service');
const { TeacherAssignmentError } = require('../services/teacher-assignment.service');

const { EnrollmentError } = enrollmentService;

// Rango de los ids (INT) de asignacion_docente, inscripcion, alumno y curso: fuera de él, PostgreSQL
// rechazaría el parámetro. También acota la página que se pide.
const MAX_ID = 2 ** 31 - 1;

// Filas por página que admite el listado: la tabla pide 10.
const MAX_PAGE_SIZE = 100;

function isId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_ID;
}

const isString = (value) => typeof value === 'string';
const isGrade = (value) =>
  typeof value === 'object' && value !== null && isString(value.educationLevel) && isString(value.gradeName);

// Lo que tiene que ser cada elemento de los arreglos de filtros; que los valores existan lo
// comprueba el servicio.
const FILTER_ITEM_CHECKS = {
  enrollmentIds: isId,
  studentIds: isId,
  grades: isGrade,
  divisions: isString,
  shifts: isString,
  statuses: isString,
};

// Un objeto con los seis filtros, cada uno un arreglo (vacío si no filtra) con elementos de su tipo.
function isEnrollmentFilters(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(FILTER_ITEM_CHECKS).every(([filter, isItem]) => Array.isArray(value[filter]) && value[filter].every(isItem))
  );
}

function isPageSize(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_PAGE_SIZE;
}

// Un objeto con `studentId` (un alumno_id), `educationLevel` (un string) y `courseId` (un curso_id):
// que el nivel sea válido y que el alumno y el curso se puedan inscribir lo comprueba el servicio.
// Si trae otros campos (p. ej., un estado o una fecha), el servicio no los usa.
function isEnrollmentData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isId(value.studentId) &&
    isString(value.educationLevel) &&
    isId(value.courseId)
  );
}

// `enrollmentId` es el id de una inscripción cuya página se pide en lugar de `page` (la recién
// creada), o null.
// Nunca rechaza: los errores previstos (filtros con valores inválidos) llevan su mensaje y el
// resto, uno genérico con el detalle en la consola.
async function listEnrollments(currentUser, filters, page, pageSize, enrollmentId = null) {
  if (
    !isEnrollmentFilters(filters) ||
    !isId(page) ||
    !isPageSize(pageSize) ||
    (enrollmentId !== null && !isId(enrollmentId))
  ) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return {
      ok: true,
      ...(await enrollmentService.listEnrollments(currentUser, filters, page, pageSize, enrollmentId)),
    };
  } catch (error) {
    if (error instanceof EnrollmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al listar las inscripciones:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las inscripciones. Intentá nuevamente.');
  }
}

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listEnrollmentFilterOptions(currentUser) {
  try {
    return { ok: true, ...(await enrollmentService.listEnrollmentFilterOptions(currentUser)) };
  } catch (error) {
    console.error('Error al listar las opciones de los filtros de inscripciones:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las opciones de los filtros. Intentá nuevamente.');
  }
}

// Nunca rechaza, como listEnrollmentFilterOptions.
async function listEnrollableStudents(currentUser) {
  try {
    return { ok: true, students: await enrollmentService.listEnrollableStudents(currentUser) };
  } catch (error) {
    console.error('Error al listar los alumnos para una inscripción:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los alumnos. Intentá nuevamente.');
  }
}

// Nunca rechaza, como listEnrollmentFilterOptions.
async function listEnrollableCourses(currentUser) {
  try {
    return { ok: true, courses: await enrollmentService.listEnrollableCourses(currentUser) };
  } catch (error) {
    console.error('Error al listar los cursos para una inscripción:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los cursos. Intentá nuevamente.');
  }
}

// Nunca rechaza: los errores previstos (datos inválidos, alumno o curso que no se pueden elegir,
// restricciones de la base) llevan su mensaje y el resto, uno genérico con el detalle en la consola.
async function createEnrollment(currentUser, data) {
  if (!isEnrollmentData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return { ok: true, enrollment: await enrollmentService.createEnrollment(currentUser, data) };
  } catch (error) {
    if (error instanceof EnrollmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al crear la inscripción:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo crear la inscripción. Intentá nuevamente.');
  }
}

// `teacherAssignmentId` es el id de una asignación del profesor de la sesión: que esté a su cargo
// lo comprueba el servicio.
// Nunca rechaza: los errores previstos (los de la asignación) llevan su mensaje y el resto, uno
// genérico con el detalle en la consola.
async function listOwnAssignmentEnrollments(currentUser, teacherAssignmentId) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  try {
    return {
      ok: true,
      enrollments: await enrollmentService.listOwnAssignmentEnrollments(currentUser, teacherAssignmentId),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al listar las inscripciones del curso de la asignación:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los alumnos. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerEnrollmentHandlers(browserWindow) {
  handleProtected(browserWindow, 'enrollments:list', ['SECRETARIO'], listEnrollments);
  handleProtected(browserWindow, 'enrollments:list-filter-options', ['SECRETARIO'], listEnrollmentFilterOptions);
  handleProtected(browserWindow, 'enrollments:list-enrollable-students', ['SECRETARIO'], listEnrollableStudents);
  handleProtected(browserWindow, 'enrollments:list-enrollable-courses', ['SECRETARIO'], listEnrollableCourses);
  handleProtected(browserWindow, 'enrollments:create', ['SECRETARIO'], createEnrollment);
  handleProtected(browserWindow, 'enrollments:list-by-own-assignment', ['PROFESOR'], listOwnAssignmentEnrollments);
}

module.exports = { registerEnrollmentHandlers };
