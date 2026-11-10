const teacherAssignmentRepository = require('../repositories/teacher-assignment.repository');
const backupRepository = require('../repositories/backup.repository');
const enrollmentRepository = require('../repositories/enrollment.repository');
const evaluationRepository = require('../repositories/evaluation.repository');
const schoolYearService = require('./school-year.service');
const teacherAssignmentService = require('./teacher-assignment.service');
const { toListedCourse } = require('./course.service');
const { EDUCATION_LEVELS } = require('../repositories/grade.repository');
const courseRepository = require('../repositories/course.repository');
const { toListedStudent } = require('./student.service');

const { SHIFTS } = courseRepository;

// Reportes de solo lectura de las vistas Reportes del Administrador (plans/reportes-administrador/),
// del Secretario (Inscripciones activas por curso y Alumnos activos sin inscripción) y del Profesor
// (Calificaciones pendientes de carga).
// Cada uno es de la institución de `currentUser` (el de la sesión), nunca de una que mande la
// vista.
// Cada reporte dice además si el ciclo lectivo pedido tiene datos, para que la vista muestre "No
// existen registros…" en lugar de valores en cero: en los de cursos y docentes (hasCourses), si la
// institución tiene algún curso vigente del ciclo, sin mirar Nivel ni Turno; en el de backups
// (hasBackups), si hay algún backup de ese año. Un ciclo con cursos y valores en cero (profesores
// sin asignaciones, cursos completos) sí tiene datos.

// Error previsto, con un mensaje apto para la UI (como CourseError en course.service.js).
class ReportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
  }
}

// ---------- Validación de los filtros ----------

// Rango de años que acepta el filtro Ciclo lectivo.
const MIN_SCHOOL_YEAR = 2000;
const MAX_SCHOOL_YEAR = 2100;

const invalidFilter = (message) => new ReportError('INVALID_INPUT', message);

// `value` es uno de `codes` o null (todos); sin el campo, también todos.
const parseOptionalCode = (value, codes, message) => {
  if (value === undefined || value === null) return null;
  if (!codes.includes(value)) throw invalidFilter(message);
  return value;
};

// Normaliza los filtros de un reporte (el controlador ya verificó que sean un objeto) y devuelve
// solo los que se usan: `schoolYear`, el año del ciclo lectivo (obligatorio: la vista manda
// siempre el año resuelto, el actual por defecto), `educationLevel` (PRIMARY o SECONDARY) y `shift`
// (MORNING o AFTERNOON), null para todos. Lanza un ReportError INVALID_INPUT si alguno no vale.
function parseFilters(filters) {
  const { schoolYear, educationLevel, shift } = filters;
  if (!Number.isInteger(schoolYear) || schoolYear < MIN_SCHOOL_YEAR || schoolYear > MAX_SCHOOL_YEAR) {
    throw invalidFilter('Elegí un ciclo lectivo válido.');
  }
  return {
    schoolYear,
    educationLevel: parseOptionalCode(educationLevel, EDUCATION_LEVELS, 'Elegí un nivel educativo válido.'),
    shift: parseOptionalCode(shift, SHIFTS, 'Elegí un turno válido.'),
  };
}

// ---------- Reporte 1: Materias sin docente por curso ----------

