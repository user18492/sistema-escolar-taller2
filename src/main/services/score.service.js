const scoreRepository = require('../repositories/score.repository');
const enrollmentRepository = require('../repositories/enrollment.repository');
const evaluationService = require('./evaluation.service');
const schoolYearService = require('./school-year.service');
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

// ---------- Ciclo lectivo cerrado ----------

// Lo de un ciclo lectivo cerrado es de solo lectura: en una evaluación de un curso de un ciclo
// anterior al actual no se cargan, no se corrigen ni se dan de baja calificaciones. `schoolYear` es
// el ciclo lectivo de ese curso.
function closedSchoolYearError(schoolYear) {
  return new ScoreError('SCHOOL_YEAR_CLOSED', schoolYearService.closedSchoolYearMessage(schoolYear));
}

// Lanza el ScoreError SCHOOL_YEAR_CLOSED si el curso de `teacherAssignment` (la de
// getOwnAssignmentEvaluation) es de un ciclo lectivo cerrado. Se comprueba apenas se comprueban la
// asignación y la evaluación, antes de validar la nota, para que gane a los demás errores; si el
// ciclo se cierra en el medio, la base rechaza la escritura y ese rechazo se traduce al mismo error.
async function assertSchoolYearNotClosed(teacherAssignment) {
  const { schoolYear } = teacherAssignment.course;
  if (await schoolYearService.isClosedSchoolYear(schoolYear)) {
    throw closedSchoolYearError(schoolYear);
  }
}

// ---------- Evaluación ya tomada ----------

// Una calificación se carga o se corrige a partir de la fecha de su evaluación: antes, la evaluación
// todavía no se tomó.
function futureEvaluationError() {
  return new ScoreError(
    'EVALUATION_IN_FUTURE',
    'La evaluación todavía no se tomó: se puede calificar a partir de su fecha.'
  );
}

// Lanza el ScoreError EVALUATION_IN_FUTURE si la fecha de `evaluation` (la de
// getOwnAssignmentEvaluation, 'AAAA-MM-DD') es posterior a hoy, con la fecha de la base
// (getCurrentSchoolYear). Si la evaluación pasa a una fecha futura en el medio, la base rechaza la
// escritura (trg_calificacion_coherencia, db/schema.sql) y ese rechazo se traduce al mismo error.
async function assertEvaluationTaken(evaluation) {
  const { today } = await schoolYearService.getCurrentSchoolYear();
  if (evaluation.evaluationDate > today) throw futureEvaluationError();
}

// ---------- Inscripción vigente ----------

// La inscripción del alumno se dio de baja (baja lógica): sus calificaciones se conservan, pero ya
// no se cargan, no se corrigen ni se dan de baja. `action` completa el mensaje.
function enrollmentDeletedError(action) {
  return new ScoreError(
    'ENROLLMENT_DELETED',
    `La inscripción del alumno fue eliminada: su calificación no se puede ${action}.`
  );
}

