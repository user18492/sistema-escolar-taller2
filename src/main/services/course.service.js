const courseRepository = require('../repositories/course.repository');
const schoolYearService = require('./school-year.service');

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

// Lo de un ciclo lectivo cerrado es de solo lectura: un curso de un ciclo anterior al actual no se
// edita ni se da de baja.
function closedSchoolYearError(schoolYear) {
  return new CourseError('SCHOOL_YEAR_CLOSED', schoolYearService.closedSchoolYearMessage(schoolYear));
}

// Lanza el CourseError SCHOOL_YEAR_CLOSED si `course` es de un ciclo lectivo cerrado. Se comprueba
// antes de escribir, para que gane a los demás errores; si el ciclo se cierra en el medio, la base
// rechaza la escritura y ese rechazo se traduce al mismo error.
async function assertSchoolYearNotClosed(course) {
  if (await schoolYearService.isClosedSchoolYear(course.schoolYear)) {
    throw closedSchoolYearError(course.schoolYear);
  }
}

// Un curso con asignaciones docentes vigentes o con inscripciones vigentes, en cualquier estado, no
// se edita ni se da de baja. Lo decide la base, que retiene la fila al modificarla, sin control
// previo: así tampoco pasa una edición o una baja simultánea con el alta de una asignación o de una
// inscripción. Devuelve el CourseError COURSE_IN_USE, sin fieldErrors, si `error` es uno de esos
// rechazos (`action` completa el mensaje: 'editar' o 'eliminar'); null si no.
function inUseError(error, action) {
  if (courseRepository.isWithTeacherAssignmentsError(error)) {
    return new CourseError('COURSE_IN_USE', `El curso tiene asignaciones docentes: no se puede ${action}.`);
  }
  if (courseRepository.isWithEnrollmentsError(error)) {
    return new CourseError('COURSE_IN_USE', `El curso tiene inscripciones: no se puede ${action}.`);
  }
  return null;
}

