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

// Cursos de la institución de `currentUser` (el de la sesión), de todos los ciclos lectivos, en el
// orden del repositorio.
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
// curso con ese grado, división y turno en el ciclo lectivo (DUPLICATE_VALUE).
async function createCourse(currentUser, data) {
  const values = parseCourseData(data);
  const schoolYear = new Date().getFullYear();
  try {
    const course = await courseRepository.create(currentUser.institutionId, { ...values, schoolYear });
    return toListedCourse(course);
  } catch (error) {
    if (courseRepository.isUnknownGradeError(error)) {
      throw new CourseError('GRADE_NOT_FOUND', 'El grado elegido no existe.');
    }
    if (courseRepository.isDuplicateError(error)) {
      throw new CourseError(
        'DUPLICATE_VALUE',
        `Ya existe un curso con ese grado, división y turno en el ciclo lectivo ${schoolYear}.`
      );
    }
    throw error;
  }
}

module.exports = { listCourses, createCourse, CourseError };
