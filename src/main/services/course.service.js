const courseRepository = require('../repositories/course.repository');

// Error previsto, con un mensaje apto para la UI (como UserError en user.service.js).
// `fieldErrors` ({ campo: mensaje }), si llega, indica qué campos del formulario están mal.
class CourseError extends Error {
  constructor(code, message, fieldErrors) {
    super(message);
    this.name = 'CourseError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

// ---------- Validación de los datos del formulario ----------

// Misma regla que field-validation.component.js (division), que el proceso principal no puede
// importar: si cambia allá, hay que cambiarla acá.
const REQUIRED_MESSAGE = 'Campo obligatorio.';
const DIVISION_PATTERN = /^[A-Za-z]$/;

// Recibe la división sin espacios alrededor.
function checkDivision(value) {
  if (!value) return REQUIRED_MESSAGE;
  return DIVISION_PATTERN.test(value) ? '' : 'La división debe ser una letra de A a Z.';
}

// Normaliza los datos del formulario (el controlador ya verificó que `gradeId` sea un id y que
// `division` y `shift` sean strings) y devuelve solo los campos que se guardan. Lanza un
// CourseError INVALID_INPUT: con fieldErrors si la división no es válida, y sin ellos si no lo es
// el turno, que no tiene un campo de texto donde mostrar el error. Que el grado exista lo
// comprueba la base al guardar.
function parseCourseData(data) {
  const division = data.division.trim();
  const divisionMessage = checkDivision(division);
  if (divisionMessage) {
    throw new CourseError('INVALID_INPUT', 'Revisá los datos marcados.', { division: divisionMessage });
  }
  if (!courseRepository.SHIFTS.includes(data.shift)) {
    throw new CourseError('INVALID_INPUT', 'Elegí un turno válido.');
  }
  // La división se guarda como una letra mayúscula (ck_curso_division, db/schema.sql).
  return { gradeId: data.gradeId, division: division.toUpperCase(), shift: data.shift };
}

// Llama a `save` (el INSERT o el UPDATE) y devuelve su resultado. Si PostgreSQL lo rechaza por un
// motivo previsto, lanza un CourseError: GRADE_NOT_FOUND si el grado no está en el catálogo y
// DUPLICATE_VALUE, con `duplicateMessage`, si la institución ya tiene otro curso vigente igual en
// ese ciclo lectivo.
async function saveCourse(save, duplicateMessage) {
  try {
    return await save();
  } catch (error) {
    if (courseRepository.isUnknownGradeError(error)) {
      throw new CourseError('GRADE_NOT_FOUND', 'El grado elegido no existe.');
    }
    if (courseRepository.isDuplicateError(error)) {
      throw new CourseError('DUPLICATE_VALUE', duplicateMessage);
    }
    throw error;
  }
}

// Error de una edición o una baja que no encontró el curso vigente: si existe en la institución es
// porque ya estaba dado de baja (COURSE_ALREADY_DELETED); si no, COURSE_NOT_FOUND.
async function notActiveError(courseId, institutionId) {
  if (await courseRepository.existsInInstitution(courseId, institutionId)) {
    return new CourseError('COURSE_ALREADY_DELETED', 'El curso ya había sido eliminado.');
  }
  return new CourseError('COURSE_NOT_FOUND', 'El curso ya no existe.');
}

// Lista explícita de campos, como toListedUser (user.service.js): lo que muestra la tabla de Cursos
// y el id para identificar la fila. `gradeName` es el valor de grado.nombre (1°, 2°, ... 6°),
// `educationLevel` PRIMARY o SECONDARY, `shift` MORNING o AFTERNOON y `schoolYear` el año del ciclo
// lectivo.
function toListedCourse(course) {
  return {
    id: course.id,
    gradeName: course.gradeName,
    educationLevel: course.educationLevel,
    division: course.division,
    shift: course.shift,
    schoolYear: course.schoolYear,
  };
}

// Cursos vigentes de la institución de `currentUser` (el de la sesión), de todos los ciclos
// lectivos, en el orden del repositorio.
async function listCourses(currentUser) {
  const courses = await courseRepository.findByInstitution(currentUser.institutionId);
  return courses.map(toListedCourse);
}

// Crea un curso en la institución de `currentUser` y lo devuelve con los campos de listCourses.
// `data` trae gradeId (un grado del catálogo, que define también el nivel educativo), division (una
// letra, que se guarda en mayúscula) y shift (MORNING o AFTERNOON). El ciclo lectivo no se elige:
// es siempre el año en curso, el mismo que anuncia el formulario.
// Lanza un CourseError si algún dato no es válido (INVALID_INPUT, con fieldErrors si es la
// división), si el grado no está en el catálogo (GRADE_NOT_FOUND) o si la institución ya tiene un
// curso vigente con ese grado, división y turno en el ciclo lectivo (DUPLICATE_VALUE): uno dado de
// baja no cuenta.
async function createCourse(currentUser, data) {
  const values = parseCourseData(data);
  const schoolYear = new Date().getFullYear();
  const course = await saveCourse(
    () => courseRepository.create(currentUser.institutionId, { ...values, schoolYear }),
    `Ya existe un curso con ese grado, división y turno en el ciclo lectivo ${schoolYear}.`
  );
  return toListedCourse(course);
}

// Guarda el grado, la división y el turno de un curso vigente de la institución de `currentUser` y
// lo devuelve como quedó, con los campos de listCourses. `data` trae los mismos campos que en
// createCourse. El ciclo lectivo no se edita: el curso conserva el suyo.
// Lanza un CourseError si algún dato no es válido (INVALID_INPUT, con fieldErrors si es la
// división), si el curso no existe en la institución (COURSE_NOT_FOUND) o fue dado de baja
// (COURSE_ALREADY_DELETED), si el grado no está en el catálogo (GRADE_NOT_FOUND) o si la
// institución ya tiene otro curso vigente con ese grado, división y turno en el mismo ciclo lectivo
// (DUPLICATE_VALUE): guardarlo sin cambios no es un duplicado y uno dado de baja no cuenta.
async function updateCourse(currentUser, courseId, data) {
  const values = parseCourseData(data);
  const course = await saveCourse(
    () => courseRepository.update(courseId, currentUser.institutionId, values),
    'Ya existe otro curso con ese grado, división y turno en el mismo ciclo lectivo.'
  );
  if (course) return toListedCourse(course);
  throw await notActiveError(courseId, currentUser.institutionId);
}

// Baja lógica de un curso de la institución de `currentUser`: la fila queda con su fecha de baja,
// deja de listarse y su grado, división y turno se pueden volver a crear en ese ciclo lectivo.
// Devuelve el curso dado de baja, con los campos de listCourses. Lanza un CourseError si no existe
// en la institución (COURSE_NOT_FOUND) o si ya estaba dado de baja (COURSE_ALREADY_DELETED).
async function deleteCourse(currentUser, courseId) {
  const deletedCourse = await courseRepository.markAsDeleted(courseId, currentUser.institutionId);
  if (deletedCourse) return toListedCourse(deletedCourse);
  throw await notActiveError(courseId, currentUser.institutionId);
}

module.exports = { listCourses, createCourse, updateCourse, deleteCourse, CourseError };
