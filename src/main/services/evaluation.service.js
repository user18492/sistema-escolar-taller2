const evaluationRepository = require('../repositories/evaluation.repository');
const scoreRepository = require('../repositories/score.repository');
const teacherAssignmentService = require('./teacher-assignment.service');
const schoolYearService = require('./school-year.service');
const { isRealDate, toIsoDate } = require('./user.service');

// Error previsto, con un mensaje apto para la UI (como TeacherAssignmentError en
// teacher-assignment.service.js).
// `fieldErrors` ({ campo: mensaje }), si llega, indica qué campos del formulario están mal.
class EvaluationError extends Error {
  constructor(code, message, fieldErrors) {
    super(message);
    this.name = 'EvaluationError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

// ---------- Validación de los datos del formulario ----------

// Mismas reglas que field-validation.component.js (title y day-month), que el proceso principal no
// puede importar: si cambian allá, hay que cambiarlas acá.
const REQUIRED_MESSAGE = 'Campo obligatorio.';

// Largo de la columna evaluacion.titulo.
const TITLE_MAX_LENGTH = 100;

// Sin caracteres de control y con espacios simples, como queda el campo al salir de él.
function normalizeTitle(value) {
  return value.replace(/\p{Cc}/gu, '').trim().replace(/\s+/g, ' ');
}

// Recibe el título ya normalizado.
function checkTitle(value) {
  if (!value) return REQUIRED_MESSAGE;
  if (value.length > TITLE_MAX_LENGTH) return `Máximo ${TITLE_MAX_LENGTH} caracteres.`;
  return /[\p{L}\d]/u.test(value) ? '' : 'El título debe incluir letras o números.';
}

// Recibe 'AAAA-MM-DD' y el ciclo lectivo del curso de la asignación (`schoolYear`). El ciclo
// lectivo es un año: una fecha está dentro de él si es de ese año.
function checkEvaluationDate(value, schoolYear) {
  if (!value) return REQUIRED_MESSAGE;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'La fecha no es válida.';
  const [year, month, day] = match.slice(1).map(Number);
  if (!isRealDate(year, month, day)) return `La fecha no existe en ${year}.`;
  return year === schoolYear ? '' : `La fecha debe ser del ciclo lectivo ${schoolYear}.`;
}

function invalidFieldsError(fieldErrors) {
  return new EvaluationError('INVALID_INPUT', 'Revisá los datos marcados.', fieldErrors);
}

// Normaliza los datos del formulario de evaluación (el controlador ya verificó que sean strings) y
// devuelve solo los campos que se guardan. Lanza un EvaluationError INVALID_INPUT con los
// fieldErrors de los campos que no son válidos: el título vacío o sin letras ni números, y la fecha
// que no existe en el calendario o que no es de `schoolYear`, el ciclo lectivo de la asignación.
function parseEvaluationData(data, schoolYear) {
  const values = {
    title: normalizeTitle(data.title),
    evaluationDate: data.evaluationDate.trim(),
  };

  const fieldErrors = {};
  const titleMessage = checkTitle(values.title);
  if (titleMessage) fieldErrors.title = titleMessage;
  const dateMessage = checkEvaluationDate(values.evaluationDate, schoolYear);
  if (dateMessage) fieldErrors.evaluationDate = dateMessage;
  if (Object.keys(fieldErrors).length > 0) {
    throw invalidFieldsError(fieldErrors);
  }
  return values;
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
// la sesión), en el orden del repositorio, con los campos de toListedEvaluation y `scoreCount`:
// cuántas calificaciones vigentes tiene cada una, solo de las inscripciones que el profesor ve en
// Calificaciones (vigentes, activas o finalizadas), 0 si no tiene ninguna. Con esa cantidad, la
// vista advierte al eliminarla que sus calificaciones también se dan de baja. El id de la
// asignación llega del renderer, así que antes se comprueba que sea suya (getOwnTeacherAssignment).
// Lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la
// asignación no existe, fue dada de baja o es de otro profesor.
async function listOwnAssignmentEvaluations(currentUser, teacherAssignmentId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const evaluations = await evaluationRepository.findByTeacherAssignment(teacherAssignment.id);
  const scoreCounts = await scoreRepository.countVisibleByTeacherAssignment(teacherAssignment.id);
  return evaluations.map((evaluation) => ({
    ...toListedEvaluation(evaluation),
    scoreCount: scoreCounts.get(evaluation.id) ?? 0,
  }));
}

// La evaluación no está entre las vigentes de la asignación: no existe, fue dada de baja o es de
// otra asignación, sin distinguir los casos.
function evaluationNotFoundError() {
  return new EvaluationError('EVALUATION_NOT_FOUND', 'La evaluación no existe o no es de esta asignación.');
}

// La evaluación vigente con ese id, si es de una asignación docente vigente a cargo de
// `currentUser` (el profesor de la sesión): una de las de listOwnAssignmentEvaluations para esa
// asignación. Los dos ids llegan del renderer, así que antes se comprueba que la asignación sea
// suya (getOwnTeacherAssignment) y después, que la evaluación sea de esa asignación.
// Devuelve { teacherAssignment, evaluation }: la asignación, con los campos de
// getOwnTeacherAssignment, y la evaluación, con los de toListedEvaluation (sin scoreCount).
// Lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la
// asignación no existe, fue dada de baja o es de otro profesor, y un EvaluationError
// EVALUATION_NOT_FOUND si la evaluación no existe, fue dada de baja o es de otra asignación, sin
// distinguir los casos.
async function getOwnAssignmentEvaluation(currentUser, teacherAssignmentId, evaluationId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const evaluation = await evaluationRepository.findActiveByIdAndTeacherAssignment(evaluationId, teacherAssignment.id);
  if (!evaluation) throw evaluationNotFoundError();
  return { teacherAssignment, evaluation: toListedEvaluation(evaluation) };
}

// Lo de un ciclo lectivo cerrado es de solo lectura: en una asignación de un curso de un ciclo
// anterior al actual no se crean, no se editan ni se dan de baja evaluaciones. `schoolYear` es el
// ciclo lectivo de ese curso.
function closedSchoolYearError(schoolYear) {
  return new EvaluationError('SCHOOL_YEAR_CLOSED', schoolYearService.closedSchoolYearMessage(schoolYear));
}

// Lanza el EvaluationError SCHOOL_YEAR_CLOSED si el curso de `teacherAssignment` (la de
// getOwnTeacherAssignment) es de un ciclo lectivo cerrado. Se comprueba apenas se comprueba la
// asignación, antes de validar el formulario, para que gane a los demás errores; si el ciclo se
// cierra en el medio, la base rechaza la escritura y ese rechazo se traduce al mismo error.
async function assertSchoolYearNotClosed(teacherAssignment) {
  const { schoolYear } = teacherAssignment.course;
  if (await schoolYearService.isClosedSchoolYear(schoolYear)) {
    throw closedSchoolYearError(schoolYear);
  }
}

// Llama a `save` (el INSERT o el UPDATE) y devuelve su resultado. Si PostgreSQL lo rechaza por un
// motivo previsto, no se guarda nada y lanza un EvaluationError: DUPLICATE_VALUE, con el mensaje
// `duplicate.message` y `duplicate.title` en fieldErrors.title, si la asignación ya tiene otra
// evaluación vigente con ese título, SCHOOL_YEAR_CLOSED si `schoolYear`, el ciclo lectivo del curso
// de la asignación, se cerró después de comprobarlo, e INVALID_INPUT con fieldErrors.evaluationDate
// si la fecha no es de ese ciclo lectivo o si, en la edición, la evaluación tiene calificaciones
// vigentes y la fecha nueva es futura. Si la asignación se dio de baja después de comprobarla, lanza
// el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de ownTeacherAssignmentNotFoundError.
async function saveEvaluation(save, duplicate, schoolYear) {
  try {
    return await save();
  } catch (error) {
    if (evaluationRepository.isDuplicateError(error)) {
      throw new EvaluationError('DUPLICATE_VALUE', duplicate.message, { title: duplicate.title });
    }
    if (evaluationRepository.isClosedSchoolYearError(error)) {
      throw closedSchoolYearError(schoolYear);
    }
    // Otra sesión dio de baja la asignación después de comprobarla (trg_evaluacion_coherencia,
    // db/schema.sql): la vista recibe lo mismo que si ya estaba dada de baja.
    if (evaluationRepository.isDeletedAssignmentError(error)) {
      throw teacherAssignmentService.ownTeacherAssignmentNotFoundError();
    }
    // Otra sesión pasó la asignación a un curso de otro ciclo lectivo después de consultarla: la
    // fecha ya no es del suyo (trg_evaluacion_fecha_ciclo_lectivo, db/schema.sql).
    if (evaluationRepository.isDateOutOfSchoolYearError(error)) {
      throw invalidFieldsError({ evaluationDate: 'La fecha no es del ciclo lectivo de la asignación.' });
    }
    // Una evaluación calificada ya se tomó: no pasa a una fecha posterior a hoy, con la fecha de la
    // base (trg_evaluacion_futura_calificaciones_vigentes, db/schema.sql). Lo decide solo la base;
    // el alta nunca lo dispara, porque una evaluación nueva no tiene calificaciones.
    if (evaluationRepository.isFutureWithScoresError(error)) {
      throw invalidFieldsError({
        evaluationDate: 'La evaluación ya tiene calificaciones: no se puede pasar a una fecha futura.',
      });
    }
    throw error;
  }
}

// ---------- Alta ----------

// Crea una evaluación vigente en una asignación docente vigente a cargo de `currentUser` (el
// profesor de la sesión) y la devuelve con los campos de toListedEvaluation. `data` trae
// title y evaluationDate ('AAAA-MM-DD'). El id de la asignación llega del renderer, así que antes
// se comprueba que sea suya (getOwnTeacherAssignment): el ciclo lectivo contra el que se valida la
// fecha sale de esa asignación y nunca de lo que envía el renderer.
// Si algún dato no es válido no se guarda nada y se lanza un EvaluationError INVALID_INPUT con los
// fieldErrors de parseEvaluationData.
// El título no se repite entre las evaluaciones vigentes de la asignación: si ya hay una con ese
// título, no se guarda nada y se lanza un EvaluationError DUPLICATE_VALUE con fieldErrors.title. La
// regla la aplica el índice único de evaluacion al insertar, así que tampoco pasan dos altas
// simultáneas; una evaluación dada de baja no cuenta.
// También lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment
// si la asignación no existe, fue dada de baja o es de otro profesor, también si otra sesión la da
// de baja mientras tanto (la base no crea una evaluación en una asignación dada de baja), y un
// EvaluationError SCHOOL_YEAR_CLOSED si su curso es de un ciclo lectivo cerrado, que gana a los
// errores del formulario.
async function createOwnAssignmentEvaluation(currentUser, teacherAssignmentId, data) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  await assertSchoolYearNotClosed(teacherAssignment);
  const { schoolYear } = teacherAssignment.course;
  const values = parseEvaluationData(data, schoolYear);
  const evaluation = await saveEvaluation(
    () => evaluationRepository.create(teacherAssignment.id, values),
    {
      message: 'Ya existe una evaluación con ese título en esta asignación.',
      title: 'Ya existe una evaluación con este título.',
    },
    schoolYear
  );
  return toListedEvaluation(evaluation);
}

// ---------- Edición ----------

// Guarda el título y la fecha de una evaluación vigente de una asignación docente vigente a cargo
// de `currentUser` (el profesor de la sesión) y la devuelve como quedó, con los campos de
// toListedEvaluation. `data` trae los mismos campos que en createOwnAssignmentEvaluation
// y se valida igual: la evaluación conserva su asignación, así que el ciclo lectivo contra el que
// se valida la fecha es el de esa asignación. Los dos ids llegan del renderer, así que antes se
// comprueba que la asignación sea suya (getOwnTeacherAssignment) y el cambio solo alcanza a una
// evaluación de esa asignación.
// Si algún dato no es válido no se guarda nada y se lanza un EvaluationError INVALID_INPUT con los
// fieldErrors de parseEvaluationData; si la asignación ya tiene otra evaluación vigente con ese
// título, un EvaluationError DUPLICATE_VALUE con fieldErrors.title: guardarla sin cambios no es un
// duplicado y una dada de baja no cuenta. Una evaluación con calificaciones vigentes no pasa a una
// fecha futura: lo rechaza PostgreSQL, con su fecha, y se lanza un EvaluationError INVALID_INPUT
// con fieldErrors.evaluationDate (saveEvaluation).
// También lanza el TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment
// si la asignación no existe, fue dada de baja o es de otro profesor, también si otra sesión la da
// de baja mientras tanto (la base no edita una evaluación de una asignación dada de baja), un
// EvaluationError SCHOOL_YEAR_CLOSED si su curso es de un ciclo lectivo cerrado, que gana a los
// errores siguientes, y un EvaluationError EVALUATION_NOT_FOUND si la evaluación no existe, fue
// dada de baja o es de otra asignación, sin distinguir los casos: una dada de baja ya no se edita.
async function updateOwnAssignmentEvaluation(currentUser, teacherAssignmentId, evaluationId, data) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  await assertSchoolYearNotClosed(teacherAssignment);
  const { schoolYear } = teacherAssignment.course;
  const values = parseEvaluationData(data, schoolYear);
  const evaluation = await saveEvaluation(
    () => evaluationRepository.update(evaluationId, teacherAssignment.id, values),
    {
      message: 'Ya existe otra evaluación con ese título en esta asignación.',
      title: 'Ya existe otra evaluación con este título.',
    },
    schoolYear
  );
  if (!evaluation) throw evaluationNotFoundError();
  return toListedEvaluation(evaluation);
}

// ---------- Baja ----------

// Baja lógica de una evaluación vigente de una asignación docente vigente a cargo de `currentUser`
// (el profesor de la sesión): la fila queda con su fecha de baja, deja de listarse
// (listOwnAssignmentEvaluations) y su título se puede volver a usar en la asignación. En la misma
// operación se dan de baja todas sus calificaciones vigentes, también las de inscripciones
// canceladas, que el profesor no ve: lo hace la base (trg_evaluacion_baja_calificaciones,
// db/schema.sql). Los dos ids llegan del renderer, así que antes se comprueba que la asignación sea
// suya (getOwnTeacherAssignment) y la baja solo alcanza a una evaluación de esa asignación.
// Devuelve la evaluación dada de baja, con los campos de toListedEvaluation. Lanza el
// TeacherAssignmentError TEACHER_ASSIGNMENT_NOT_FOUND de getOwnTeacherAssignment si la asignación
// no existe, fue dada de baja o es de otro profesor, un EvaluationError SCHOOL_YEAR_CLOSED si su
// curso es de un ciclo lectivo cerrado, que gana a los errores siguientes, un EvaluationError
// EVALUATION_HAS_COMPLETED_SCORES si la evaluación tiene calificaciones vigentes de inscripciones
// finalizadas y un EvaluationError EVALUATION_NOT_FOUND si la evaluación no existe, ya estaba dada
// de baja o es de otra asignación, sin distinguir los casos.
async function deleteOwnAssignmentEvaluation(currentUser, teacherAssignmentId, evaluationId) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  await assertSchoolYearNotClosed(teacherAssignment);
  let deletedEvaluation;
  try {
    deletedEvaluation = await evaluationRepository.markAsDeleted(evaluationId, teacherAssignment.id);
  } catch (error) {
    if (evaluationRepository.isClosedSchoolYearError(error)) {
      throw closedSchoolYearError(teacherAssignment.course.schoolYear);
    }
    // Las calificaciones de inscripciones finalizadas son histórico y tienen que seguir visibles en
    // la evaluación: la base rechaza la baja en cascada (trg_calificacion_coherencia,
    // db/schema.sql) y no cambia nada. Sin control previo: decide la base, que ya retiene las
    // inscripciones.
    if (evaluationRepository.isCompletedScoresError(error)) {
      throw new EvaluationError(
        'EVALUATION_HAS_COMPLETED_SCORES',
        'La evaluación tiene calificaciones de inscripciones finalizadas: no se puede eliminar.'
      );
    }
    throw error;
  }
  if (!deletedEvaluation) throw evaluationNotFoundError();
  return toListedEvaluation(deletedEvaluation);
}

module.exports = {
  listOwnAssignmentEvaluations,
  getOwnAssignmentEvaluation,
  createOwnAssignmentEvaluation,
  updateOwnAssignmentEvaluation,
  deleteOwnAssignmentEvaluation,
  evaluationNotFoundError,
  EvaluationError,
};
