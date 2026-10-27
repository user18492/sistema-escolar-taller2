// Curso de una institución: una división de un grado, en un turno y un ciclo lectivo.
// Incluye el nombre y el nivel educativo de su grado, para mostrarlos sin otra consulta.
class Course {
  constructor({ id, institutionId, gradeId, gradeName, educationLevel, division, shift, schoolYear, hasTeacherAssignments, hasEnrollments }) {
    this.id = id;
    this.institutionId = institutionId;
    this.gradeId = gradeId;
    // Nombre del grado (grado.nombre): 1°, 2°, ... 6°.
    this.gradeName = gradeName;
    // Nivel educativo del grado: PRIMARY o SECONDARY.
    this.educationLevel = educationLevel;
    // Una letra mayúscula: A, B, C...
    this.division = division;
    // MORNING o AFTERNOON.
    this.shift = shift;
    // Año del ciclo lectivo (curso.anio_ciclo_lectivo): 2026.
    this.schoolYear = schoolYear;
    // true si tiene asignaciones docentes vigentes y si tiene inscripciones vigentes, en cualquier
    // estado: con alguna, no se edita ni se da de baja. Solo los calcula el listado de la institución;
    // las demás consultas no los traen (quedan undefined).
    this.hasTeacherAssignments = hasTeacherAssignments;
    this.hasEnrollments = hasEnrollments;
  }
}

module.exports = { Course };
