// Evaluación: la que un profesor toma en una asignación docente, es decir, en una materia de un
// curso. Tiene baja lógica: la fila se conserva y deja de listarse.
class Evaluation {
  constructor({ id, teacherAssignmentId, title, evaluationDate, term, isTermClosed }) {
    this.id = id;
    this.teacherAssignmentId = teacherAssignmentId;
    // No se repite entre las evaluaciones vigentes de su asignación.
    this.title = title;
    // Día de la evaluación (evaluacion.fecha_evaluacion): su año es el ciclo lectivo del curso de la
    // asignación.
    this.evaluationDate = evaluationDate;
    // Trimestre de su fecha (1, 2 o 3), con los cortes de fn_trimestre (db/schema.sql): el mismo con
    // el que la evaluación cuenta en los promedios.
    this.term = term;
    // Si el trimestre de su fecha está cerrado (fn_trimestre_cerrado, db/schema.sql), con la fecha de
    // la base al consultarla: desde entonces, la evaluación y sus calificaciones son de solo lectura.
    this.isTermClosed = isTermClosed;
  }
}

module.exports = { Evaluation };
