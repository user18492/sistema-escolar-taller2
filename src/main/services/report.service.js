const teacherAssignmentRepository = require('../repositories/teacher-assignment.repository');
const backupRepository = require('../repositories/backup.repository');
const schoolYearService = require('./school-year.service');
const { EDUCATION_LEVELS } = require('../repositories/grade.repository');
const courseRepository = require('../repositories/course.repository');

const { SHIFTS } = courseRepository;

// Reportes de solo lectura de la vista Reportes del Administrador (plans/reportes-administrador/).
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

module.exports = { getSubjectCoverage, getTeacherWorkload, getBackupRegularity, ReportError };
