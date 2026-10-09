const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const teacherAssignmentService = require('../services/teacher-assignment.service');

const { TeacherAssignmentError } = teacherAssignmentService;

// Rango de asignacion_docente.asignacion_docente_id, usuario.usuario_id, curso.curso_id y
// materia.materia_id (INT): fuera de él, PostgreSQL rechazaría el parámetro.
const MAX_ID = 2 ** 31 - 1;

function isId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_ID;
}

// Un objeto con `teacherId` (un usuario_id), `courseId` (un curso_id) y `subjectId` (un
// materia_id); el servicio comprueba que se puedan asignar. Si trae otros campos, el servicio no
// los usa.
function isTeacherAssignmentData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isId(value.teacherId) &&
    isId(value.courseId) &&
    isId(value.subjectId)
  );
}

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listTeacherAssignments(currentUser) {
  try {
    return {
      ok: true,
      teacherAssignments: await teacherAssignmentService.listTeacherAssignments(currentUser),
    };
  } catch (error) {
    console.error('Error al listar las asignaciones docentes:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las asignaciones docentes. Intentá nuevamente.');
  }
}

// Nunca rechaza, como listTeacherAssignments. No recibe nada del renderer: el profesor es el de la
// sesión.
async function listOwnTeacherAssignments(currentUser) {
  try {
    return {
      ok: true,
      teacherAssignments: await teacherAssignmentService.listOwnTeacherAssignments(currentUser),
    };
  } catch (error) {
    console.error('Error al listar las asignaciones del profesor:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las asignaciones. Intentá nuevamente.');
  }
}

// `teacherAssignmentId` es el id de una asignación de listOwnTeacherAssignments: que esté a cargo
// del profesor de la sesión lo comprueba el servicio.
// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en
// la consola.
async function getOwnTeacherAssignment(currentUser, teacherAssignmentId) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  try {
    return {
      ok: true,
      teacherAssignment: await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al consultar la asignación del profesor:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo cargar la asignación. Intentá nuevamente.');
  }
}

// Nunca rechaza, como listTeacherAssignments.
async function listAssignableTeachers(currentUser) {
  try {
    return { ok: true, teachers: await teacherAssignmentService.listAssignableTeachers(currentUser) };
  } catch (error) {
    console.error('Error al listar los profesores para una asignación docente:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los profesores. Intentá nuevamente.');
  }
}

// Nunca rechaza, como listTeacherAssignments.
async function listAssignableCourses(currentUser) {
  try {
    return { ok: true, courses: await teacherAssignmentService.listAssignableCourses(currentUser) };
  } catch (error) {
    console.error('Error al listar los cursos para una asignación docente:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los cursos. Intentá nuevamente.');
  }
}

// `teacherAssignmentId` es el id de la asignación que se edita, o null en un alta.
// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en
// la consola.
async function listAssignableSubjects(currentUser, courseId, teacherAssignmentId = null) {
  if (!isId(courseId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar el curso.');
  }
  if (teacherAssignmentId !== null && !isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  try {
    return {
      ok: true,
      subjects: await teacherAssignmentService.listAssignableSubjects(currentUser, courseId, teacherAssignmentId),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al listar las materias para una asignación docente:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar las materias. Intentá nuevamente.');
  }
}

// Nunca rechaza: los errores previstos llevan su mensaje (y fieldErrors, si son de un campo) y el
// resto, uno genérico con el detalle en la consola.
async function createTeacherAssignment(currentUser, data) {
  if (!isTeacherAssignmentData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return {
      ok: true,
      teacherAssignment: await teacherAssignmentService.createTeacherAssignment(currentUser, data),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al crear la asignación docente:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo crear la asignación. Intentá nuevamente.');
  }
}

// Nunca rechaza, como createTeacherAssignment.
async function updateTeacherAssignment(currentUser, teacherAssignmentId, data) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  if (!isTeacherAssignmentData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return {
      ok: true,
      teacherAssignment: await teacherAssignmentService.updateTeacherAssignment(currentUser, teacherAssignmentId, data),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al guardar la asignación docente:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron guardar los cambios. Intentá nuevamente.');
  }
}

// Nunca rechaza, como createTeacherAssignment.
async function deleteTeacherAssignment(currentUser, teacherAssignmentId) {
  if (!isId(teacherAssignmentId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar la asignación.');
  }
  try {
    return {
      ok: true,
      teacherAssignment: await teacherAssignmentService.deleteTeacherAssignment(currentUser, teacherAssignmentId),
    };
  } catch (error) {
    if (error instanceof TeacherAssignmentError) {
      return failure(error.code, error.message);
    }
    console.error('Error al eliminar la asignación docente:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo eliminar la asignación. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerTeacherAssignmentHandlers(browserWindow) {
  handleProtected(browserWindow, 'teacher-assignments:list', ['ADMIN'], listTeacherAssignments);
  handleProtected(browserWindow, 'teacher-assignments:list-own', ['PROFESOR'], listOwnTeacherAssignments);
  handleProtected(browserWindow, 'teacher-assignments:get-own', ['PROFESOR'], getOwnTeacherAssignment);
  handleProtected(browserWindow, 'teacher-assignments:list-assignable-teachers', ['ADMIN'], listAssignableTeachers);
  handleProtected(browserWindow, 'teacher-assignments:list-assignable-courses', ['ADMIN'], listAssignableCourses);
  handleProtected(browserWindow, 'teacher-assignments:list-assignable-subjects', ['ADMIN'], listAssignableSubjects);
  handleProtected(browserWindow, 'teacher-assignments:create', ['ADMIN'], createTeacherAssignment);
  handleProtected(browserWindow, 'teacher-assignments:update', ['ADMIN'], updateTeacherAssignment);
  handleProtected(browserWindow, 'teacher-assignments:delete', ['ADMIN'], deleteTeacherAssignment);
}

module.exports = { registerTeacherAssignmentHandlers };
