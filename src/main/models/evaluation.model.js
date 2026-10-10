// Evaluación: la que un profesor toma en una asignación docente, es decir, en una materia de un
// curso. Tiene baja lógica: la fila se conserva y deja de listarse.
class Evaluation {
  constructor({ id, teacherAssignmentId, title, evaluationDate }) {
    this.id = id;
    this.teacherAssignmentId = teacherAssignmentId;
    // No se repite entre las evaluaciones vigentes de su asignación.
    this.title = title;
    // Día de la evaluación (evaluacion.fecha_evaluacion): su año es el ciclo lectivo del curso de la
    // asignación.
    this.evaluationDate = evaluationDate;
  }
}

module.exports = { Evaluation };
