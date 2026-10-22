const enrollmentRepository = require('../repositories/enrollment.repository');
const { EDUCATION_LEVELS } = require('../repositories/grade.repository');
const { SHIFTS } = require('../repositories/course.repository');
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
  shifts: (shift) => SHIFTS.includes(shift),
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
// (el de la sesión) que pasan `filters`, de todos los ciclos lectivos, en el orden del
// repositorio: por alumno (apellido y nombre). Filtrar y paginar se hace sobre todas, en la base.
// `filters` trae enrollmentIds, studentIds, grades ({ educationLevel, gradeName }), divisions,
// shifts y statuses, cada uno un arreglo, vacío si no filtra (ver countNotDeletedByInstitution,
// enrollment.repository.js). `page` es la página pedida (1 la primera) y `pageSize`, cuántas
// inscripciones tiene cada una.
// Devuelve { enrollments, total, page }: las de la página, cuántas pasan los filtros en total y la
// página que se devolvió. Si la pedida ya no existe (p. ej., otra sesión dio de baja inscripciones),
// se devuelve la última; sin inscripciones, la 1, vacía.
// Lanza el EnrollmentError INVALID_INPUT si algún filtro no es válido.
async function listEnrollments(currentUser, filters, page, pageSize) {
  assertValidFilters(filters);
  const { institutionId } = currentUser;
  const total = await enrollmentRepository.countNotDeletedByInstitution(institutionId, filters);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, lastPage);
  const enrollments = total
    ? await enrollmentRepository.findPageNotDeletedByInstitution(institutionId, filters, {
      offset: (currentPage - 1) * pageSize,
      limit: pageSize,
    })
    : [];
  return { enrollments: enrollments.map(toInstitutionEnrollment), total, page: currentPage };
}

// Opciones de los filtros Número de inscripción y Alumno de la tabla de Inscripciones del
// Secretario: todas las inscripciones vigentes de la institución de `currentUser`, sin filtrar, y
// sus alumnos, una vez cada uno. Las dos listas siguen el orden del listado (por alumno).
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

module.exports = {
  listOwnAssignmentEnrollments,
  listEnrollments,
  listEnrollmentFilterOptions,
  formatEnrollmentNumber,
  toListedStudent,
  EnrollmentError,
};
