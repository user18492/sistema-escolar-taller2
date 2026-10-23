const enrollmentRepository = require('../repositories/enrollment.repository');
const studentRepository = require('../repositories/student.repository');
const courseRepository = require('../repositories/course.repository');
const { EDUCATION_LEVELS } = require('../repositories/grade.repository');
const teacherAssignmentService = require('./teacher-assignment.service');
const { toListedCourse } = require('./course.service');
const { toIsoDate } = require('./user.service');

// Error previsto, con un mensaje apto para la UI (como StudentError en student.service.js).
class EnrollmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EnrollmentError';
    this.code = code;
  }
}

// ---------- Número de inscripción ----------

// El número de inscripción no se guarda en la base: se arma con el inscripcion_id, que es único y
// no cambia. No lleva el año.
const ENROLLMENT_NUMBER_PREFIX = 'INS-';
const ENROLLMENT_NUMBER_MIN_DIGITS = 6;

// Número de inscripción de un inscripcion_id: el prefijo y el id completado con ceros a la
// izquierda hasta seis dígitos (12 → 'INS-000012'). Un id de más de seis dígitos va completo, sin
// truncar (1234567 → 'INS-1234567').
// Es el único lugar que define el formato: lo usa todo lo que muestra una inscripción, para que su
// número sea el mismo en todas las vistas.
function formatEnrollmentNumber(enrollmentId) {
  return `${ENROLLMENT_NUMBER_PREFIX}${String(enrollmentId).padStart(ENROLLMENT_NUMBER_MIN_DIGITS, '0')}`;
}

// ---------- Inscripciones del curso de una asignación del profesor ----------

// Lo que las vistas del Profesor muestran del alumno de una inscripción. `dni` son solo los
// dígitos.
function toListedStudent({ firstName, lastName, dni }) {
  return { firstName, lastName, dni };
}

// Lista explícita de campos, como toListedCourse (course.service.js): lo que muestran la tabla de
// Alumnos del Profesor y su filtro, y el id para identificar la fila. `number` es el número de
// inscripción, `enrollmentDate` el día de la inscripción ('AAAA-MM-DD') y `student`, el alumno
// (toListedStudent).
function toListedEnrollment({ id, student, enrollmentDate }) {
  return {
    id,
    number: formatEnrollmentNumber(id),
    enrollmentDate: toIsoDate(enrollmentDate),
    student: toListedStudent(student),
  };
}

// Inscripciones del curso de una asignación docente vigente a cargo de `currentUser` (el profesor
// de la sesión): las activas y las finalizadas del curso, sin las canceladas, en el orden del
// repositorio. El id de la asignación llega del renderer, así que antes se comprueba que sea suya
// (getOwnTeacherAssignment): el curso sale de esa asignación y nunca de lo que envía el renderer.
// Lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la
// asignación no existe, fue dada de baja o es de otro profesor.
async function listOwnAssignmentEnrollments(currentUser, teacherAssignmentId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const enrollments = await enrollmentRepository.findActiveOrFinishedByCourse(teacherAssignment.course.id);
  return enrollments.map(toListedEnrollment);
}

// ---------- Inscripciones de la institución ----------

// Largo de la columna grado.nombre.
const GRADE_NAME_MAX_LENGTH = 50;

// Lo que admite cada filtro del listado, con los códigos del sistema: un valor que no está en la
// base (otro nivel educativo, turno o estado, o una división que no es una letra mayúscula) se
// rechaza en lugar de no encontrar nada.
const isValidGrade = ({ educationLevel, gradeName }) =>
  EDUCATION_LEVELS.includes(educationLevel) && gradeName.length > 0 && gradeName.length <= GRADE_NAME_MAX_LENGTH;
const FILTER_VALIDATORS = {
  grades: isValidGrade,
  divisions: (division) => /^[A-Z]$/.test(division),
  shifts: (shift) => courseRepository.SHIFTS.includes(shift),
  statuses: (status) => enrollmentRepository.STATUSES.includes(status),
};

// Los filtros llegan con la forma que comprueba el controlador: acá se validan sus valores.
// Lanza el EnrollmentError INVALID_INPUT si alguno no es válido.
function assertValidFilters(filters) {
  const isValid = Object.entries(FILTER_VALIDATORS).every(([filter, isValidValue]) => filters[filter].every(isValidValue));
  if (!isValid) throw new EnrollmentError('INVALID_INPUT', 'Los filtros enviados no son válidos.');
}

