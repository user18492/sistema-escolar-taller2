// Calificación: la nota de un alumno en una evaluación. El alumno se identifica por su inscripción
// en el curso de la evaluación. No tiene baja, ni lógica ni física: la fila se conserva y lo que
// cambia es su nota.
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
