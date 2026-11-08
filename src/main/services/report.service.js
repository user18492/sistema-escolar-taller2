const teacherAssignmentRepository = require('../repositories/teacher-assignment.repository');
const backupRepository = require('../repositories/backup.repository');
const schoolYearService = require('./school-year.service');
const { EDUCATION_LEVELS } = require('../repositories/grade.repository');
const { SHIFTS } = require('../repositories/course.repository');

// Reportes de solo lectura de la vista Reportes del Administrador (plans/reportes-administrador/).
// Cada uno es de la institución de `currentUser` (el de la sesión), nunca de una que mande la
// vista.

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
// (MORNING o AFTERNOON), null para todos, y `onlyIncomplete`, un booleano (sin el campo, false).
// Lanza un ReportError INVALID_INPUT si alguno no vale.
function parseFilters(filters) {
  const { schoolYear, educationLevel, shift, onlyIncomplete = false } = filters;
  if (!Number.isInteger(schoolYear) || schoolYear < MIN_SCHOOL_YEAR || schoolYear > MAX_SCHOOL_YEAR) {
    throw invalidFilter('Elegí un ciclo lectivo válido.');
  }
  if (typeof onlyIncomplete !== 'boolean') {
    throw invalidFilter('Los filtros enviados no son válidos.');
  }
  return {
    schoolYear,
    educationLevel: parseOptionalCode(educationLevel, EDUCATION_LEVELS, 'Elegí un nivel educativo válido.'),
    shift: parseOptionalCode(shift, SHIFTS, 'Elegí un turno válido.'),
    onlyIncomplete,
  };
}

// ---------- Reporte 1: Materias sin docente por curso ----------

// Por cada curso vigente del ciclo lectivo `filters.schoolYear` (con su Nivel y su Turno, si
// llegan), las materias del plan de estudios de su grado y su cobertura:
//   - subjectCount: las materias del plan (0 si el grado no tiene plan).
//   - unassignedSubjects: los nombres de las que no tienen docente, sin asignación vigente o con
//     un profesor dado de baja (posible en un ciclo cerrado).
//   - suspendedSubjects: { subjectName, teacherName } de las que tienen la asignación vigente de un
//     profesor suspendido, con teacherName "Nombre Apellido".
//   - assignedCount: subjectCount menos las que no tienen docente (cuenta las de un profesor
//     suspendido).
// Un curso está incompleto si tiene alguna materia sin docente o con un profesor suspendido; con
// `filters.onlyIncomplete`, se devuelven solo esos. Resuelve { schoolYear, courses }, en el orden
// de los cursos (nivel educativo, grado, división y turno).
async function getSubjectCoverage(currentUser, filters) {
  const { schoolYear, educationLevel, shift, onlyIncomplete } = parseFilters(filters);
  const rows = await teacherAssignmentRepository.findSubjectCoverage(currentUser.institutionId, {
    schoolYear,
    educationLevel,
    shift,
  });
  const courses = rows.map((row) => ({
    id: row.courseId,
    gradeName: row.gradeName,
    educationLevel: row.educationLevel,
    division: row.division,
    shift: row.shift,
    subjectCount: row.subjectCount,
    assignedCount: row.subjectCount - row.unassignedSubjects.length,
    unassignedSubjects: row.unassignedSubjects,
    suspendedSubjects: row.suspendedSubjects.map(({ subjectName, teacherFirstName, teacherLastName }) => ({
      subjectName,
      teacherName: `${teacherFirstName} ${teacherLastName}`,
    })),
  }));
  const isIncomplete = (course) => course.unassignedSubjects.length > 0 || course.suspendedSubjects.length > 0;
  return { schoolYear, courses: onlyIncomplete ? courses.filter(isIncomplete) : courses };
}

// ---------- Reporte 2: Carga docente por profesor ----------

// Por cada profesor de la institución que no está dado de baja (activo o suspendido, también sin
// asignaciones), sus asignaciones vigentes de cursos vigentes del ciclo lectivo `filters.schoolYear`
// (con su Nivel y su Turno, si llegan): { id, firstName, lastName, suspended, assignmentCount,
// courseCount }, con courseCount los cursos distintos, de más a menos asignaciones (y por apellido
// y nombre). En un ciclo pasado lista a los profesores no dados de baja hoy (ver countByTeacher).
// `average` es la media de assignmentCount de todos los profesores listados, incluidos los que
// tienen 0, o null si no hay ninguno. Resuelve { schoolYear, average, teachers }.
async function getTeacherWorkload(currentUser, filters) {
  const { schoolYear, educationLevel, shift } = parseFilters(filters);
  const rows = await teacherAssignmentRepository.countByTeacher(currentUser.institutionId, {
    schoolYear,
    educationLevel,
    shift,
  });
  const teachers = rows.map((row) => ({
    id: row.teacherId,
    firstName: row.firstName,
    lastName: row.lastName,
    suspended: row.suspended,
    assignmentCount: row.assignmentCount,
    courseCount: row.courseCount,
  }));
  const average = teachers.length
    ? teachers.reduce((sum, teacher) => sum + teacher.assignmentCount, 0) / teachers.length
    : null;
  return { schoolYear, average, teachers };
}

// ---------- Reporte 3: Regularidad de los backups ----------

const MONTHS_IN_YEAR = 12;

// Cuántos backups de la institución hay en cada mes del ciclo lectivo `filters.schoolYear` (el año
// calendario: el ciclo lectivo va de enero a diciembre) y el último backup de la institución, que no
// depende del ciclo elegido (decisión del usuario). Resuelve { schoolYear, lastBackup, months }:
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
    lastBackup: lastBackup && { createdAt: lastBackup.createdAt.toISOString(), daysAgo: lastBackup.daysAgo },
    months,
  };
}

module.exports = { getSubjectCoverage, getTeacherWorkload, getBackupRegularity, ReportError };