// Lista explícita de campos: lo que muestra la tabla de Inscripciones del Secretario y el id para
// identificar la fila. `number` es el número de inscripción, `enrollmentDate` el día de la
// inscripción ('AAAA-MM-DD'), `status` ACTIVE, COMPLETED o CANCELLED, `student` el alumno (nombre y
// apellido) y `course`, el curso (toListedCourse).
function toInstitutionEnrollment({ id, student, course, enrollmentDate, status }) {
  return {
    id,
    number: formatEnrollmentNumber(id),
    enrollmentDate: toIsoDate(enrollmentDate),
    status,
    student: { firstName: student.firstName, lastName: student.lastName },
    course: toListedCourse(course),
  };
}

// Una página de las inscripciones vigentes (sin baja lógica) de la institución de `currentUser`
// (el de la sesión) que pasan `filters`, de todos los ciclos lectivos y en cualquier estado, sin las
// de alumnos dados de baja (vuelven al restaurarlo), en el orden del repositorio: por alumno
// (apellido y nombre). Filtrar y paginar se hace sobre todas, en la base.
// `filters` trae enrollmentIds, studentIds, grades ({ educationLevel, gradeName }), divisions,
// shifts y statuses, cada uno un arreglo, vacío si no filtra (ver countNotDeletedByInstitution,
// enrollment.repository.js). `page` es la página pedida (1 la primera) y `pageSize`, cuántas
// inscripciones tiene cada una. Con `enrollmentId` (un inscripcion_id; null si no), se pide en
// cambio la página donde está esa inscripción, si pasa los filtros: así se muestra una recién
// creada. Si no los pasa, se usa `page`.
// Devuelve { enrollments, total, page }: las de la página, cuántas pasan los filtros en total y la
// página que se devolvió. Si la pedida ya no existe (p. ej., otra sesión dio de baja inscripciones),
// se devuelve la última; sin inscripciones, la 1, vacía.
// Lanza el EnrollmentError INVALID_INPUT si algún filtro no es válido.
async function listEnrollments(currentUser, filters, page, pageSize, enrollmentId = null) {
  assertValidFilters(filters);
  const { institutionId } = currentUser;
  const total = await enrollmentRepository.countNotDeletedByInstitution(institutionId, filters);
  const position = enrollmentId === null
    ? null
    : await enrollmentRepository.findPositionNotDeletedByInstitution(institutionId, filters, enrollmentId);
  const requestedPage = position === null ? page : Math.floor(position / pageSize) + 1;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(requestedPage, lastPage);
  const enrollments = total
    ? await enrollmentRepository.findPageNotDeletedByInstitution(institutionId, filters, {
      offset: (currentPage - 1) * pageSize,
      limit: pageSize,
    })
    : [];
  return { enrollments: enrollments.map(toInstitutionEnrollment), total, page: currentPage };
}

// Opciones de los filtros Número de inscripción y Alumno de la tabla de Inscripciones del
// Secretario: todas las inscripciones que lista listEnrollments sin filtros (las vigentes de la
// institución de `currentUser`, sin las de alumnos dados de baja) y sus alumnos, una vez cada uno.
// Las dos listas siguen el orden del listado (por alumno).
// Devuelve { enrollments, students }: enrollments con { id, number, student } (student con nombre y
// apellido) y students con { id, firstName, lastName, email }.
async function listEnrollmentFilterOptions(currentUser) {
  const enrollments = await enrollmentRepository.findNotDeletedByInstitution(currentUser.institutionId);
  // Un Map conserva el orden de la primera inscripción de cada alumno, que es el del listado
  const students = new Map(enrollments.map(({ student }) => [student.id, student]));
  return {
    enrollments: enrollments.map(({ id, student }) => ({
      id,
      number: formatEnrollmentNumber(id),
      student: { firstName: student.firstName, lastName: student.lastName },
    })),
    students: Array.from(students.values(), ({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email })),
  };
}

// ---------- Alta: qué se puede inscribir ----------

