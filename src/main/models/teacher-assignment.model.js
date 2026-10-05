// Asignación docente: un profesor dicta, en un curso de su institución, una materia del plan de
// estudios del grado de ese curso.
// Incluye al profesor, el curso y la materia, para mostrarlos sin otra consulta.
class TeacherAssignment {
  constructor({ id, teacher, course, gradeSubjectId, subject }) {
    this.id = id;
    // El profesor: un User con los datos que trae la consulta (los demás quedan undefined).
    this.teacher = teacher;
    // El curso: un Course, con el nombre y el nivel educativo de su grado.
    this.course = course;
    // La materia dentro del plan de estudios del grado del curso (asignacion_docente.grado_materia_id).
    this.gradeSubjectId = gradeSubjectId;
    // La materia: un Subject.
    this.subject = subject;
  }
}

module.exports = { TeacherAssignment };
