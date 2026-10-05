const courseRepository = require('../repositories/course.repository');

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

module.exports = { listCourses };
