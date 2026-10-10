const evaluationRepository = require('../repositories/evaluation.repository');
const teacherAssignmentService = require('./teacher-assignment.service');
const { toIsoDate } = require('./user.service');

// Error previsto, con un mensaje apto para la UI (como TeacherAssignmentError en
// teacher-assignment.service.js).
class EvaluationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EvaluationError';
    this.code = code;
  }
}

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

// La evaluación vigente con ese id, si es de una asignación docente vigente a cargo de
// `currentUser` (el profesor de la sesión): una de las de listOwnAssignmentEvaluations para esa
// asignación. Los dos ids llegan del renderer, así que antes se comprueba que la asignación sea
// suya (getOwnTeacherAssignment) y después, que la evaluación sea de esa asignación.
// Devuelve { teacherAssignment, evaluation }: la asignación, con los campos de
// getOwnTeacherAssignment, y la evaluación, con los de listOwnAssignmentEvaluations.
// Lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la
// asignación no existe, fue dada de baja o es de otro profesor, y un EvaluationError
// EVALUATION_NOT_FOUND si la evaluación no existe, fue dada de baja o es de otra asignación, sin
// distinguir los casos.
async function getOwnAssignmentEvaluation(currentUser, teacherAssignmentId, evaluationId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const evaluation = await evaluationRepository.findActiveByIdAndTeacherAssignment(evaluationId, teacherAssignment.id);
  if (!evaluation) {
    throw new EvaluationError('EVALUATION_NOT_FOUND', 'La evaluación no existe o no es de esta asignación.');
  }
  return { teacherAssignment, evaluation: toListedEvaluation(evaluation) };
}

module.exports = { listOwnAssignmentEvaluations, getOwnAssignmentEvaluation, EvaluationError };