// Los cursos incompletos del ciclo lectivo `filters.schoolYear` (con su Nivel y su Turno, si
// llegan): los vigentes con alguna materia del plan de estudios de su grado sin docente o con un
// profesor suspendido. Un curso con todas sus materias a cargo de profesores activos, o sin plan,
// no aparece. Por cada uno, las materias del plan y su cobertura:
//   - subjectCount: las materias del plan (0 si el grado no tiene plan).
//   - unassignedSubjects: { subjectId, subjectName } de las que no tienen docente, sin asignación
//     vigente o con un profesor dado de baja (posible en un ciclo cerrado).
//   - suspendedSubjects: { teacherAssignmentId, subjectId, subjectName, teacher: { id, firstName,
//     lastName }, teacherName } de las que tienen la asignación vigente de un profesor suspendido,
//     con teacherAssignmentId el id de esa asignación y teacherName "Nombre Apellido".
//   - assignedCount: subjectCount menos las que no tienen docente (cuenta las de un profesor
//     suspendido).
// Resuelve { schoolYear, hasCourses, courses }, en el orden de los cursos (nivel educativo, grado,
// división y turno); courses vacío si el ciclo no tiene cursos incompletos con esos filtros.
async function getSubjectCoverage(currentUser, filters) {
  const { schoolYear, educationLevel, shift } = parseFilters(filters);
  const [rows, hasCourses] = await Promise.all([
    teacherAssignmentRepository.findSubjectCoverage(currentUser.institutionId, {
      schoolYear,
      educationLevel,
      shift,
    }),
    courseRepository.existsInSchoolYear(currentUser.institutionId, schoolYear),
  ]);
  const courses = rows.map((row) => ({
    id: row.courseId,
    gradeName: row.gradeName,
    educationLevel: row.educationLevel,
    division: row.division,
    shift: row.shift,
    subjectCount: row.subjectCount,
    assignedCount: row.subjectCount - row.unassignedSubjects.length,
    unassignedSubjects: row.unassignedSubjects,
    suspendedSubjects: row.suspendedSubjects.map((subject) => ({
      teacherAssignmentId: subject.teacherAssignmentId,
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      teacher: { id: subject.teacherId, firstName: subject.teacherFirstName, lastName: subject.teacherLastName },
      teacherName: `${subject.teacherFirstName} ${subject.teacherLastName}`,
    })),
  }));
  const isIncomplete = (course) => course.unassignedSubjects.length > 0 || course.suspendedSubjects.length > 0;
  return { schoolYear, hasCourses, courses: courses.filter(isIncomplete) };
}

// ---------- Reporte 2: Carga docente por profesor ----------

// Por cada profesor de la institución que no está dado de baja (activo o suspendido, también sin
// asignaciones), sus asignaciones vigentes de cursos vigentes del ciclo lectivo `filters.schoolYear`
// (con su Nivel y su Turno, si llegan): { id, firstName, lastName, suspended, assignmentCount,
// assignments }, con assignments { id, courseId, educationLevel, gradeName, division, shift,
// subjectId, subjectName } de cada asignación (id, el de la asignación), de más a menos
// asignaciones (y por apellido y nombre). En un ciclo pasado lista a los profesores no
// dados de baja hoy (ver countByTeacher). Resuelve { schoolYear, hasCourses, summary, teachers },
// con summary el resumen de workloadSummary.
async function getTeacherWorkload(currentUser, filters) {
  const { schoolYear, educationLevel, shift } = parseFilters(filters);
  const [rows, hasCourses] = await Promise.all([
    teacherAssignmentRepository.countByTeacher(currentUser.institutionId, {
      schoolYear,
      educationLevel,
      shift,
    }),
    courseRepository.existsInSchoolYear(currentUser.institutionId, schoolYear),
  ]);
  const teachers = rows.map((row) => ({
    id: row.teacherId,
    firstName: row.firstName,
    lastName: row.lastName,
    suspended: row.suspended,
    assignmentCount: row.assignmentCount,
    assignments: row.assignments,
  }));
  return { schoolYear, hasCourses, summary: workloadSummary(teachers), teachers };
}

// El resumen del reporte de carga docente, sobre todos los profesores listados (activos y
// suspendidos, incluidos los que tienen 0):
//   - average: el promedio de asignaciones por profesor redondeado al entero más cercano (con .5,
//     hacia arriba), o null si no hay ninguno.
//   - aboveCount y belowCount: los que tienen más o menos asignaciones que ese entero, para que
//     coincidan con lo que se lee; los que tienen exactamente el promedio no entran en ninguno.
//   - withoutAssignmentsCount: los que no tienen asignaciones, que no cuentan en belowCount.
function workloadSummary(teachers) {
  const counts = teachers.map((teacher) => teacher.assignmentCount);
  const average = counts.length
    ? Math.round(counts.reduce((sum, count) => sum + count, 0) / counts.length)
    : null;
  const countWhere = (condition) => counts.filter(condition).length;
  return {
    average,
    aboveCount: countWhere((count) => count > average),
    belowCount: countWhere((count) => count > 0 && count < average),
    withoutAssignmentsCount: countWhere((count) => count === 0),
  };
}

// ---------- Reporte 3: Regularidad de los backups ----------

const MONTHS_IN_YEAR = 12;

