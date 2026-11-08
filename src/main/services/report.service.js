const teacherAssignmentRepository = require('../repositories/teacher-assignment.repository');
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

module.exports = { getSubjectCoverage, ReportError };
