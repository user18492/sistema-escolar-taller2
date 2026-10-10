const scoreRepository = require('../repositories/score.repository');
const enrollmentRepository = require('../repositories/enrollment.repository');
const evaluationService = require('./evaluation.service');
const { toListedStudent } = require('./enrollment.service');

// Error previsto, con un mensaje apto para la UI (como TeacherAssignmentError en
// teacher-assignment.service.js).
class ScoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScoreError';
    this.code = code;
  }
}

// ---------- Nota ----------

// Escala de calificacion.nota (ck_calificacion_nota y NUMERIC(4,2), db/schema.sql).
const MIN_SCORE_VALUE = 0;
const MAX_SCORE_VALUE = 10;
const SCORE_VALUE_DECIMALS = 2;

// true si `value` es una nota válida: un número de 0 a 10 con hasta dos decimales. Con más
// decimales PostgreSQL la redondearía y quedaría guardada otra nota que la enviada.
function isScoreValue(value) {
  return (
    Number.isFinite(value) &&
    value >= MIN_SCORE_VALUE &&
    value <= MAX_SCORE_VALUE &&
    Number(value.toFixed(SCORE_VALUE_DECIMALS)) === value
  );
}

// ---------- Calificaciones de una evaluación del profesor ----------

// Lista explícita de campos, como toListedCourse (course.service.js): lo que muestran de cada
// alumno la tabla de Calificaciones del Profesor y su filtro, y el id de su inscripción para
// identificar la fila. `score` es la calificación de esa inscripción en la evaluación, si ya la
// tiene: `value` es su nota, o null si todavía no fue calificada. `isEnrollmentActive` indica si la
// inscripción está activa, que es cuando la nota se puede cargar o corregir.
function toListedScore(enrollment, score) {
  return {
    enrollmentId: enrollment.id,
    student: toListedStudent(enrollment.student),
    value: score ? score.value : null,
    isEnrollmentActive: enrollment.isActive,
  };
}

// Calificaciones de una evaluación vigente de una asignación docente vigente a cargo de
// `currentUser` (el profesor de la sesión): una por cada inscripción del curso de la asignación,
// en cualquier estado y en el orden de las inscripciones (por alumno), tenga o no una nota cargada.
// Los ids llegan del renderer, así que antes se comprueba que la asignación sea suya y que la
// evaluación sea de esa asignación (getOwnAssignmentEvaluation): el curso sale de la asignación y
// nunca de lo que envía el renderer.
// Devuelve { evaluation, scores }, con la evaluación como en listOwnAssignmentEvaluations.
// Lanza los errores de getOwnAssignmentEvaluation: TEACHER_ASSIGNMENT_NOT_FOUND y
// EVALUATION_NOT_FOUND.
async function listOwnEvaluationScores(currentUser, teacherAssignmentId, evaluationId) {
  const { teacherAssignment, evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );
  const enrollments = await enrollmentRepository.findByCourse(teacherAssignment.course.id);
  const scores = await scoreRepository.findByEvaluation(evaluation.id);
  const scoreByEnrollmentId = new Map(scores.map((score) => [score.enrollmentId, score]));
  return {
    evaluation,
    scores: enrollments.map((enrollment) => toListedScore(enrollment, scoreByEnrollmentId.get(enrollment.id))),
  };
}

// ---------- Carga y corrección ----------

// Guarda la nota de una inscripción en una evaluación: si ya tiene una, se corrige esa fila
// (UPDATE); si no, se carga la primera (INSERT). Si otra sesión la cargó entre las dos consultas,
// PostgreSQL rechaza el alta por duplicada y entonces se corrige la fila que ya existe: una
// calificación no se borra, así que sigue ahí.
async function createOrUpdateScore(evaluationId, enrollmentId, value) {
  const updatedScore = await scoreRepository.update(evaluationId, enrollmentId, value);
  if (updatedScore) return updatedScore;
  try {
    return await scoreRepository.create(evaluationId, enrollmentId, value);
  } catch (error) {
    if (!scoreRepository.isDuplicateError(error)) throw error;
    return scoreRepository.update(evaluationId, enrollmentId, value);
  }
}

// Guarda la nota de un alumno en una evaluación vigente de una asignación docente vigente a cargo
// de `currentUser` (el profesor de la sesión) y devuelve { enrollmentId, value }, con la nota como
// quedó guardada. `data` trae enrollmentId (el id de la inscripción del alumno, una de las de
// listOwnEvaluationScores) y value (la nota). La primera nota de la inscripción en esa evaluación
// se inserta y las siguientes modifican esa misma fila.
// La nota tiene que ser un número de 0 a 10 con hasta dos decimales: si no, no se guarda nada y se
// lanza un ScoreError INVALID_SCORE.
// La inscripción tiene que ser del curso de la asignación y estar activa. Las dos reglas las aplica
// PostgreSQL al guardar (trg_calificacion_coherencia, db/schema.sql), así que valen también si la
// inscripción cambia mientras tanto: se lanza un ScoreError ENROLLMENT_NOT_FOUND si no existe o es
// de otro curso, sin distinguir los casos, y ENROLLMENT_NOT_ACTIVE si fue cancelada, finalizada o
// trasladada.
// También lanza los errores de getOwnAssignmentEvaluation: TEACHER_ASSIGNMENT_NOT_FOUND y
// EVALUATION_NOT_FOUND.
async function saveOwnEvaluationScore(currentUser, teacherAssignmentId, evaluationId, { enrollmentId, value }) {
  if (!isScoreValue(value)) {
    throw new ScoreError(
      'INVALID_SCORE',
      `La calificación tiene que ser un número de ${MIN_SCORE_VALUE} a ${MAX_SCORE_VALUE}, con hasta dos decimales.`
    );
  }
  const { evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );

  let score;
  try {
    score = await createOrUpdateScore(evaluation.id, enrollmentId, value);
  } catch (error) {
    if (scoreRepository.isEnrollmentNotInCourseError(error)) {
      throw new ScoreError('ENROLLMENT_NOT_FOUND', 'El alumno no está inscripto en el curso de esta evaluación.');
    }
    if (scoreRepository.isEnrollmentNotActiveError(error)) {
      throw new ScoreError(
        'ENROLLMENT_NOT_ACTIVE',
        'La inscripción del alumno no está activa: su calificación no se puede cargar ni modificar.'
      );
    }
    throw error;
  }
  return { enrollmentId: score.enrollmentId, value: score.value };
}

module.exports = { listOwnEvaluationScores, saveOwnEvaluationScore, ScoreError };