// Cuántos backups de la institución hay en cada mes del ciclo lectivo `filters.schoolYear` (el año
// calendario: el ciclo lectivo va de enero a diciembre) y el último backup de la institución, que no
// depende del ciclo elegido (decisión del usuario). Resuelve { schoolYear, hasBackups, lastBackup,
// months }:
//   - hasBackups: si hay algún backup de la institución en ese año.
//   - lastBackup: { createdAt (texto ISO 8601), daysAgo } del último backup, con daysAgo los días
//     desde su fecha hasta la del día de la base (0 si es de hoy), o null si no hay ninguno.
//   - months: los 12 meses, { month (1 a 12), count, future }, con count 0 si no tiene backups.
//     future marca los meses que todavía no llegaron, con la fecha de la base: en el ciclo actual,
//     los posteriores al del día; en un ciclo futuro, todos; en uno pasado, ninguno.
// Las limitaciones de los datos, en backup.repository.js (countByMonth).
async function getBackupRegularity(currentUser, filters) {
  const { schoolYear } = parseFilters(filters);
  const [counts, lastBackup, { year, today }] = await Promise.all([
    backupRepository.countByMonth(currentUser.institutionId, schoolYear),
    backupRepository.findLastBackupDays(currentUser.institutionId),
    schoolYearService.getCurrentSchoolYear(),
  ]);
  const countByMonth = new Map(counts.map(({ month, count }) => [month, count]));
  // today es 'AAAA-MM-DD': el mes, sin pasar por la zona horaria del proceso
  const currentMonth = Number(today.slice(5, 7));
  const isFuture = (month) => schoolYear > year || (schoolYear === year && month > currentMonth);
  const months = Array.from({ length: MONTHS_IN_YEAR }, (_, index) => {
    const month = index + 1;
    return { month, count: countByMonth.get(month) ?? 0, future: isFuture(month) };
  });
  return {
    schoolYear,
    hasBackups: counts.length > 0,
    lastBackup: lastBackup && { createdAt: lastBackup.createdAt.toISOString(), daysAgo: lastBackup.daysAgo },
    months,
  };
}

// ---------- Reporte del Secretario: Inscripciones activas por curso ----------

// Largo de la columna grado.nombre.
const GRADE_NAME_MAX_LENGTH = 50;

// `value` es un arreglo de elementos que cumplen `isValid`; sin el campo, vacío (no filtra).
const parseOptionalList = (value, isValid, message) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isValid)) throw invalidFilter(message);
  return value;
};

const isGradeFilter = (grade) =>
  typeof grade === 'object' && grade !== null &&
  EDUCATION_LEVELS.includes(grade.educationLevel) &&
  typeof grade.gradeName === 'string' && grade.gradeName.length > 0 && grade.gradeName.length <= GRADE_NAME_MAX_LENGTH;

// Normaliza los filtros del reporte (el controlador ya verificó que sean un objeto): el nivel
// educativo (PRIMARY o SECONDARY, null para todos) y, del filtro Curso, los grados
// ({ educationLevel, gradeName }), las divisiones (letras mayúsculas) y los turnos (MORNING o
// AFTERNOON), cada uno un arreglo, vacío si no filtra. No lleva ciclo lectivo: es siempre el actual.
// Lanza un ReportError INVALID_INPUT si alguno no vale.
function parseCourseFilters({ educationLevel, grades, divisions, shifts }) {
  return {
    educationLevel: parseOptionalCode(educationLevel, EDUCATION_LEVELS, 'Elegí un nivel educativo válido.'),
    grades: parseOptionalList(grades, isGradeFilter, 'Elegí grados válidos.'),
    divisions: parseOptionalList(divisions, (division) => typeof division === 'string' && /^[A-Z]$/.test(division), 'Elegí divisiones válidas.'),
    shifts: parseOptionalList(shifts, (shift) => SHIFTS.includes(shift), 'Elegí turnos válidos.'),
  };
}

// En qué división de un grado conviene inscribir a un alumno nuevo: los cursos vigentes de la
// institución de `currentUser` del ciclo lectivo actual que pasan `filters`, con los campos de
// toListedCourse y activeEnrollmentCount, cuántas inscripciones vigentes y activas tiene (0 si no
// tiene ninguna), por nivel educativo, grado, división y turno. Resuelve { schoolYear, hasCourses,
// courses }: schoolYear, el ciclo actual, y hasCourses, si la institución tiene algún curso vigente
// de ese ciclo, sin mirar los filtros.
async function getActiveEnrollmentsByCourse(currentUser, filters) {
  const courseFilters = parseCourseFilters(filters);
  const { year } = await schoolYearService.getCurrentSchoolYear();
  const [rows, hasCourses] = await Promise.all([
    enrollmentRepository.countActiveByCourseInCurrentSchoolYear(currentUser.institutionId, courseFilters),
    courseRepository.existsInSchoolYear(currentUser.institutionId, year),
  ]);
  const courses = rows.map(({ course, activeEnrollmentCount }) => ({ ...toListedCourse(course), activeEnrollmentCount }));
  return { schoolYear: year, hasCourses, courses };
}

