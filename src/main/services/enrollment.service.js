const enrollmentRepository = require('../repositories/enrollment.repository');
const teacherAssignmentService = require('./teacher-assignment.service');
const { toIsoDate } = require('./user.service');

// ---------- Número de inscripción ----------

// El número de inscripción no se guarda en la base: se arma con el inscripcion_id, que es único y
// no cambia. No lleva el año.
const ENROLLMENT_NUMBER_PREFIX = 'INS-';
const ENROLLMENT_NUMBER_MIN_DIGITS = 6;

// Número de inscripción de un inscripcion_id: el prefijo y el id completado con ceros a la
// izquierda hasta seis dígitos (12 → 'INS-000012'). Un id de más de seis dígitos va completo, sin
// truncar (1234567 → 'INS-1234567').
// Es el único lugar que define el formato: lo usa todo lo que muestra una inscripción, para que su
// número sea el mismo en todas las vistas.
function formatEnrollmentNumber(enrollmentId) {
  return `${ENROLLMENT_NUMBER_PREFIX}${String(enrollmentId).padStart(ENROLLMENT_NUMBER_MIN_DIGITS, '0')}`;
}

// ---------- Inscripciones del curso de una asignación del profesor ----------

// Lo que las vistas del Profesor muestran del alumno de una inscripción. `dni` son solo los
// dígitos.
function toListedStudent({ firstName, lastName, dni }) {
  return { firstName, lastName, dni };
}

// Lista explícita de campos, como toListedCourse (course.service.js): lo que muestran la tabla de
// Alumnos del Profesor y su filtro, y el id para identificar la fila. `number` es el número de
// inscripción, `enrollmentDate` el día de la inscripción ('AAAA-MM-DD') y `student`, el alumno
// (toListedStudent).
function toListedEnrollment({ id, student, enrollmentDate }) {
  return {
    id,
    number: formatEnrollmentNumber(id),
    enrollmentDate: toIsoDate(enrollmentDate),
    student: toListedStudent(student),
  };
}

// Inscripciones del curso de una asignación docente vigente a cargo de `currentUser` (el profesor
// de la sesión): todas las del curso, en cualquier estado, en el orden del repositorio. El id de la
// asignación llega del renderer, así que antes se comprueba que sea suya
// (getOwnTeacherAssignment): el curso sale de esa asignación y nunca de lo que envía el renderer.
// Lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la
// asignación no existe, fue dada de baja o es de otro profesor.
async function listOwnAssignmentEnrollments(currentUser, teacherAssignmentId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const enrollments = await enrollmentRepository.findByCourse(teacherAssignment.course.id);
  return enrollments.map(toListedEnrollment);
}

module.exports = { listOwnAssignmentEnrollments, formatEnrollmentNumber, toListedStudent };