// Estado de un alumno que se puede inscribir, con los códigos del sistema (ACTIVO en
// alumno_estado.nombre): un egresado no se inscribe.
const ENROLLABLE_STUDENT_STATUS = 'ACTIVE';

// Alumnos que ofrece el formulario de alta: los vigentes (sin baja lógica) y activos de la
// institución de `currentUser` (el de la sesión), sin los egresados, por apellido y nombre. Cada uno
// con su id y los campos de toListedStudent. Están también los que ya tienen una inscripción activa:
// el alta los rechaza (ver createEnrollment).
async function listEnrollableStudents(currentUser) {
  const students = await studentRepository.findActiveByInstitution(currentUser.institutionId);
  return students.map((student) => ({ id: student.id, ...toListedStudent(student) }));
}

// Cursos que ofrece el formulario de alta: los vigentes de la institución de `currentUser`, de todos
// los ciclos lectivos, con los campos y el orden de listCourses (course.service.js). El formulario
// muestra los del nivel educativo elegido.
async function listEnrollableCourses(currentUser) {
  const courses = await courseRepository.findByInstitution(currentUser.institutionId);
  return courses.map(toListedCourse);
}

// Los ids del alta llegan del renderer y la lista que tiene a la vista puede haber quedado vieja:
// otra sesión dio de baja al alumno o al curso, o pasó al alumno a egresado. Por eso se buscan de
// nuevo antes de guardar, y cada motivo tiene su error.

// Lanza el EnrollmentError INVALID_INPUT si el nivel educativo no es PRIMARY ni SECONDARY.
function assertValidEducationLevel(educationLevel) {
  if (!EDUCATION_LEVELS.includes(educationLevel)) {
    throw new EnrollmentError('INVALID_INPUT', 'Elegí un nivel educativo válido.');
  }
}

// El alumno con ese id, si se lo puede inscribir: es de la institución y está vigente y activo.
// Lanza un EnrollmentError si no existe en la institución (STUDENT_NOT_FOUND), si fue dado de baja
// (STUDENT_DELETED) o si es egresado (STUDENT_NOT_ACTIVE).
async function findEnrollableStudent(institutionId, studentId) {
  const student = await studentRepository.findById(studentId, institutionId);
  if (!student) {
    throw new EnrollmentError('STUDENT_NOT_FOUND', 'El alumno elegido no existe en la institución.');
  }
  if (student.deletedAt) {
    throw new EnrollmentError('STUDENT_DELETED', 'El alumno elegido fue eliminado.');
  }
  if (student.status !== ENROLLABLE_STUDENT_STATUS) {
    throw new EnrollmentError('STUDENT_NOT_ACTIVE', 'El alumno elegido no está activo: solo se puede inscribir a alumnos activos.');
  }
  return student;
}

// El curso con ese id, si se puede inscribir en él con ese nivel educativo: es de la institución,
// está vigente y su grado es de `educationLevel`.
// Lanza un EnrollmentError si no existe en la institución (COURSE_NOT_FOUND), si fue dado de baja
// (COURSE_DELETED) o si es de otro nivel educativo (COURSE_LEVEL_MISMATCH).
async function findEnrollableCourse(institutionId, courseId, educationLevel) {
  const course = await courseRepository.findActiveById(courseId, institutionId);
  if (!course) {
    throw (await courseRepository.existsInInstitution(courseId, institutionId))
      ? new EnrollmentError('COURSE_DELETED', 'El curso elegido fue eliminado.')
      : new EnrollmentError('COURSE_NOT_FOUND', 'El curso elegido no existe en la institución.');
  }
  if (course.educationLevel !== educationLevel) {
    throw new EnrollmentError('COURSE_LEVEL_MISMATCH', 'El curso elegido no es del nivel educativo seleccionado.');
  }
  return course;
}

// ---------- Alta ----------