// ---------- Reporte del Secretario: Alumnos activos sin inscripción ----------

// Qué alumnos vigentes y activos siguen en la institución de `currentUser` y todavía no tienen una
// inscripción vigente y activa en un curso del ciclo lectivo actual, por apellido y nombre. Cada uno
// lleva los campos de toListedStudent (student.service.js), los mismos que el listado de Alumnos y
// que necesita su formulario de edición, y lastEnrollment, su última inscripción vigente de cualquier
// ciclo lectivo (la de fecha de inscripción más reciente): { id, status, course }, con status
// ACTIVE, COMPLETED o CANCELLED y course con los campos de toListedCourse, o null si nunca tuvo una.
// No recibe filtros: Alumno, Nivel y Curso los aplica la vista sobre la lista completa, porque las
// opciones de Curso salen de las últimas inscripciones de todos los alumnos del reporte. Resuelve
// { schoolYear, students }: schoolYear, el ciclo actual.
async function getStudentsWithoutEnrollment(currentUser) {
  const [rows, { year }] = await Promise.all([
    enrollmentRepository.findLastOfActiveStudentsWithoutCurrentEnrollment(currentUser.institutionId),
    schoolYearService.getCurrentSchoolYear(),
  ]);
  const students = rows.map(({ student, lastEnrollment }) => ({
    ...toListedStudent(student),
    lastEnrollment: lastEnrollment && {
      id: lastEnrollment.id,
      status: lastEnrollment.status,
      course: toListedCourse(lastEnrollment.course),
    },
  }));
  return { schoolYear: year, students };
}

// ---------- Reporte del Profesor: Calificaciones pendientes de carga ----------

// Qué evaluaciones ya tomadas de `currentUser` (el profesor de la sesión) tienen alumnos sin nota y
// cuánto falta para que cierre su trimestre: las de evaluationRepository.findPendingScoresByTeacher,
// de sus asignaciones vigentes de cursos de su institución del ciclo lectivo actual, en su orden (el
// cierre más próximo primero). Cada una { id, title, evaluationDate, term, teacherAssignmentId,
// course, subject, pendingCount, studentCount, closingDate, daysLeft }, con course los campos de
// toListedCourse y subject { id, name }. No recibe filtros: Curso, Nivel y Materia los aplica la
// vista sobre la lista completa, con assignments, las asignaciones vigentes del profesor de ese
// ciclo (las de listOwnTeacherAssignments), para ofrecer también los cursos y las materias sin
// pendientes. Resuelve { schoolYear, assignments, evaluations }: schoolYear, el ciclo actual.
async function getPendingScores(currentUser) {
  const [rows, ownAssignments, { year }] = await Promise.all([
    evaluationRepository.findPendingScoresByTeacher(currentUser.id, currentUser.institutionId),
    // La fila de usuario es de una sola institución: sus asignaciones son todas de la de la sesión
    teacherAssignmentService.listOwnTeacherAssignments(currentUser),
    schoolYearService.getCurrentSchoolYear(),
  ]);
  const evaluations = rows.map((row) => ({
    id: row.id,
    title: row.title,
    evaluationDate: row.evaluationDate,
    term: row.term,
    teacherAssignmentId: row.teacherAssignmentId,
    course: toListedCourse(row.course),
    subject: { id: row.subject.id, name: row.subject.name },
    pendingCount: row.pendingCount,
    studentCount: row.studentCount,
    closingDate: row.closingDate,
    daysLeft: row.daysLeft,
  }));
  return {
    schoolYear: year,
    assignments: ownAssignments.filter((assignment) => assignment.course.schoolYear === year),
    evaluations,
  };
}

module.exports = {
  getSubjectCoverage,
  getTeacherWorkload,
  getBackupRegularity,
  getActiveEnrollmentsByCourse,
  getStudentsWithoutEnrollment,
  getPendingScores,
  ReportError,
};