// Llama a `save` (el INSERT o el UPDATE) y devuelve su resultado. Si PostgreSQL lo rechaza por un
// motivo previsto, lanza un CourseError: GRADE_NOT_FOUND si el grado no está en el catálogo,
// DUPLICATE_VALUE, con `duplicateMessage`, si la institución ya tiene otro curso vigente igual en
// ese ciclo lectivo, SCHOOL_YEAR_CLOSED si el curso es de un ciclo lectivo cerrado (`schoolYear`,
// el del curso editado) y COURSE_IN_USE si tiene asignaciones docentes o inscripciones vigentes
// (ver inUseError). En un alta no pasan los dos últimos, porque el curso nuevo es del ciclo actual y
// no tiene nada.
async function saveCourse(save, duplicateMessage, schoolYear = null) {
  try {
    return await save();
  } catch (error) {
    if (courseRepository.isUnknownGradeError(error)) {
      throw new CourseError('GRADE_NOT_FOUND', 'El grado elegido no existe.');
    }
    if (courseRepository.isDuplicateError(error)) {
      throw new CourseError('DUPLICATE_VALUE', duplicateMessage);
    }
    if (courseRepository.isClosedSchoolYearError(error)) {
      throw closedSchoolYearError(schoolYear);
    }
    throw inUseError(error, 'editar') ?? error;
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

// El curso vigente con ese id de la institución, que se va a editar o dar de baja. El id llega del
// renderer y la fila que tiene a la vista puede haber quedado vieja, así que se busca de nuevo.
// Lanza el CourseError de notActiveError si no está vigente y SCHOOL_YEAR_CLOSED si es de un ciclo
// lectivo cerrado.
async function findEditableCourse(courseId, institutionId) {
  const course = await courseRepository.findActiveById(courseId, institutionId);
  if (!course) throw await notActiveError(courseId, institutionId);
  await assertSchoolYearNotClosed(course);
  return course;
}

// Lista explícita de campos, como toListedUser (user.service.js): lo que se muestra de un curso y el
// id para identificarlo. `gradeName` es el valor de grado.nombre (1°, 2°, ... 6°), `educationLevel`
// PRIMARY o SECONDARY, `shift` MORNING o AFTERNOON y `schoolYear` el año del ciclo lectivo. Lo usan
// también enrollment.service.js y teacher-assignment.service.js para el curso de sus filas; la tabla
// de Cursos usa toInstitutionCourse.
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

// Lo que muestra la tabla de Cursos: los campos de toListedCourse, más si el curso tiene
// asignaciones docentes vigentes (`hasTeacherAssignments`) y si tiene inscripciones vigentes, en
// cualquier estado (`hasEnrollments`): con alguno en true, no se edita ni se da de baja. Solo los
// calcula el listado de la institución; con las demás consultas llegan en false: un curso recién
// creado no tiene ninguno, y uno que se pudo editar o dar de baja tampoco, porque si no la base lo
// rechaza.
function toInstitutionCourse(course) {
  return {
    ...toListedCourse(course),
    hasTeacherAssignments: course.hasTeacherAssignments ?? false,
    hasEnrollments: course.hasEnrollments ?? false,
  };
}

// Cursos vigentes de la institución de `currentUser` (el de la sesión), de todos los ciclos
// lectivos, en el orden del repositorio, con hasTeacherAssignments y hasEnrollments.
async function listCourses(currentUser) {
  const courses = await courseRepository.findByInstitution(currentUser.institutionId);
  return courses.map(toInstitutionCourse);
}

// Crea un curso en la institución de `currentUser` y lo devuelve con los campos de listCourses.
// `data` trae gradeId (un grado del catálogo, que define también el nivel educativo), division (una
// letra, que se guarda en mayúscula) y shift (MORNING o AFTERNOON). El ciclo lectivo no se elige:
// es siempre el actual, que resuelve la base al guardar.
// Lanza un CourseError si algún dato no es válido (INVALID_INPUT, con fieldErrors si es la
// división), si el grado no está en el catálogo (GRADE_NOT_FOUND) o si la institución ya tiene un
// curso vigente con ese grado, división y turno en el ciclo lectivo (DUPLICATE_VALUE): uno dado de
// baja no cuenta.
async function createCourse(currentUser, data) {
  const values = parseCourseData(data);
  const { year } = await schoolYearService.getCurrentSchoolYear();
  const course = await saveCourse(
    () => courseRepository.create(currentUser.institutionId, values),
    `Ya existe un curso con ese grado, división y turno en el ciclo lectivo ${year}.`
  );
  return toInstitutionCourse(course);
}

// Guarda el grado, la división y el turno de un curso vigente de la institución de `currentUser` y
// lo devuelve como quedó, con los campos de listCourses. `data` trae los mismos campos que en
// createCourse. El ciclo lectivo no se edita: el curso conserva el suyo, y uno de un ciclo cerrado
// no se edita. Tampoco uno con asignaciones docentes vigentes o inscripciones vigentes, en cualquier
// estado, aunque se guarde sin cambios: las dadas de baja no cuentan.
// Lanza un CourseError si el curso no existe en la institución (COURSE_NOT_FOUND) o fue dado de
// baja (COURSE_ALREADY_DELETED), si es de un ciclo lectivo cerrado (SCHOOL_YEAR_CLOSED, que gana a
// los errores siguientes), si algún dato no es válido (INVALID_INPUT, con fieldErrors si es la
// división), si tiene asignaciones docentes o inscripciones vigentes (COURSE_IN_USE, sin
// fieldErrors, que gana a los dos siguientes: el trigger corre antes que el índice único y que la
// clave foránea), si el grado no está en el catálogo (GRADE_NOT_FOUND) o si la institución ya tiene
// otro curso vigente con ese grado, división y turno en el mismo ciclo lectivo (DUPLICATE_VALUE):
// guardarlo sin cambios no es un duplicado y uno dado de baja no cuenta.
async function updateCourse(currentUser, courseId, data) {
  const { institutionId } = currentUser;
  const currentCourse = await findEditableCourse(courseId, institutionId);
  const values = parseCourseData(data);
  const course = await saveCourse(
    () => courseRepository.update(courseId, institutionId, values),
    'Ya existe otro curso con ese grado, división y turno en el mismo ciclo lectivo.',
    currentCourse.schoolYear
  );
  if (course) return toInstitutionCourse(course);
  // El UPDATE no modificó nada: otra sesión dio de baja el curso después de consultarlo.
  throw await notActiveError(courseId, institutionId);
}

// Baja lógica de un curso de la institución de `currentUser`: la fila queda con su fecha de baja,
// deja de listarse y su grado, división y turno se pueden volver a crear en ese ciclo lectivo. La
// baja es definitiva: el curso ya no se modifica, no se restaura y no recibe asignaciones docentes
// ni inscripciones. Uno de un ciclo cerrado no se da de baja, y tampoco uno con asignaciones
// docentes vigentes o inscripciones vigentes, en cualquier estado: las dadas de baja no cuentan.
// Devuelve el curso dado de baja, con los campos de listCourses. Lanza un CourseError si no existe
// en la institución (COURSE_NOT_FOUND), si ya estaba dado de baja (COURSE_ALREADY_DELETED), si es
// de un ciclo lectivo cerrado (SCHOOL_YEAR_CLOSED) o si tiene asignaciones docentes o inscripciones
// vigentes (COURSE_IN_USE, sin fieldErrors).
async function deleteCourse(currentUser, courseId) {
  const { institutionId } = currentUser;
  const course = await findEditableCourse(courseId, institutionId);
  let deletedCourse;
  try {
    deletedCourse = await courseRepository.markAsDeleted(courseId, institutionId);
  } catch (error) {
    if (courseRepository.isClosedSchoolYearError(error)) throw closedSchoolYearError(course.schoolYear);
    throw inUseError(error, 'eliminar') ?? error;
  }
  if (deletedCourse) return toInstitutionCourse(deletedCourse);
  // El UPDATE no marcó nada: otra sesión dio de baja el curso después de consultarlo.
  throw await notActiveError(courseId, institutionId);
}

module.exports = { listCourses, createCourse, updateCourse, deleteCourse, toListedCourse, CourseError };
