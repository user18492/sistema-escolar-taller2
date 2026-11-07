const scoreRepository = require('../repositories/score.repository');
const enrollmentRepository = require('../repositories/enrollment.repository');
const evaluationService = require('./evaluation.service');
const schoolYearService = require('./school-year.service');
const teacherAssignmentService = require('./teacher-assignment.service');
const { toListedStudent } = require('./enrollment.service');

// Error previsto, con un mensaje apto para la UI (como TeacherAssignmentError en
// teacher-assignment.service.js). En el guardado de varias calificaciones
// (saveOwnEvaluationScores), `enrollmentId` es la inscripción del cambio rechazado, si el error es
// de uno solo.
class ScoreError extends Error {
  constructor(code, message, enrollmentId) {
    super(message);
    this.name = 'ScoreError';
    this.code = code;
    if (enrollmentId !== undefined) this.enrollmentId = enrollmentId;
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

// La nota no es válida (isScoreValue). `enrollmentId`, como en ScoreError.
function invalidScoreError(enrollmentId) {
  return new ScoreError(
    'INVALID_SCORE',
    `La calificación tiene que ser un número de ${MIN_SCORE_VALUE} a ${MAX_SCORE_VALUE}, con hasta dos decimales.`,
    enrollmentId
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

// ---------- Trimestre cerrado ----------

// En una evaluación de un trimestre cerrado no se carga, no se corrige ni se da de baja ninguna
// calificación: quedan como estaban al cerrarse.
function closedTermError() {
  return new ScoreError('TERM_CLOSED', schoolYearService.closedTermMessage());
}

// Lanza el ScoreError TERM_CLOSED si `evaluation` (la de getOwnAssignmentEvaluation, con
// isTermClosed calculado por la base al consultarla) es de un trimestre cerrado. Se comprueba
// después del ciclo lectivo y antes que lo demás; si el trimestre se cierra en el medio, la base
// rechaza la escritura (trg_calificacion_trimestre_cerrado, db/schema.sql) y ese rechazo se traduce
// al mismo error.
function assertTermNotClosed(evaluation) {
  if (evaluation.isTermClosed) throw closedTermError();
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
// no se cargan, no se corrigen ni se dan de baja. `action` completa el mensaje y `enrollmentId` es
// como en ScoreError.
function enrollmentDeletedError(action, enrollmentId) {
  return new ScoreError(
    'ENROLLMENT_DELETED',
    `La inscripción del alumno fue eliminada: su calificación no se puede ${action}.`,
    enrollmentId
  );
}

// La inscripción `enrollmentId` del curso `courseId` (el de la asignación) tiene que estar vigente,
// sin baja lógica. Una dada de baja ya no se lista (listOwnEvaluationScores), pero la vista del
// profesor pudo quedar abierta desde antes de la baja y el id llega del renderer: se comprueba acá,
// antes de escribir. PostgreSQL lo vuelve a comprobar al escribir (trg_calificacion_coherencia,
// db/schema.sql), por si la baja llega en el medio, y ese rechazo se traduce al mismo error.
// Solo se busca en el curso de la asignación: una inscripción que no existe o es de otro curso pasa
// y la rechaza después PostgreSQL, como siempre. Lanza enrollmentDeletedError(action), con el
// enrollmentId.
async function assertEnrollmentNotDeleted(courseId, enrollmentId, action) {
  if (await enrollmentRepository.isDeletedInCourse(enrollmentId, courseId)) {
    throw enrollmentDeletedError(action, enrollmentId);
  }
}

// ---------- Rechazos de PostgreSQL al escribir ----------

// Lo que completa los mensajes de la inscripción según el cambio: cargar o corregir una nota, o dar
// de baja la calificación (value null)
const SAVE_ACTION = 'cargar ni modificar';
const DELETE_ACTION = 'eliminar';

// Traduce el rechazo de PostgreSQL a una escritura de calificaciones (create, update, markAsDeleted o
// saveChanges de score.repository.js) en una evaluación de `teacherAssignment` al ScoreError que le
// corresponde, o al EVALUATION_NOT_FOUND de getOwnAssignmentEvaluation si la evaluación se dio de
// baja después de consultarla; un error no previsto se devuelve como está. `action` completa los
// mensajes de la inscripción (SAVE_ACTION o DELETE_ACTION). El enrollmentId que saveChanges deja en
// el error pasa al ScoreError en los errores de la inscripción, que son de un cambio.
function translateWriteError(error, teacherAssignment, action) {
  const { enrollmentId } = error;
  if (scoreRepository.isClosedSchoolYearError(error)) {
    return closedSchoolYearError(teacherAssignment.course.schoolYear);
  }
  if (scoreRepository.isClosedTermError(error)) {
    return closedTermError();
  }
  // La evaluación se dio de baja o pasó a una fecha futura después de consultarla
  if (scoreRepository.isEvaluationDeletedError(error)) {
    return evaluationService.evaluationNotFoundError();
  }
  if (scoreRepository.isFutureEvaluationError(error)) {
    return futureEvaluationError();
  }
  // Una inscripción posterior a la fecha de la evaluación no está en listOwnEvaluationScores: para
  // la vista es como una que no es del curso
  if (scoreRepository.isEnrollmentNotInCourseError(error) || scoreRepository.isBeforeEnrollmentError(error)) {
    return new ScoreError(
      'ENROLLMENT_NOT_FOUND',
      'El alumno no está inscripto en el curso de esta evaluación.',
      enrollmentId
    );
  }
  if (scoreRepository.isEnrollmentDeletedError(error)) {
    return enrollmentDeletedError(action, enrollmentId);
  }
  if (scoreRepository.isEnrollmentNotActiveError(error)) {
    return new ScoreError(
      'ENROLLMENT_NOT_ACTIVE',
      `La inscripción del alumno no está activa: su calificación no se puede ${action}.`,
      enrollmentId
    );
  }
  return error;
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
// del curso de la asignación, con una fecha de inscripción que no es posterior a la de la
// evaluación, en el orden de las inscripciones (por alumno), tenga o no una nota cargada. Las
// inscripciones canceladas o dadas de baja no se listan, ni sus calificaciones, y las posteriores a
// la evaluación tampoco: no se las califica en ella. Una calificación dada de baja no cuenta: su
// inscripción se lista igual, sin nota.
// Los ids llegan del renderer, así que antes se comprueba que la asignación sea suya y que la
// evaluación sea de esa asignación (getOwnAssignmentEvaluation): el curso sale de la asignación y
// nunca de lo que envía el renderer.
// Devuelve { evaluation, scores }, con la evaluación como en getOwnAssignmentEvaluation, que trae
// isTermClosed: si su trimestre está cerrado, sus calificaciones son de solo lectura.
// Lanza los errores de getOwnAssignmentEvaluation: TEACHER_ASSIGNMENT_NOT_FOUND y
// EVALUATION_NOT_FOUND.
async function listOwnEvaluationScores(currentUser, teacherAssignmentId, evaluationId) {
  const { teacherAssignment, evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );
  const enrollments = await enrollmentRepository.findActiveOrFinishedByCourseEnrolledBy(
    teacherAssignment.course.id,
    evaluation.evaluationDate
  );
  const scores = await scoreRepository.findByEvaluation(evaluation.id);
  const scoreByEnrollmentId = new Map(scores.map((score) => [score.enrollmentId, score]));
  return {
    evaluation,
    scores: enrollments.map((enrollment) => toListedScore(enrollment, scoreByEnrollmentId.get(enrollment.id))),
  };
}

// ---------- Carga y corrección ----------

// Guarda la nota de un alumno en una evaluación vigente de una asignación docente vigente a cargo
// de `currentUser` (el profesor de la sesión) y devuelve { enrollmentId, value }, con la nota como
// quedó guardada. `data` trae enrollmentId (el id de la inscripción del alumno, una de las de
// listOwnEvaluationScores) y value (la nota). La primera nota de la inscripción en esa evaluación
// se inserta y las siguientes modifican esa misma fila, hasta que se da de baja: la que se cargue
// después se inserta otra vez.
// La nota tiene que ser un número de 0 a 10 con hasta dos decimales: si no, no se guarda nada y se
// lanza un ScoreError INVALID_SCORE.
// La inscripción tiene que ser del curso de la asignación, no posterior a la fecha de la
// evaluación, estar vigente (sin baja lógica) y estar activa. Las cuatro reglas las aplica
// PostgreSQL al guardar (trg_calificacion_coherencia, db/schema.sql), así que valen también si la
// inscripción cambia mientras tanto; la baja, además, se comprueba antes
// (assertEnrollmentNotDeleted). Se lanza un ScoreError ENROLLMENT_NOT_FOUND si no existe, es de otro
// curso o es posterior a la evaluación (no está en listOwnEvaluationScores), sin distinguir los
// casos, ENROLLMENT_DELETED si se dio de baja y ENROLLMENT_NOT_ACTIVE si fue finalizada o cancelada.
// También lanza los errores de getOwnAssignmentEvaluation: TEACHER_ASSIGNMENT_NOT_FOUND y
// EVALUATION_NOT_FOUND, un ScoreError SCHOOL_YEAR_CLOSED si la evaluación es de un curso de un
// ciclo lectivo cerrado, un ScoreError TERM_CLOSED si es de un trimestre cerrado y un ScoreError
// EVALUATION_IN_FUTURE si su fecha todavía no llegó, con la fecha de la base
// (assertEvaluationTaken). Se comprueban en ese orden, y todos ganan a INVALID_SCORE y a los errores
// de la inscripción. Si el trimestre se cierra en el medio, el rechazo de PostgreSQL se traduce a
// TERM_CLOSED. PostgreSQL vuelve a comprobar al guardar que la
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
  assertTermNotClosed(evaluation);
  await assertEvaluationTaken(evaluation);
  if (!isScoreValue(value)) throw invalidScoreError();
  await assertEnrollmentNotDeleted(teacherAssignment.course.id, enrollmentId, SAVE_ACTION);

  let savedScores;
  try {
    savedScores = await scoreRepository.saveChanges(evaluation.id, [{ enrollmentId, value }]);
  } catch (error) {
    throw translateWriteError(error, teacherAssignment, SAVE_ACTION);
  }
  return savedScores[0];
}

// ---------- Guardado de varias calificaciones ----------

// Guarda de una vez los cambios que el profesor hizo en las calificaciones de una evaluación
// vigente de una asignación docente vigente a cargo de `currentUser` (el profesor de la sesión):
// `changes` es [{ enrollmentId, value }], uno por inscripción (una de las de
// listOwnEvaluationScores). Con una nota, se carga o se corrige como en saveOwnEvaluationScore; con
// value null, se da de baja la calificación vigente de la inscripción, como en
// deleteOwnEvaluationScore, salvo que si no tiene ninguna (ya la dio de baja otra sesión) no es un
// error: el alumno queda sin nota, que es lo que se pidió.
// O se guardan todos los cambios o ninguno (una sola transacción, scoreRepository.saveChanges).
// Devuelve [{ enrollmentId, value }], uno por cambio, en el orden de las inscripciones, con cada nota
// como quedó guardada (null en las bajas).
// Errores: los de getOwnAssignmentEvaluation (TEACHER_ASSIGNMENT_NOT_FOUND y EVALUATION_NOT_FOUND),
// SCHOOL_YEAR_CLOSED, TERM_CLOSED y EVALUATION_IN_FUTURE, en ese orden y antes que los de cada
// cambio, como en saveOwnEvaluationScore (en una evaluación con fecha futura no hay calificaciones que dar de baja:
// trg_evaluacion_futura_calificaciones_vigentes, db/schema.sql). Después, los de los cambios, con
// el enrollmentId del rechazado: INVALID_SCORE (antes de escribir nada), ENROLLMENT_DELETED,
// ENROLLMENT_NOT_FOUND y ENROLLMENT_NOT_ACTIVE, como en saveOwnEvaluationScore y, en las bajas, como
// en deleteOwnEvaluationScore. PostgreSQL vuelve a comprobar al guardar lo de la evaluación y lo de
// cada inscripción, como en saveOwnEvaluationScore.
async function saveOwnEvaluationScores(currentUser, teacherAssignmentId, evaluationId, changes) {
  const { teacherAssignment, evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );
  await assertSchoolYearNotClosed(teacherAssignment);
  assertTermNotClosed(evaluation);
  await assertEvaluationTaken(evaluation);
  const invalidChange = changes.find(({ value }) => value !== null && !isScoreValue(value));
  if (invalidChange) throw invalidScoreError(invalidChange.enrollmentId);
  const actionOf = (enrollmentId) =>
    (changes.find((change) => change.enrollmentId === enrollmentId)?.value === null ? DELETE_ACTION : SAVE_ACTION);
  for (const { enrollmentId } of changes) {
    await assertEnrollmentNotDeleted(teacherAssignment.course.id, enrollmentId, actionOf(enrollmentId));
  }

  try {
    return await scoreRepository.saveChanges(evaluation.id, changes);
  } catch (error) {
    throw translateWriteError(error, teacherAssignment, actionOf(error.enrollmentId));
  }
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
// EVALUATION_NOT_FOUND, un ScoreError SCHOOL_YEAR_CLOSED si la evaluación es de un curso de un
// ciclo lectivo cerrado y un ScoreError TERM_CLOSED si es de un trimestre cerrado (también si se
// cierra mientras tanto), en ese orden, que ganan a los errores de la inscripción y a
// SCORE_NOT_FOUND. La baja de la calificación de una inscripción posterior a la evaluación sigue
// permitida.
async function deleteOwnEvaluationScore(currentUser, teacherAssignmentId, evaluationId, enrollmentId) {
  const { teacherAssignment, evaluation } = await evaluationService.getOwnAssignmentEvaluation(
    currentUser,
    teacherAssignmentId,
    evaluationId
  );
  await assertSchoolYearNotClosed(teacherAssignment);
  assertTermNotClosed(evaluation);
  await assertEnrollmentNotDeleted(teacherAssignment.course.id, enrollmentId, DELETE_ACTION);

  let deletedScore;
  try {
    deletedScore = await scoreRepository.markAsDeleted(evaluation.id, enrollmentId);
  } catch (error) {
    throw translateWriteError(error, teacherAssignment, DELETE_ACTION);
  }
  if (!deletedScore) {
    throw new ScoreError('SCORE_NOT_FOUND', 'El alumno no tiene una calificación cargada en esta evaluación.');
  }
  return { enrollmentId: deletedScore.enrollmentId, value: null };
}

// ---------- Promedios ----------

// Lista explícita de campos: lo que muestran las vistas de un promedio, a partir de una fila de
// scoreRepository.findAverages. `terms` son los tres trimestres en orden ({ term, value, isFinal },
// con term 1, 2 o 3) y `annual`, el anual ({ value, isFinal }). `value` es el promedio, un número
// con hasta dos decimales, o null si no hay evaluaciones tomadas. `isFinal` indica si es definitivo:
// en un trimestre, que está cerrado; en el anual, que el ciclo lectivo está cerrado o la inscripción
// está finalizada. Sin valor, isFinal es false: no hay nada que marcar.
function toListedAverages({ termAverages, closedTerms, annualAverage, isAnnualFinal }) {
  return {
    terms: termAverages.map((value, index) => ({
      term: index + 1,
      value,
      isFinal: value !== null && closedTerms[index],
    })),
    annual: { value: annualAverage, isFinal: annualAverage !== null && isAnnualFinal },
  };
}

// Promedios, en la materia de una asignación docente vigente a cargo de `currentUser` (el profesor
// de la sesión), de las mismas inscripciones que lista enrollmentService.listOwnAssignmentEnrollments
// (las vigentes, activas y finalizadas del curso de la asignación), en su mismo orden:
// [{ enrollmentId, terms, annual }], con terms y annual como en toListedAverages. El id de la
// asignación llega del renderer, así que antes se comprueba que sea suya (getOwnTeacherAssignment).
// Lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la
// asignación no existe, fue dada de baja o es de otro profesor.
async function listOwnAssignmentAverages(currentUser, teacherAssignmentId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const enrollments = await enrollmentRepository.findActiveOrFinishedByCourse(teacherAssignment.course.id);
  const averages = await scoreRepository.findAverages(
    enrollments.map(({ id }) => id),
    teacherAssignment.id
  );
  const averagesByEnrollmentId = new Map(averages.map((row) => [row.enrollmentId, row]));
  // Toda inscripción del curso tiene fila (la asignación es vigente y de su curso); si alguna
  // cambió entre las dos consultas y no la tiene, no se lista
  return enrollments
    .filter(({ id }) => averagesByEnrollmentId.has(id))
    .map(({ id }) => ({ enrollmentId: id, ...toListedAverages(averagesByEnrollmentId.get(id)) }));
}

module.exports = {
  toListedAverages,
  listOwnAssignmentAverages,
  listOwnEvaluationScores,
  saveOwnEvaluationScore,
  saveOwnEvaluationScores,
  deleteOwnEvaluationScore,
  ScoreError,
};
