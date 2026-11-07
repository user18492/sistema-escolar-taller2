const schoolYearRepository = require('../repositories/school-year.repository');
const enrollmentRepository = require('../repositories/enrollment.repository');

// El ciclo lectivo es el año calendario, de enero a diciembre, y es el mismo para todas las
// instituciones. El actual lo define la base (school-year.repository.js), nunca el reloj del
// proceso: los anteriores están cerrados y lo suyo queda en solo lectura.

// El ciclo lectivo actual: { year, today }, con year el año del ciclo lectivo y today la fecha del
// día ('AAAA-MM-DD'), los dos de la base.
async function getCurrentSchoolYear() {
  return schoolYearRepository.findCurrent();
}

// true si `schoolYear` (el año de un ciclo lectivo, p. ej., el de un curso) es un ciclo cerrado: uno
// anterior al actual. Es la misma regla que fn_ciclo_lectivo_estado (db/schema.sql), con la que la
// base rechaza después cualquier escritura en ese ciclo.
async function isClosedSchoolYear(schoolYear) {
  const { year } = await getCurrentSchoolYear();
  return schoolYear < year;
}

// Mensaje del error SCHOOL_YEAR_CLOSED, el mismo en todas las operaciones que lo lanzan.
function closedSchoolYearMessage(schoolYear) {
  return `El ciclo lectivo ${schoolYear} está cerrado: sus datos son de solo lectura.`;
}

// Un trimestre del ciclo lectivo (1 hasta el 31/05, 2 hasta el 31/08 y 3 hasta el 31/12) se cierra
// 7 días después de su último día, o con su ciclo lectivo: desde entonces, sus evaluaciones y sus
// calificaciones son de solo lectura. Los cortes y el plazo los define la base (fn_trimestre y
// fn_trimestre_cerrado, db/schema.sql), nunca el proceso.

// true si el trimestre de la fecha `isoDate` ('AAAA-MM-DD', una fecha válida), p. ej., la de una
// evaluación, está cerrado, con la fecha de la base. Es la misma regla con la que la base rechaza
// después cualquier escritura en ese trimestre.
async function isTermClosed(isoDate) {
  return schoolYearRepository.isTermClosed(isoDate);
}

// Mensaje del error TERM_CLOSED, el mismo en todas las operaciones que lo lanzan.
function closedTermMessage() {
  return 'El trimestre de esta evaluación está cerrado: sus datos son de solo lectura.';
}

// Cierre de los ciclos lectivos anteriores al actual: sus inscripciones vigentes y activas pasan a
// finalizadas, sin cambiar nada más (las canceladas, las finalizadas y las dadas de baja quedan como
// están). Lo llama main.js al iniciar la aplicación; es idempotente: una segunda llamada ya no
// encuentra activas en los ciclos cerrados. Devuelve cuántas inscripciones finalizó.
async function closePastSchoolYears() {
  return enrollmentRepository.finalizeActiveInClosedSchoolYears();
}

module.exports = {
  getCurrentSchoolYear,
  isClosedSchoolYear,
  closedSchoolYearMessage,
  isTermClosed,
  closedTermMessage,
  closePastSchoolYears,
};
