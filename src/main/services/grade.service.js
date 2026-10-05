const gradeRepository = require('../repositories/grade.repository');

// Lista explícita de campos, como toListedCourse (course.service.js): lo que necesita un formulario
// para ofrecer el grado. `name` es el valor de grado.nombre (1°, 2°, ... 6°) y `educationLevel`
// PRIMARY o SECONDARY.
function toListedGrade(grade) {
  return {
    id: grade.id,
    name: grade.name,
    educationLevel: grade.educationLevel,
  };
}

// Catálogo de grados, común a todas las instituciones y de solo lectura, en el orden del
// repositorio.
async function listGrades() {
  const grades = await gradeRepository.findAll();
  return grades.map(toListedGrade);
}

module.exports = { listGrades };
