// Inscripción: un alumno cursa un curso de su institución. Lo que cambia a lo largo de su vida es su
// estado; la baja lógica (inscripcion.fecha_eliminacion) la deja fuera de los listados.
// Incluye al alumno, para mostrarlo sin otra consulta.
class Enrollment {
  constructor({ id, student, course, courseId, enrollmentDate, status, isActive, deletedAt }) {
    // inscripcion_id: de él sale el número de inscripción (formatEnrollmentNumber,
    // enrollment.service.js), que no se guarda.
    this.id = id;
    // El alumno: un Student con los datos que trae la consulta.
    this.student = student;
    // El curso: un Course con los datos que trae la consulta, si los trae.
    this.course = course;
    this.courseId = courseId;
    // Día de la inscripción (inscripcion.fecha_inscripcion): su año es el ciclo lectivo del curso.
    this.enrollmentDate = enrollmentDate;
    // ACTIVE, COMPLETED o CANCELLED, si la consulta trae el estado.
    this.status = status;
    // true si su estado es ACTIVA; false si fue finalizada o cancelada. Solo una inscripción
    // activa admite que se le carguen o corrijan calificaciones.
    this.isActive = isActive;
    // Instante de la baja lógica (inscripcion.fecha_eliminacion), si la consulta lo trae; null si
    // está vigente.
    this.deletedAt = deletedAt;
  }
}

module.exports = { Enrollment };