// Error de un alta rechazada porque `student` ya tiene una inscripción activa: un alumno solo puede
// tener una. Nombra la que tiene, con su número, para encontrarla en el listado. `course` es el
// curso en el que se lo quería inscribir. Si otra sesión la canceló después del rechazo, no la nombra.
async function alreadyEnrolledError(student, course) {
  const activeEnrollment = await enrollmentRepository.findActiveByStudent(student.id);
  const name = `${student.firstName} ${student.lastName}`;
  if (!activeEnrollment) {
    return new EnrollmentError('STUDENT_ALREADY_ENROLLED', `${name} ya tiene una inscripción activa. Intentá nuevamente.`);
  }
  const number = formatEnrollmentNumber(activeEnrollment.id);
  const message = activeEnrollment.courseId === course.id
    ? `${name} ya tiene una inscripción activa en este curso: ${number}.`
    : `${name} ya tiene una inscripción activa en otro curso: ${number}. Un alumno solo puede tener una: ` +
      'para cambiarlo de curso, primero hay que cancelar esa inscripción.';
  return new EnrollmentError('STUDENT_ALREADY_ENROLLED', message);
}

// Inserta la inscripción de `student` en `course` (los de findEnrollableStudent y
// findEnrollableCourse) y la devuelve; null si no insertó nada (ver enrollmentRepository.create).
// Si PostgreSQL rechaza el alta por una restricción de db/schema.sql, lanza un EnrollmentError:
// STUDENT_ALREADY_ENROLLED si el alumno ya tiene una inscripción activa
// (ck_inscripcion_alumno_una_activa) y COURSE_OUT_OF_SCHOOL_YEAR si el curso no es del ciclo lectivo
// del año en curso (ck_inscripcion_fecha_ciclo_lectivo: la fecha de inscripción es la del día, y su
// año tiene que ser el ciclo lectivo del curso).
async function saveEnrollment(institutionId, student, course) {
  try {
    return await enrollmentRepository.create(institutionId, {
      studentId: student.id,
      courseId: course.id,
      educationLevel: course.educationLevel,
    });
  } catch (error) {
    if (enrollmentRepository.isSecondActiveEnrollmentError(error)) {
      throw await alreadyEnrolledError(student, course);
    }
    if (enrollmentRepository.isDateOutOfSchoolYearError(error)) {
      throw new EnrollmentError(
        'COURSE_OUT_OF_SCHOOL_YEAR',
        `El curso elegido es del ciclo lectivo ${course.schoolYear}: solo se puede inscribir en un curso durante el año de su ciclo lectivo.`
      );
    }
    throw error;
  }
}

// Inscribe a un alumno en un curso de la institución de `currentUser` (el de la sesión) y devuelve la
// inscripción creada, con los campos de listEnrollments. `data` trae studentId (un alumno de
// listEnrollableStudents), educationLevel (PRIMARY o SECONDARY) y courseId (un curso de
// listEnrollableCourses de ese nivel); el controlador ya comprobó su forma.
// La inscripción nace siempre ACTIVA, con la fecha del día, que completa la base, y su número sale
// del inscripcion_id que le asigna la base (formatEnrollmentNumber): ni el estado, ni la fecha, ni
// el número se leen de `data`.
// Lanza un EnrollmentError si el nivel educativo no es válido (INVALID_INPUT), si el alumno o el
// curso no se pueden elegir (los de findEnrollableStudent y findEnrollableCourse) o si la base
// rechaza el alta (los de saveEnrollment). El INSERT vuelve a exigir lo mismo del alumno y del
// curso: si otra sesión los cambió después de comprobarlos, no se guarda nada y se lanza el error
// que corresponde.
async function createEnrollment(currentUser, { studentId, educationLevel, courseId }) {
  const { institutionId } = currentUser;
  assertValidEducationLevel(educationLevel);
  const student = await findEnrollableStudent(institutionId, studentId);
  const course = await findEnrollableCourse(institutionId, courseId, educationLevel);

  const enrollment = await saveEnrollment(institutionId, student, course);
  if (enrollment) return toInstitutionEnrollment(enrollment);
  // El INSERT no agregó nada: otra sesión cambió al alumno o al curso después de comprobarlos. Las
  // mismas comprobaciones informan qué pasó.
  await findEnrollableStudent(institutionId, studentId);
  await findEnrollableCourse(institutionId, courseId, educationLevel);
  throw new Error(`No se insertó la inscripción del alumno ${studentId} en el curso ${courseId}, que se pueden inscribir`);
}

module.exports = {
  listOwnAssignmentEnrollments,
  listEnrollments,
  listEnrollmentFilterOptions,
  listEnrollableStudents,
  listEnrollableCourses,
  createEnrollment,
  formatEnrollmentNumber,
  toListedStudent,
  EnrollmentError,
};
