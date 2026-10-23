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
// identificar la fila. `score` es la calificación vigente de esa inscripción en la evaluación, si
// la tiene: `value` es su nota, o null si todavía no fue calificada o su calificación se dio de
// baja. `isEnrollmentActive` indica si la inscripción está activa, que es cuando la nota se puede
// cargar, corregir o dar de baja; si es false, la inscripción está finalizada y su nota es de solo
// lectura.
function toListedScore(enrollment, score) {
  return {
    enrollmentId: enrollment.id,
    student: toListedStudent(enrollment.student),
    value: score ? score.value : null,
    isEnrollmentActive: enrollment.isActive,
  };
}

// Calificaciones de una evaluación vigente de una asignación docente vigente a cargo de
// `currentUser` (el profesor de la sesión): una por cada inscripción vigente, activa o finalizada,
// del curso de la asignación, en el orden de las inscripciones (por alumno), tenga o no una nota
// cargada. Las inscripciones canceladas o dadas de baja no se listan, ni sus calificaciones. Una
// calificación dada de baja no cuenta: su inscripción se lista igual, sin nota.
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
  const enrollments = await enrollmentRepository.findActiveOrFinishedByCourse(teacherAssignment.course.id);
  const scores = await scoreRepository.findByEvaluation(evaluation.id);
  const scoreByEnrollmentId = new Map(scores.map((score) => [score.enrollmentId, score]));
  return {
    evaluation,
    scores: enrollments.map((enrollment) => toListedScore(enrollment, scoreByEnrollmentId.get(enrollment.id))),
  };
}

// ---------- Carga y corrección ----------

// Guarda la nota de una inscripción en una evaluación: si ya tiene una calificación vigente, se
// corrige esa fila (UPDATE); si no, se carga una (INSERT), aunque haya tenido otra que se dio de
// baja, que queda como está. Si otra sesión la cargó entre las dos consultas, PostgreSQL rechaza el
// alta por duplicada y entonces se corrige la fila que ya existe; si para entonces también la dio
// de baja, se carga una nueva.
async function createOrUpdateScore(evaluationId, enrollmentId, value) {
  const updatedScore = await scoreRepository.update(evaluationId, enrollmentId, value);
  if (updatedScore) return updatedScore;
  try {
    return await scoreRepository.create(evaluationId, enrollmentId, value);
  } catch (error) {
    if (!scoreRepository.isDuplicateError(error)) throw error;
    return (
      (await scoreRepository.update(evaluationId, enrollmentId, value)) ??
      scoreRepository.create(evaluationId, enrollmentId, value)
    );
  }
}

// Guarda la nota de un alumno en una evaluación vigente de una asignación docente vigente a cargo
// de `currentUser` (el profesor de la sesión) y devuelve { enrollmentId, value }, con la nota como
// quedó guardada. `data` trae enrollmentId (el id de la inscripción del alumno, una de las de
// listOwnEvaluationScores) y value (la nota). La primera nota de la inscripción en esa evaluación
// se inserta y las siguientes modifican esa misma fila, hasta que se da de baja: la que se cargue
// después se inserta otra vez.
// La nota tiene que ser un número de 0 a 10 con hasta dos decimales: si no, no se guarda nada y se
// lanza un ScoreError INVALID_SCORE.
// La inscripción tiene que ser del curso de la asignación y estar activa. Las dos reglas las aplica
// PostgreSQL al guardar (trg_calificacion_coherencia, db/schema.sql), así que valen también si la
// inscripción cambia mientras tanto: se lanza un ScoreError ENROLLMENT_NOT_FOUND si no existe o es
// de otro curso, sin distinguir los casos, y ENROLLMENT_NOT_ACTIVE si fue finalizada o cancelada.
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

// ---------- Baja ----------

// Baja lógica de la calificación vigente de un alumno en una evaluación vigente de una asignación
// docente vigente a cargo de `currentUser` (el profesor de la sesión): la fila queda con su última
// nota y su fecha de baja, y deja de contar. El alumno sigue en listOwnEvaluationScores, ahora sin
// nota, y se le puede cargar otra (saveOwnEvaluationScore). `enrollmentId` es el id de la
// inscripción del alumno, una de las de listOwnEvaluationScores. Los ids llegan del renderer, así
// que antes se comprueba que la asignación sea suya y que la evaluación sea de esa asignación
// (getOwnAssignmentEvaluation), y la baja solo alcanza a una calificación de esa evaluación.
// Devuelve { enrollmentId, value: null }: la calificación del alumno como queda en
// listOwnEvaluationScores, sin nota.
// Lanza un ScoreError SCORE_NOT_FOUND si la inscripción no tiene una calificación vigente en la
// evaluación: nunca la tuvo, ya se dio de baja o la inscripción no existe o es de otro curso, sin
// distinguir los casos. La inscripción tiene que estar activa, como al cargar la nota o corregirla:
// la regla la aplica PostgreSQL al dar de baja (trg_calificacion_coherencia, db/schema.sql) y se
// lanza un ScoreError ENROLLMENT_NOT_ACTIVE si fue finalizada o cancelada.
// También lanza los errores de getOwnAssignmentEvaluation: TEACHER_ASSIGNMENT_NOT_FOUND y
// EVALUATION_NOT_FOUND.
async function deleteOwnEvaluationScore(currentUser, teacherAssignmentId, evaluationId, enrollmentId) {
  const { evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );

  let deletedScore;
  try {
    deletedScore = await scoreRepository.markAsDeleted(evaluation.id, enrollmentId);
  } catch (error) {
    if (scoreRepository.isEnrollmentNotActiveError(error)) {
      throw new ScoreError(
        'ENROLLMENT_NOT_ACTIVE',
        'La inscripción del alumno no está activa: su calificación no se puede eliminar.'
      );
    }
    throw error;
  }
  if (!deletedScore) {
    throw new ScoreError('SCORE_NOT_FOUND', 'El alumno no tiene una calificación cargada en esta evaluación.');
  }
  return { enrollmentId: deletedScore.enrollmentId, value: null };
}

module.exports = { listOwnEvaluationScores, saveOwnEvaluationScore, deleteOwnEvaluationScore, ScoreError };
