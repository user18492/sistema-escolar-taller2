const evaluationRepository = require('../repositories/evaluation.repository');
const teacherAssignmentService = require('./teacher-assignment.service');
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

// ---------- Alta ----------

// Crea una evaluación vigente en una asignación docente vigente a cargo de `currentUser` (el
// profesor de la sesión) y la devuelve con los campos de listOwnAssignmentEvaluations. `data` trae
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
// si la asignación no existe, fue dada de baja o es de otro profesor.
async function createOwnAssignmentEvaluation(currentUser, teacherAssignmentId, data) {
  const teacherAssignment = await teacherAssignmentService.getOwnTeacherAssignment(currentUser, teacherAssignmentId);
  const values = parseEvaluationData(data, teacherAssignment.course.schoolYear);

  let evaluation;
  try {
    evaluation = await evaluationRepository.create(teacherAssignment.id, values);
  } catch (error) {
    if (evaluationRepository.isDuplicateError(error)) {
      throw new EvaluationError('DUPLICATE_VALUE', 'Ya existe una evaluación con ese título en esta asignación.', {
        title: 'Ya existe una evaluación con este título.',
      });
    }
    // Otra sesión pasó la asignación a un curso de otro ciclo lectivo después de consultarla: la
    // fecha ya no es del suyo (trg_evaluacion_fecha_ciclo_lectivo, db/schema.sql).
    if (evaluationRepository.isDateOutOfSchoolYearError(error)) {
      throw invalidFieldsError({ evaluationDate: 'La fecha no es del ciclo lectivo de la asignación.' });
    }
    throw error;
  }
  return toListedEvaluation(evaluation);
}

module.exports = {
  listOwnAssignmentEvaluations,
  getOwnAssignmentEvaluation,
  createOwnAssignmentEvaluation,
  EvaluationError,
};