// La inscripción `enrollmentId` del curso `courseId` (el de la asignación) tiene que estar vigente,
// sin baja lógica. Una dada de baja ya no se lista (listOwnEvaluationScores), pero la vista del
// profesor pudo quedar abierta desde antes de la baja y el id llega del renderer: se comprueba acá,
// antes de escribir. PostgreSQL lo vuelve a comprobar al escribir (trg_calificacion_coherencia,
// db/schema.sql), por si la baja llega en el medio, y ese rechazo se traduce al mismo error.
// Solo se busca en el curso de la asignación: una inscripción que no existe o es de otro curso pasa
// y la rechaza después PostgreSQL, como siempre. Lanza enrollmentDeletedError(action).
async function assertEnrollmentNotDeleted(courseId, enrollmentId, action) {
  if (await enrollmentRepository.isDeletedInCourse(enrollmentId, courseId)) {
    throw enrollmentDeletedError(action);
  }
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
// Devuelve { evaluation, scores }, con la evaluación como en getOwnAssignmentEvaluation.
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
// La inscripción tiene que ser del curso de la asignación, estar vigente (sin baja lógica) y estar
// activa. Las tres reglas las aplica PostgreSQL al guardar (trg_calificacion_coherencia,
// db/schema.sql), así que valen también si la inscripción cambia mientras tanto; la baja, además,
// se comprueba antes (assertEnrollmentNotDeleted). Se lanza un ScoreError ENROLLMENT_NOT_FOUND si
// no existe o es de otro curso, sin distinguir los casos, ENROLLMENT_DELETED si se dio de baja y
// ENROLLMENT_NOT_ACTIVE si fue finalizada o cancelada.
// También lanza los errores de getOwnAssignmentEvaluation: TEACHER_ASSIGNMENT_NOT_FOUND y
// EVALUATION_NOT_FOUND, un ScoreError SCHOOL_YEAR_CLOSED si la evaluación es de un curso de un
// ciclo lectivo cerrado y un ScoreError EVALUATION_IN_FUTURE si su fecha todavía no llegó, con la
// fecha de la base (assertEvaluationTaken). Se comprueban en ese orden, y todos ganan a
// INVALID_SCORE y a los errores de la inscripción. PostgreSQL vuelve a comprobar al guardar que la
// evaluación siga vigente y que su fecha ya haya llegado (trg_calificacion_coherencia), por si
// cambia en el medio: esos rechazos se traducen a EVALUATION_NOT_FOUND, con el mismo mensaje que
// el de getOwnAssignmentEvaluation, y a EVALUATION_IN_FUTURE.
async function saveOwnEvaluationScore(currentUser, teacherAssignmentId, evaluationId, { enrollmentId, value }) {
  const { teacherAssignment, evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );
  await assertSchoolYearNotClosed(teacherAssignment);
  await assertEvaluationTaken(evaluation);
  if (!isScoreValue(value)) {
    throw new ScoreError(
      'INVALID_SCORE',
      `La calificación tiene que ser un número de ${MIN_SCORE_VALUE} a ${MAX_SCORE_VALUE}, con hasta dos decimales.`
    );
  }
  await assertEnrollmentNotDeleted(teacherAssignment.course.id, enrollmentId, 'cargar ni modificar');

  let score;
  try {
    score = await createOrUpdateScore(evaluation.id, enrollmentId, value);
  } catch (error) {
    if (scoreRepository.isClosedSchoolYearError(error)) {
      throw closedSchoolYearError(teacherAssignment.course.schoolYear);
    }
    // La evaluación se dio de baja o pasó a una fecha futura después de consultarla
    if (scoreRepository.isEvaluationDeletedError(error)) {
      throw evaluationService.evaluationNotFoundError();
    }
    if (scoreRepository.isFutureEvaluationError(error)) {
      throw futureEvaluationError();
    }
    if (scoreRepository.isEnrollmentNotInCourseError(error)) {
      throw new ScoreError('ENROLLMENT_NOT_FOUND', 'El alumno no está inscripto en el curso de esta evaluación.');
    }
    if (scoreRepository.isEnrollmentDeletedError(error)) {
      throw enrollmentDeletedError('cargar ni modificar');
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
// distinguir los casos. La inscripción tiene que estar vigente y activa, como al cargar la nota o
// corregirla: las dos reglas las aplica PostgreSQL al dar de baja (trg_calificacion_coherencia,
// db/schema.sql), y la baja de la inscripción, además, se comprueba antes
// (assertEnrollmentNotDeleted). Se lanza un ScoreError ENROLLMENT_DELETED si la inscripción se dio
// de baja, tenga o no una calificación vigente, y ENROLLMENT_NOT_ACTIVE si fue finalizada o
// cancelada.
// También lanza los errores de getOwnAssignmentEvaluation: TEACHER_ASSIGNMENT_NOT_FOUND y
// EVALUATION_NOT_FOUND, y un ScoreError SCHOOL_YEAR_CLOSED si la evaluación es de un curso de un
// ciclo lectivo cerrado, que gana a los errores de la inscripción y a SCORE_NOT_FOUND.
async function deleteOwnEvaluationScore(currentUser, teacherAssignmentId, evaluationId, enrollmentId) {
  const { teacherAssignment, evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );
  await assertSchoolYearNotClosed(teacherAssignment);
  await assertEnrollmentNotDeleted(teacherAssignment.course.id, enrollmentId, 'eliminar');

  let deletedScore;
  try {
    deletedScore = await scoreRepository.markAsDeleted(evaluation.id, enrollmentId);
  } catch (error) {
    if (scoreRepository.isClosedSchoolYearError(error)) {
      throw closedSchoolYearError(teacherAssignment.course.schoolYear);
    }
    if (scoreRepository.isEnrollmentDeletedError(error)) {
      throw enrollmentDeletedError('eliminar');
    }
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
