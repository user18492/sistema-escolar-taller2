const evaluationRepository = require('../repositories/evaluation.repository');
const teacherAssignmentService = require('./teacher-assignment.service');
const { toIsoDate } = require('./user.service');

// ---------- Evaluaciones de una asignación del profesor ----------

// Lista explícita de campos, como toListedCourse (course.service.js): lo que muestran la tabla de
// Evaluaciones del Profesor y su filtro, y el id para identificar la fila. `evaluationDate` es el
// día de la evaluación ('AAAA-MM-DD').
function toListedEvaluation({ id, title, evaluationDate }) {
  return {
    id,
    title,
    evaluationDate: toIsoDate(evaluationDate),
  };
}

// Evaluaciones vigentes de una asignación docente vigente a cargo de `currentUser` (el profesor de
// la sesión), en el orden del repositorio. El id de la asignación llega del renderer, así que antes
// se comprueba que sea suya (getOwnTeacherAssignment).
// Lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la
// asignación no existe, fue dada de baja o es de otro profesor.
async function listOwnAssignmentEvaluations(currentUser, teacherAssignmentId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const evaluations = await evaluationRepository.findByTeacherAssignment(teacherAssignment.id);
  return evaluations.map(toListedEvaluation);
}

module.exports = { listOwnAssignmentEvaluations };
