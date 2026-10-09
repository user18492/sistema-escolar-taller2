// Inscripción: un alumno cursa un curso de su institución. No tiene baja lógica: la fila se
// conserva y lo que cambia es su estado.
// Incluye al alumno, para mostrarlo sin otra consulta.
class Enrollment {
  constructor({ id, student, courseId, enrollmentDate }) {
    // inscripcion_id: de él sale el número de inscripción (formatEnrollmentNumber,
    // enrollment.service.js), que no se guarda.
    this.id = id;
    // El alumno: un Student con los datos que trae la consulta.
    this.student = student;
    this.courseId = courseId;
    // Día de la inscripción (inscripcion.fecha_inscripcion): su año es el ciclo lectivo del curso.
    this.enrollmentDate = enrollmentDate;
  }
}

module.exports = { Enrollment };
