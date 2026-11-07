// Evaluación: la que un profesor toma en una asignación docente, es decir, en una materia de un
// curso. Tiene baja lógica: la fila se conserva y deja de listarse.
class Evaluation {
  constructor({ id, teacherAssignmentId, title, evaluationDate, isTermClosed }) {
    this.id = id;
    this.teacherAssignmentId = teacherAssignmentId;
    // No se repite entre las evaluaciones vigentes de su asignación.
    this.title = title;
    // Día de la evaluación (evaluacion.fecha_evaluacion): su año es el ciclo lectivo del curso de la
    // asignación.
    this.evaluationDate = evaluationDate;
    // Si el trimestre de su fecha está cerrado (fn_trimestre_cerrado, db/schema.sql), con la fecha de
    // la base al consultarla: desde entonces, la evaluación y sus calificaciones son de solo lectura.
    this.isTermClosed = isTermClosed;
  }
}

module.exports = { Evaluation };
