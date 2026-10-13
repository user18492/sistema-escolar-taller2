// Calificación: la nota de un alumno en una evaluación. El alumno se identifica por su inscripción
// en el curso de la evaluación. No se borra: se corrige su nota o, si se cargó por error, se da de
// baja (baja lógica), y el alumno queda sin nota en la evaluación hasta que se le cargue otra.
class Score {
  constructor({ id, evaluationId, enrollmentId, value }) {
    this.id = id;
    this.evaluationId = evaluationId;
    this.enrollmentId = enrollmentId;
    // La nota (calificacion.nota): un número de 0 a 10, con hasta dos decimales.
    this.value = value;
  }
}

module.exports = { Score };
