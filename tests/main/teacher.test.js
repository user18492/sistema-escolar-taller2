// Capa main: casos de uso del Profesor por la API del preload (asignaciones propias, alumnos del
// curso, evaluaciones y calificaciones). Opera con un profesor propio sobre un curso propio del ciclo
// actual y, para la inscripción finalizada, que solo existe en un ciclo cerrado
// (plans/secretario-inscripciones/00-estado-y-fecha.md), sobre otro curso propio del ciclo anterior;
// cada resultado se comprueba con una consulta independiente.
// Lo de un trimestre cerrado (plans/promedios/02-restricciones-backend-y-vistas.md) se prueba con el
// reloj de la base fijado, también para la aplicación (fixtures.onDate): los datos se crean el 01/01
// del ciclo actual, con el 1.er trimestre abierto, y se prueban el 09/06, con ese trimestre ya
// cerrado (cierra el 08/06) y el 2.º abierto. Así no dependen del día en que corre la suite.
// Los promedios de Alumnos (plans/promedios/03-promedios-profesor.md) se comparan con una consulta
// propia sobre las tablas: los de dos trimestres, en un curso propio del ciclo anterior cargado con
// el reloj en cada fecha, y los del ciclo actual, con datos del 01/01 vistos ese día y el 09/06.
const { group, test } = require('../lib/framework');
const { sortedIds, sortedNumbers } = require('../lib/domain');
const { replaceTodaySql } = require('../lib/clock');

// Fechas del ciclo actual para lo del trimestre cerrado: el día en que se crean los datos, el día en
// que se prueban y el último del 1.er trimestre
const termDates = (t) => ({
  createdOn: `${t.year}-01-01`,
  closedTermToday: `${t.year}-06-09`,
  firstTermLastDay: `${t.year}-05-31`,
});

// Una evaluación del 01/01 en la asignación del setup, con una inscripción calificada y otra sin
// nota, del mismo día, creadas con el reloj en ese día: { evaluationId, scoredId, unscoredId }
async function firstTermEvaluation(t) {
  const { course, assignment } = t.data;
  return t.fixtures.onDate(termDates(t).createdOn, async () => {
    const enrollStudent = async () => t.fixtures.enroll({
      studentId: (await t.fixtures.createStudent({ institutionId: course.institutionId })).id,
      courseId: course.id,
    });
    const scoredId = await enrollStudent();
    const unscoredId = await enrollStudent();
    const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id });
    await t.fixtures.score({ evaluationId, enrollmentId: scoredId, value: 6 });
    return { evaluationId, scoredId, unscoredId };
  });
}

// El día anterior a hoy, según la base
async function yesterdayOf(t) {
  return (await t.sqlOne(`SELECT to_char(fn_fecha_actual() - 1, 'YYYY-MM-DD') AS day`)).day;
}

// Promedios esperados de las inscripciones que lista Alumnos en la asignación `assignmentId`, con
// una consulta propia sobre las tablas (sin vw_promedio_trimestral ni fn_trimestre_cerrado): por
// inscripción vigente, activa o finalizada, del curso, los tres trimestres y el anual como los
// entrega scores.listAveragesByOwnAssignment. Un Map inscripcion_id → { terms, annual }.
async function expectedAverages(t, assignmentId) {
  const rows = await t.sql(`
    WITH inscripciones AS (
      SELECT i.inscripcion_id, i.fecha_inscripcion, ie.nombre AS estado, c.anio_ciclo_lectivo AS anio
        FROM asignacion_docente a
        JOIN curso c ON c.curso_id = a.curso_id
        JOIN inscripcion i ON i.curso_id = a.curso_id
        JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
       WHERE a.asignacion_docente_id = $1 AND i.fecha_eliminacion IS NULL AND ie.nombre IN ('ACTIVA', 'FINALIZADA')
    ), notas AS (
      SELECT s.inscripcion_id,
             CASE WHEN EXTRACT(MONTH FROM e.fecha_evaluacion) <= 5 THEN 1
                  WHEN EXTRACT(MONTH FROM e.fecha_evaluacion) <= 8 THEN 2 ELSE 3 END AS trimestre,
             COALESCE((SELECT ca.nota FROM calificacion ca
                        WHERE ca.evaluacion_id = e.evaluacion_id AND ca.inscripcion_id = s.inscripcion_id
                          AND ca.fecha_eliminacion IS NULL), 0) AS nota
        FROM inscripciones s
        JOIN evaluacion e ON e.asignacion_docente_id = $1
       WHERE e.fecha_eliminacion IS NULL AND e.fecha_evaluacion BETWEEN s.fecha_inscripcion AND fn_fecha_actual()
    ), trimestrales AS (
      SELECT inscripcion_id, trimestre, AVG(nota) AS promedio FROM notas GROUP BY inscripcion_id, trimestre
    )
    SELECT s.inscripcion_id AS id, g.trimestre,
           ROUND(tr.promedio, 2)::TEXT AS valor,
           (s.anio < EXTRACT(YEAR FROM fn_fecha_actual())
            OR fn_fecha_actual() > make_date(s.anio, CASE g.trimestre WHEN 1 THEN 5 WHEN 2 THEN 8 ELSE 12 END, 31) + 7) AS cerrado,
           ROUND((SELECT AVG(x.promedio) FROM trimestrales x WHERE x.inscripcion_id = s.inscripcion_id), 2)::TEXT AS anual,
           (s.anio < EXTRACT(YEAR FROM fn_fecha_actual()) OR s.estado = 'FINALIZADA') AS anual_final
      FROM inscripciones s
      CROSS JOIN generate_series(1, 3) AS g(trimestre)
      LEFT JOIN trimestrales tr ON tr.inscripcion_id = s.inscripcion_id AND tr.trimestre = g.trimestre
     ORDER BY s.inscripcion_id, g.trimestre`, [assignmentId]);
  const toValue = (text) => (text === null ? null : Number(text));
  const expected = new Map();
  for (const row of rows) {
    if (!expected.has(row.id)) {
      const annual = toValue(row.anual);
      expected.set(row.id, { terms: [], annual: { value: annual, isFinal: annual !== null && row.anual_final } });
    }
    const value = toValue(row.valor);
    expected.get(row.id).terms.push({ term: row.trimestre, value, isFinal: value !== null && row.cerrado });
  }
  return expected;
}

// Pide los promedios de la asignación y comprueba que sean una fila por inscripción de Alumnos, en su
// orden, con los valores y las marcas de expectedAverages. Devuelve un Map inscripcion_id → promedios
async function checkAverages(t, assignmentId, label) {
  const { enrollments } = await t.ok('enrollments.listByOwnAssignment', assignmentId);
  const { averages } = await t.ok('scores.listAveragesByOwnAssignment', assignmentId);
  t.equal(averages.map((row) => row.enrollmentId), enrollments.map((enrollment) => enrollment.id),
    `${label}: una fila por inscripción de Alumnos, en su mismo orden`);
  const expected = await expectedAverages(t, assignmentId);
  t.equal(averages, enrollments.map(({ id }) => ({ enrollmentId: id, ...expected.get(id) })),
    `${label}: valores y marcas como los de la consulta propia`);
  return new Map(averages.map((row) => [row.enrollmentId, row]));
}

group('main.teacher', 'Profesor: asignaciones, alumnos, evaluaciones y calificaciones', {
  async setup({ fixtures }) {
    const scenario = await fixtures.teacherScenario();
    const { teacher, course, assignment } = scenario;
    // Otra asignación del mismo profesor, una de otro profesor y una dada de baja
    const secondCourse = await fixtures.createCourse({ grade: '5°' });
    const second = await fixtures.assign({ teacherId: teacher.id, courseId: secondCourse.id });
    const otherTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const foreign = await fixtures.assign({ teacherId: otherTeacher.id, courseId: course.id });
    const foreignEvaluation = await fixtures.createEvaluation({ assignmentId: foreign.id });
    const removed = await fixtures.assign({ teacherId: teacher.id, courseId: secondCourse.id });
    await fixtures.db.query(`UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, [removed.id]);
    // Inscripciones del curso cancelada y dada de baja
    const cancelledStudent = await fixtures.createStudent();
    const cancelled = await fixtures.enroll({ studentId: cancelledStudent.id, courseId: course.id });
    await fixtures.setEnrollmentStatus(cancelled, 'CANCELADA');
    const deletedStudent = await fixtures.createStudent();
    await fixtures.enroll({ studentId: deletedStudent.id, courseId: course.id, deleted: true });
    // Una finalizada solo existe en un ciclo cerrado: un curso del ciclo anterior con una asignación
    // del mismo profesor y un alumno con una nota de cuando estaba activo; ya cerrado el ciclo, su
    // inscripción pasa a finalizada como en el cierre
    const closed = await fixtures.inSchoolYear(fixtures.year - 1, async () => {
      const closedCourse = await fixtures.createCourse();
      const closedAssignment = await fixtures.assign({ teacherId: teacher.id, courseId: closedCourse.id });
      const student = await fixtures.createStudent();
      const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: closedCourse.id });
      const evaluationId = await fixtures.createEvaluation({ assignmentId: closedAssignment.id });
      await fixtures.score({ evaluationId, enrollmentId, value: 6.5 });
      return { course: closedCourse, assignment: closedAssignment, enrollmentId, evaluationId };
    });
    await fixtures.setEnrollmentStatus(closed.enrollmentId, 'FINALIZADA');
    return { ...scenario, second, foreign, foreignEvaluation, removed, closed, cancelled, assignment };
  },
}, () => {
  test('assignments', 'El profesor ve sus asignaciones vigentes y ninguna de otro profesor', async (t) => {
    await t.login(t.data.teacher);
    const { teacherAssignments } = await t.ok('teacherAssignments.listOwn');
    const expected = await t.sql(`SELECT asignacion_docente_id AS id FROM asignacion_docente WHERE usuario_id = $1 AND fecha_eliminacion IS NULL`, [t.data.teacher.id]);
    t.equal(sortedIds(teacherAssignments), sortedNumbers(expected), 'Asignaciones propias vigentes');
    const own = await t.ok('teacherAssignments.getOwn', t.data.assignment.id);
    t.equal(own.teacherAssignment?.course?.id, t.data.course.id, 'getOwn trae el curso de la asignación');
    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'teacherAssignments.getOwn', t.data.foreign.id);
    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'teacherAssignments.getOwn', t.data.removed.id);
    await t.logout();
  });

  test('students', 'Los alumnos de la asignación son las inscripciones vigentes, activas y finalizadas, de su curso', {
    history: [{ plan: 'plans/secretario-inscripciones/00-estado-y-fecha.md', date: '2026-10-28', change: 'La finalizada ya no está en el curso del ciclo actual: además, enrollments.listByOwnAssignment de la asignación del ciclo cerrado (closed) lista su finalizada, comparada con una consulta propia de ese curso' }],
  }, async (t) => {
    await t.login(t.data.teacher);
    const expectedOf = (courseId) => t.sql(`
      SELECT i.inscripcion_id AS id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
       WHERE i.curso_id = $1 AND i.fecha_eliminacion IS NULL AND e.nombre IN ('ACTIVA', 'FINALIZADA')`, [courseId]);
    const { enrollments } = await t.ok('enrollments.listByOwnAssignment', t.data.assignment.id);
    t.equal(sortedIds(enrollments), sortedNumbers(await expectedOf(t.data.course.id)), 'Inscripciones listadas');
    const { closed } = t.data;
    const { enrollments: closedEnrollments } = await t.ok('enrollments.listByOwnAssignment', closed.assignment.id);
    const expectedClosed = await expectedOf(closed.course.id);
    t.check(sortedNumbers(expectedClosed).includes(closed.enrollmentId), 'La finalizada del setup tiene que estar en su curso', expectedClosed);
    t.equal(sortedIds(closedEnrollments), sortedNumbers(expectedClosed), 'Inscripciones listadas del ciclo cerrado, con la finalizada');
    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'enrollments.listByOwnAssignment', t.data.foreign.id);
    await t.logout();
  });

  test('evaluations', 'Alta, edición y baja lógica de evaluaciones, con título único y fecha del ciclo', async (t) => {
    await t.login(t.data.teacher);
    const assignmentId = t.data.assignment.id;
    const listed = await t.ok('evaluations.listByOwnAssignment', assignmentId);
    const expected = await t.sql(`SELECT evaluacion_id AS id FROM evaluacion WHERE asignacion_docente_id = $1 AND fecha_eliminacion IS NULL`, [assignmentId]);
    t.equal(sortedIds(listed.evaluations), sortedNumbers(expected), 'Evaluaciones vigentes de la asignación');

    const { evaluation } = await t.ok('evaluations.create', assignmentId, { title: 'Parcial de la suite', evaluationDate: t.today });
    const row = () => t.sqlOne(`SELECT titulo, to_char(fecha_evaluacion, 'YYYY-MM-DD') AS fecha, fecha_eliminacion IS NOT NULL AS baja FROM evaluacion WHERE evaluacion_id = $1`, [evaluation?.id]);
    t.equal(await row(), { titulo: 'Parcial de la suite', fecha: t.today, baja: false }, 'La evaluación quedó en la base');
    const duplicate = await t.rejects('DUPLICATE_VALUE', 'evaluations.create', assignmentId, { title: 'Parcial de la suite', evaluationDate: t.today });
    t.check(duplicate?.error?.fieldErrors?.title, 'El duplicado marca el título', duplicate);
    const outOfCycle = await t.rejects('INVALID_INPUT', 'evaluations.create', assignmentId, { title: 'Otro año', evaluationDate: `${t.year - 1}-06-10` });
    t.check(outOfCycle?.error?.fieldErrors?.evaluationDate, 'La fecha de otro ciclo marca el campo', outOfCycle);

    await t.ok('evaluations.update', assignmentId, evaluation.id, { title: 'Parcial renombrado', evaluationDate: t.today });
    t.equal((await row()).titulo, 'Parcial renombrado', 'La edición se guardó');
    await t.ok('evaluations.delete', assignmentId, evaluation.id);
    t.equal((await row()).baja, true, 'Quedó dada de baja');
    await t.rejects('EVALUATION_NOT_FOUND', 'evaluations.delete', assignmentId, evaluation.id);
    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'evaluations.create', t.data.foreign.id, { title: 'Ajena', evaluationDate: t.today });
    await t.logout();
  });

  test('scores', 'Carga, corrección y baja de una nota; la finalizada es de solo lectura', {
    history: [{ plan: 'plans/secretario-inscripciones/00-estado-y-fecha.md', date: '2026-10-28', change: 'La finalizada solo existe en un ciclo cerrado: su fila ([6.5, false]) se comprueba en scores.listByOwnEvaluation de la evaluación del ciclo cerrado (closed), y ENROLLMENT_NOT_ACTIVE se comprueba con la cancelada' }],
  }, async (t) => {
    await t.login(t.data.teacher);
    const { assignment, evaluationId, enrollmentId, cancelled, closed } = t.data;
    const listed = await t.ok('scores.listByOwnEvaluation', assignment.id, evaluationId);
    const expected = await t.sql(`
      SELECT i.inscripcion_id AS id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
       WHERE i.curso_id = $1 AND i.fecha_eliminacion IS NULL AND e.nombre IN ('ACTIVA', 'FINALIZADA')`, [t.data.course.id]);
    t.equal(listed.scores.map((score) => score.enrollmentId).sort((a, b) => a - b), sortedNumbers(expected), 'Una fila por inscripción activa o finalizada');
    const closedListed = await t.ok('scores.listByOwnEvaluation', closed.assignment.id, closed.evaluationId);
    const finishedRow = closedListed.scores.find((score) => score.enrollmentId === closed.enrollmentId);
    t.equal([finishedRow?.value, finishedRow?.isEnrollmentActive], [6.5, false], 'La finalizada trae su nota, de solo lectura');

    const scoresOf = () => t.sql(`SELECT nota::TEXT AS nota, fecha_eliminacion IS NOT NULL AS baja FROM calificacion WHERE evaluacion_id = $1 AND inscripcion_id = $2 ORDER BY calificacion_id`, [evaluationId, enrollmentId]);
    await t.ok('scores.save', assignment.id, evaluationId, { enrollmentId, value: 8.25 });
    t.equal(await scoresOf(), [{ nota: '8.25', baja: false }], 'La nota quedó guardada');
    await t.ok('scores.save', assignment.id, evaluationId, { enrollmentId, value: 9 });
    t.equal(await scoresOf(), [{ nota: '9.00', baja: false }], 'Corregir modifica la misma fila');
    await t.ok('scores.delete', assignment.id, evaluationId, enrollmentId);
    t.equal(await scoresOf(), [{ nota: '9.00', baja: true }], 'La baja conserva la fila con su última nota');
    await t.rejects('SCORE_NOT_FOUND', 'scores.delete', assignment.id, evaluationId, enrollmentId);
    await t.ok('scores.save', assignment.id, evaluationId, { enrollmentId, value: 7 });
    t.equal((await scoresOf()).filter((score) => !score.baja), [{ nota: '7.00', baja: false }], 'Después de la baja se carga una nota nueva');

    await t.rejects('INVALID_SCORE', 'scores.save', assignment.id, evaluationId, { enrollmentId, value: 10.5 });
    await t.rejects('ENROLLMENT_NOT_ACTIVE', 'scores.save', assignment.id, evaluationId, { enrollmentId: cancelled, value: 9 });
    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'scores.listByOwnEvaluation', t.data.foreign.id, t.data.foreignEvaluation);
    await t.rejects('EVALUATION_NOT_FOUND', 'scores.listByOwnEvaluation', assignment.id, t.data.foreignEvaluation);
    await t.logout();
  });

  test('scores-save-many', 'Guardar calificaciones guarda de una vez cargas, correcciones y bajas; si rechaza un cambio, no guarda ninguno', async (t) => {
    await t.login(t.data.teacher);
    const { assignment, course, enrollmentId, cancelled, closed } = t.data;
    const enrollStudent = async () => t.fixtures.enroll({
      studentId: (await t.fixtures.createStudent({ institutionId: course.institutionId })).id,
      courseId: course.id,
    });
    const corrected = await enrollStudent();
    const removed = await enrollStudent();
    const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id });
    await t.fixtures.score({ evaluationId, enrollmentId: corrected, value: 5 });
    await t.fixtures.score({ evaluationId, enrollmentId: removed, value: 6 });
    // Notas vigentes de la evaluación, por inscripción
    const current = async () => Object.fromEntries((await t.sql(`
      SELECT inscripcion_id AS id, nota::TEXT AS nota FROM calificacion
       WHERE evaluacion_id = $1 AND fecha_eliminacion IS NULL`, [evaluationId])).map((row) => [row.id, row.nota]));
    const before = await current();
    t.equal(before, { [corrected]: '5.00', [removed]: '6.00' }, 'La evaluación empieza con las dos notas del setup');
    const changes = [
      { enrollmentId, value: 8 },
      { enrollmentId: corrected, value: 9.5 },
      { enrollmentId: removed, value: null },
    ];

    const notActive = await t.rejects('ENROLLMENT_NOT_ACTIVE', 'scores.saveMany', assignment.id, evaluationId, [...changes, { enrollmentId: cancelled, value: 7 }]);
    t.equal(notActive?.error?.enrollmentId, cancelled, 'El rechazo identifica la inscripción del cambio rechazado');
    t.equal(await current(), before, 'Con un cambio rechazado por la base no se guardó ninguno');
    const invalid = await t.rejects('INVALID_SCORE', 'scores.saveMany', assignment.id, evaluationId, [{ enrollmentId, value: 8 }, { enrollmentId: corrected, value: 10.5 }]);
    t.equal(invalid?.error?.enrollmentId, corrected, 'La nota inválida identifica su inscripción');
    t.equal(await current(), before, 'Con una nota inválida no se guardó ninguna');

    const saved = await t.ok('scores.saveMany', assignment.id, evaluationId, changes);
    const byEnrollment = (list) => [...(list ?? [])].sort((a, b) => a.enrollmentId - b.enrollmentId);
    t.equal(byEnrollment(saved?.scores), byEnrollment(changes), 'Responde cada nota como quedó guardada');
    t.equal(await current(), { [enrollmentId]: '8.00', [corrected]: '9.50' }, 'Se cargó una, se corrigió otra y se dio de baja la tercera');
    const rowsOf = (id) => t.sql(`SELECT nota::TEXT AS nota, fecha_eliminacion IS NOT NULL AS baja FROM calificacion WHERE evaluacion_id = $1 AND inscripcion_id = $2 ORDER BY calificacion_id`, [evaluationId, id]);
    t.equal(await rowsOf(corrected), [{ nota: '9.50', baja: false }], 'Corregir modifica la misma fila');
    t.equal(await rowsOf(removed), [{ nota: '6.00', baja: true }], 'La baja conserva la fila con su última nota');

    await t.ok('scores.saveMany', assignment.id, evaluationId, [{ enrollmentId: removed, value: null }]);
    t.equal(await rowsOf(removed), [{ nota: '6.00', baja: true }], 'La baja de una calificación que ya no está vigente no es un error ni cambia nada');

    await t.rejects('SCHOOL_YEAR_CLOSED', 'scores.saveMany', closed.assignment.id, closed.evaluationId, [{ enrollmentId: closed.enrollmentId, value: null }]);
    for (const malformed of [[], {}, [{ enrollmentId }], [{ enrollmentId, value: '8' }], [{ enrollmentId, value: 8 }, { enrollmentId, value: null }]]) {
      await t.rejects('INVALID_INPUT', 'scores.saveMany', assignment.id, evaluationId, malformed);
    }
    t.equal(await current(), { [enrollmentId]: '8.00', [corrected]: '9.50' }, 'Los rechazos no cambiaron nada');
    await t.logout();
  });

  test('evaluation-delete-keeps-scores', 'La baja de una evaluación da de baja sus calificaciones vigentes y conserva sus filas', {
    history: [{ plan: 'plans/profesor-evaluaciones/00-base-de-datos-y-backend.md', date: '2026-10-26', change: 'Después de evaluations.delete la calificación ya no sigue vigente: la evaluación queda sin calificaciones vigentes y la fila de la nota se conserva, con su nota y su fecha de baja' }],
  }, async (t) => {
    await t.login(t.data.teacher);
    const { assignment, enrollmentId } = t.data;
    const { evaluation } = await t.ok('evaluations.create', assignment.id, { title: 'Con notas', evaluationDate: t.today });
    await t.ok('scores.save', assignment.id, evaluation.id, { enrollmentId, value: 5 });
    await t.ok('evaluations.delete', assignment.id, evaluation.id);
    const scores = await t.sql(`SELECT nota::TEXT AS nota, fecha_eliminacion IS NOT NULL AS baja FROM calificacion WHERE evaluacion_id = $1`, [evaluation.id]);
    t.equal(scores, [{ nota: '5.00', baja: true }], 'La evaluación quedó sin calificaciones vigentes y la nota se conserva dada de baja');
    await t.logout();
  });

  test('evaluation-delete-completed-scores', 'Una evaluación con calificaciones de inscripciones finalizadas no se da de baja', {
    retired: {
      plan: 'plans/secretario-inscripciones/00-estado-y-fecha.md',
      reason: 'Una inscripción finalizada solo existe en un ciclo lectivo cerrado, donde la baja de la evaluación responde antes SCHOOL_YEAR_CLOSED: EVALUATION_HAS_COMPLETED_SCORES ya no se alcanza por la API. La regla de la base la sigue cubriendo db.scores.evaluation-delete-completed-scores.',
    },
  }, async (t) => {
    await t.login(t.data.teacher);
    const { assignment, evaluationId, finished } = t.data;
    const state = () => t.sqlOne(`
      SELECT e.fecha_eliminacion IS NULL AS vigente,
             (SELECT COUNT(*)::INT FROM calificacion c WHERE c.evaluacion_id = e.evaluacion_id AND c.fecha_eliminacion IS NULL) AS vigentes,
             EXISTS (SELECT 1 FROM calificacion c WHERE c.evaluacion_id = e.evaluacion_id AND c.inscripcion_id = $2
                        AND c.fecha_eliminacion IS NULL) AS con_la_finalizada
        FROM evaluacion e WHERE e.evaluacion_id = $1`, [evaluationId, finished]);
    const before = await state();
    t.require(before?.vigente && before.con_la_finalizada, 'La evaluación del setup tiene que estar vigente y con la nota de la finalizada', before);
    await t.rejects('EVALUATION_HAS_COMPLETED_SCORES', 'evaluations.delete', assignment.id, evaluationId);
    t.equal(await state(), before, 'La evaluación y sus calificaciones siguen vigentes');
    await t.logout();
  });

  test('score-on-future-evaluation', 'Una evaluación con fecha futura no se califica, y una calificada no pasa a una fecha futura', {
    history: [{ plan: 'plans/profesor-calificaciones.md', date: '2026-10-26', change: 'Calificar una evaluación con fecha futura ya no se acepta: ahora espera EVALUATION_IN_FUTURE sin dejar filas; además, pasar a una fecha futura una evaluación calificada espera INVALID_INPUT con fieldErrors.evaluationDate, y después de dar de baja la nota se guarda' }],
  }, async (t) => {
    const lastDay = `${t.year}-12-31`;
    if (t.today >= lastDay) return t.warn('Hoy es el último día del ciclo: no hay fecha futura que probar');
    await t.login(t.data.teacher);
    const { assignment, enrollmentId } = t.data;
    const { evaluation: future } = await t.ok('evaluations.create', assignment.id, { title: 'Futura', evaluationDate: lastDay });
    await t.rejects('EVALUATION_IN_FUTURE', 'scores.save', assignment.id, future.id, { enrollmentId, value: 6 });
    const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM calificacion WHERE evaluacion_id = $1`, [future.id]);
    t.equal(count, 0, 'La evaluación con fecha futura quedó sin calificaciones');

    const { evaluation: scored } = await t.ok('evaluations.create', assignment.id, { title: 'Calificada hoy', evaluationDate: t.today });
    await t.ok('scores.save', assignment.id, scored.id, { enrollmentId, value: 7 });
    const dateOf = async () => (await t.sqlOne(`SELECT to_char(fecha_evaluacion, 'YYYY-MM-DD') AS fecha FROM evaluacion WHERE evaluacion_id = $1`, [scored.id])).fecha;
    const moved = await t.rejects('INVALID_INPUT', 'evaluations.update', assignment.id, scored.id, { title: 'Calificada hoy', evaluationDate: lastDay });
    t.check(moved?.error?.fieldErrors?.evaluationDate, 'El rechazo marca la fecha', moved);
    t.equal(await dateOf(), t.today, 'La fecha no cambió');
    await t.ok('scores.delete', assignment.id, scored.id, enrollmentId);
    await t.ok('evaluations.update', assignment.id, scored.id, { title: 'Calificada hoy', evaluationDate: lastDay });
    t.equal(await dateOf(), lastDay, 'Sin calificaciones vigentes, la evaluación pasó a la fecha futura');
    await t.logout();
  });

  test('evaluation-score-count', 'El listado de evaluaciones trae cuántas calificaciones vigentes ve el profesor en cada una', {
    history: [{ plan: 'plans/secretario-inscripciones/00-estado-y-fecha.md', date: '2026-10-28', change: 'La nota de la finalizada pasa a la evaluación del ciclo cerrado: evaluations.listByOwnAssignment de su asignación (closed) da 1 en closed.evaluationId, en lugar de sumarla a la evaluación del setup del ciclo actual' }],
  }, async (t) => {
    await t.login(t.data.teacher);
    const { assignment, enrollmentId, closed } = t.data;
    const { evaluation } = await t.ok('evaluations.create', assignment.id, { title: 'Con nota para contar', evaluationDate: t.today });
    await t.ok('scores.save', assignment.id, evaluation.id, { enrollmentId, value: 8 });

    const { evaluations } = await t.ok('evaluations.listByOwnAssignment', assignment.id);
    // Por evaluación vigente, sus calificaciones vigentes de inscripciones vigentes, activas o finalizadas
    const expected = await t.sql(`
      SELECT e.evaluacion_id AS id,
             (SELECT COUNT(*)::INT FROM calificacion c
                JOIN inscripcion i ON i.inscripcion_id = c.inscripcion_id
                JOIN inscripcion_estado ie USING (inscripcion_estado_id)
               WHERE c.evaluacion_id = e.evaluacion_id AND c.fecha_eliminacion IS NULL
                 AND i.fecha_eliminacion IS NULL AND ie.nombre IN ('ACTIVA', 'FINALIZADA')) AS score_count
        FROM evaluacion e
       WHERE e.asignacion_docente_id = $1 AND e.fecha_eliminacion IS NULL
       ORDER BY e.evaluacion_id`, [assignment.id]);
    const listed = evaluations.map(({ id, scoreCount }) => ({ id, scoreCount })).sort((a, b) => a.id - b.id);
    t.equal(listed, expected.map((row) => ({ id: row.id, scoreCount: row.score_count })), 'scoreCount de cada evaluación');
    const countOf = (id) => evaluations.find((candidate) => candidate.id === id)?.scoreCount;
    t.equal(countOf(evaluation.id), 1, 'La evaluación creada cuenta la nota cargada');

    const { con_la_finalizada } = await t.sqlOne(`
      SELECT EXISTS (SELECT 1 FROM calificacion c WHERE c.evaluacion_id = $1 AND c.inscripcion_id = $2
                        AND c.fecha_eliminacion IS NULL) AS con_la_finalizada`, [closed.evaluationId, closed.enrollmentId]);
    t.require(con_la_finalizada, 'La evaluación del ciclo cerrado tiene que conservar la nota de la finalizada');
    const { evaluations: closedEvaluations } = await t.ok('evaluations.listByOwnAssignment', closed.assignment.id);
    t.equal(closedEvaluations.find((candidate) => candidate.id === closed.evaluationId)?.scoreCount, 1,
      'La evaluación del ciclo cerrado cuenta la nota de la finalizada');
    await t.logout();
  });

  test('term-closed-evaluation', 'Una evaluación de un trimestre cerrado no se edita ni se da de baja (TERM_CLOSED), y ninguna se crea ni pasa a una fecha de uno cerrado', async (t) => {
    const { assignment } = t.data;
    const { createdOn, closedTermToday, firstTermLastDay } = termDates(t);
    const closed = await firstTermEvaluation(t);
    const state = () => t.sqlOne(`
      SELECT e.titulo, to_char(e.fecha_evaluacion, 'YYYY-MM-DD') AS fecha, e.fecha_eliminacion IS NULL AS vigente,
             (SELECT COUNT(*)::INT FROM calificacion c WHERE c.evaluacion_id = e.evaluacion_id AND c.fecha_eliminacion IS NULL) AS vigentes
        FROM evaluacion e WHERE e.evaluacion_id = $1`, [closed.evaluationId]);
    const before = await state();
    t.require(before?.vigente && before.vigentes === 1, 'La evaluación del 01/01 tiene que estar vigente y con su nota', before);
    await t.login(t.data.teacher);
    await t.fixtures.onDate(closedTermToday, async () => {
      const { evaluations } = await t.ok('evaluations.listByOwnAssignment', assignment.id);
      // El 09/06 solo está cerrado el 1.er trimestre: las evaluaciones anteriores al 01/06
      const closedIds = (list) => sortedIds(list.filter((evaluation) => evaluation.isTermClosed));
      t.equal(closedIds(evaluations), sortedIds(evaluations.filter((evaluation) => evaluation.evaluationDate < `${t.year}-06-01`)),
        'isTermClosed marca solo las evaluaciones del 1.er trimestre');
      t.check(closedIds(evaluations).includes(closed.evaluationId), 'La evaluación del 01/01 es de un trimestre cerrado', evaluations);

      await t.rejects('TERM_CLOSED', 'evaluations.update', assignment.id, closed.evaluationId, { title: 'Renombrada', evaluationDate: createdOn });
      // Gana a los errores del formulario
      await t.rejects('TERM_CLOSED', 'evaluations.update', assignment.id, closed.evaluationId, { title: '', evaluationDate: closedTermToday });
      await t.rejects('TERM_CLOSED', 'evaluations.delete', assignment.id, closed.evaluationId);
      t.equal(await state(), before, 'La evaluación del trimestre cerrado y su nota no cambiaron');

      const created = await t.rejects('INVALID_INPUT', 'evaluations.create', assignment.id, { title: 'Del trimestre cerrado', evaluationDate: firstTermLastDay });
      t.check(created?.error?.fieldErrors?.evaluationDate, 'El alta con una fecha de un trimestre cerrado marca la fecha', created);
      const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM evaluacion WHERE asignacion_docente_id = $1 AND titulo = 'Del trimestre cerrado'`, [assignment.id]);
      t.equal(count, 0, 'No se creó la evaluación del trimestre cerrado');

      const { evaluation: open } = await t.ok('evaluations.create', assignment.id, { title: 'Del trimestre abierto', evaluationDate: closedTermToday });
      t.equal(open?.isTermClosed, false, 'La evaluación creada en el 2.º trimestre no es de un trimestre cerrado');
      const moved = await t.rejects('INVALID_INPUT', 'evaluations.update', assignment.id, open.id, { title: 'Del trimestre abierto', evaluationDate: firstTermLastDay });
      t.check(moved?.error?.fieldErrors?.evaluationDate, 'Pasar una evaluación a una fecha de un trimestre cerrado marca la fecha', moved);
      const { fecha } = await t.sqlOne(`SELECT to_char(fecha_evaluacion, 'YYYY-MM-DD') AS fecha FROM evaluacion WHERE evaluacion_id = $1`, [open.id]);
      t.equal(fecha, closedTermToday, 'La fecha de la evaluación abierta no cambió');
    });
    await t.logout();
  });

  test('term-closed-scores', 'En una evaluación de un trimestre cerrado no se carga, corrige ni da de baja ninguna nota (TERM_CLOSED)', async (t) => {
    const { assignment } = t.data;
    const closed = await firstTermEvaluation(t);
    const scoresOf = () => t.sql(`
      SELECT inscripcion_id AS id, nota::TEXT AS nota, fecha_eliminacion IS NOT NULL AS baja
        FROM calificacion WHERE evaluacion_id = $1 ORDER BY calificacion_id`, [closed.evaluationId]);
    const before = await scoresOf();
    t.equal(before, [{ id: closed.scoredId, nota: '6.00', baja: false }], 'La evaluación del 01/01 empieza con su nota');
    await t.login(t.data.teacher);
    await t.fixtures.onDate(termDates(t).closedTermToday, async () => {
      const listed = await t.ok('scores.listByOwnEvaluation', assignment.id, closed.evaluationId);
      t.equal(listed?.evaluation?.isTermClosed, true, 'Calificaciones trae la evaluación como de un trimestre cerrado');
      const { evaluationId, scoredId, unscoredId } = closed;
      await t.rejects('TERM_CLOSED', 'scores.save', assignment.id, evaluationId, { enrollmentId: unscoredId, value: 8 });
      await t.rejects('TERM_CLOSED', 'scores.save', assignment.id, evaluationId, { enrollmentId: scoredId, value: 9 });
      // Gana a INVALID_SCORE
      await t.rejects('TERM_CLOSED', 'scores.save', assignment.id, evaluationId, { enrollmentId: scoredId, value: 10.5 });
      const many = await t.rejects('TERM_CLOSED', 'scores.saveMany', assignment.id, evaluationId, [
        { enrollmentId: unscoredId, value: 8 },
        { enrollmentId: scoredId, value: null },
      ]);
      t.equal(many?.error?.enrollmentId, undefined, 'TERM_CLOSED es de la evaluación: no identifica un cambio');
      await t.rejects('TERM_CLOSED', 'scores.delete', assignment.id, evaluationId, scoredId);
    });
    t.equal(await scoresOf(), before, 'Las calificaciones de la evaluación no cambiaron');
    await t.logout();
  });

  test('evaluation-date-before-enrollment', 'Una evaluación calificada no pasa a una fecha anterior a la inscripción de un alumno calificado en ella', async (t) => {
    if (t.today === `${t.year}-01-01`) return t.warn('Hoy es el primer día del ciclo: no hay una fecha anterior a la inscripción que probar');
    const { assignment, course } = t.data;
    const yesterday = await yesterdayOf(t);
    const student = await t.fixtures.createStudent({ institutionId: course.institutionId });
    const enrollmentId = await t.fixtures.enroll({ studentId: student.id, courseId: course.id });
    await t.login(t.data.teacher);
    const title = 'Calificada el día de la inscripción';
    const { evaluation } = await t.ok('evaluations.create', assignment.id, { title, evaluationDate: t.today });
    await t.ok('scores.save', assignment.id, evaluation.id, { enrollmentId, value: 7 });
    const moved = await t.rejects('INVALID_INPUT', 'evaluations.update', assignment.id, evaluation.id, { title, evaluationDate: yesterday });
    t.check(moved?.error?.fieldErrors?.evaluationDate, 'El rechazo marca la fecha', moved);
    const { fecha } = await t.sqlOne(`SELECT to_char(fecha_evaluacion, 'YYYY-MM-DD') AS fecha FROM evaluacion WHERE evaluacion_id = $1`, [evaluation.id]);
    t.equal(fecha, t.today, 'La fecha de la evaluación no cambió');
    await t.logout();
  });

  test('scores-late-enrollment', 'Calificaciones no lista ni deja calificar una inscripción posterior a la evaluación, y scoreCount no cuenta su nota', async (t) => {
    if (t.today === `${t.year}-01-01`) return t.warn('Hoy es el primer día del ciclo: no hay una evaluación anterior a la inscripción que probar');
    const { assignment, course } = t.data;
    const yesterday = await yesterdayOf(t);
    const enrollOn = async (date) => t.fixtures.enroll({
      studentId: (await t.fixtures.createStudent({ institutionId: course.institutionId })).id,
      courseId: course.id,
      date,
    });
    const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id, date: yesterday });
    const early = await enrollOn(yesterday);
    const late = await enrollOn(t.today);
    // Calificada el día de la evaluación y después con la fecha de inscripción pasada a hoy: la base
    // no lo impide (limitación conocida de plans/promedios/README.md)
    const moved = await enrollOn(yesterday);
    await t.fixtures.score({ evaluationId, enrollmentId: early, value: 8 });
    await t.fixtures.score({ evaluationId, enrollmentId: moved, value: 5 });
    const setEnrollmentDate = (date) => t.db.query(`UPDATE inscripcion SET fecha_inscripcion = $2 WHERE inscripcion_id = $1`, [moved, date]);
    await setEnrollmentDate(t.today);
    try {
      await t.login(t.data.teacher);
      const { scores } = await t.ok('scores.listByOwnEvaluation', assignment.id, evaluationId);
      const expected = await t.sql(`
        SELECT i.inscripcion_id AS id FROM inscripcion i JOIN inscripcion_estado ie USING (inscripcion_estado_id)
         WHERE i.curso_id = $1 AND i.fecha_eliminacion IS NULL AND ie.nombre IN ('ACTIVA', 'FINALIZADA')
           AND i.fecha_inscripcion <= (SELECT fecha_evaluacion FROM evaluacion WHERE evaluacion_id = $2)`, [course.id, evaluationId]);
      const listedIds = scores.map((score) => score.enrollmentId).sort((a, b) => a - b);
      t.equal(listedIds, sortedNumbers(expected), 'Una fila por inscripción activa o finalizada inscripta a más tardar el día de la evaluación');
      t.check(listedIds.includes(early) && !listedIds.includes(late) && !listedIds.includes(moved),
        'Lista la inscripción anterior a la evaluación y ninguna de las posteriores', { listedIds, early, late, moved });

      const { evaluations } = await t.ok('evaluations.listByOwnAssignment', assignment.id);
      t.equal(evaluations.find((evaluation) => evaluation.id === evaluationId)?.scoreCount, 1,
        'scoreCount cuenta solo la nota de la inscripción anterior a la evaluación');

      const rejected = await t.rejects('ENROLLMENT_NOT_FOUND', 'scores.save', assignment.id, evaluationId, { enrollmentId: late, value: 6 });
      t.equal(rejected?.error?.code, 'ENROLLMENT_NOT_FOUND', 'Calificar la inscripción posterior se rechaza como una que no está en la lista');
      const many = await t.rejects('ENROLLMENT_NOT_FOUND', 'scores.saveMany', assignment.id, evaluationId, [
        { enrollmentId: early, value: 9 },
        { enrollmentId: late, value: 6 },
      ]);
      t.equal(many?.error?.enrollmentId, late, 'El rechazo identifica la inscripción posterior');
      const notes = await t.sql(`
        SELECT inscripcion_id AS id, nota::TEXT AS nota FROM calificacion
         WHERE evaluacion_id = $1 AND fecha_eliminacion IS NULL ORDER BY inscripcion_id`, [evaluationId]);
      t.equal(notes, [{ id: early, nota: '8.00' }, { id: moved, nota: '5.00' }].sort((a, b) => a.id - b.id), 'Los rechazos no cambiaron ninguna nota');
      await t.logout();
    } finally {
      // Vuelve a la fecha con la que se calificó: no queda una calificación anterior a la inscripción
      // (invariante calificacion-desde-inscripcion)
      await setEnrollmentDate(yesterday);
    }
  });

  test('averages', 'Los promedios trimestrales y anuales de Alumnos cuentan 0 la evaluación sin nota, excluyen la anterior a la inscripción y la futura, y marcan Parcial o Final', async (t) => {
    const { teacher, foreign, removed } = t.data;
    const institutionId = teacher.institutionId;
    const enrollStudent = async (courseId, date) => t.fixtures.enroll({
      studentId: (await t.fixtures.createStudent({ institutionId })).id,
      courseId,
      date,
    });
    const valuesOf = (row) => ({ terms: row.terms.map((term) => term.value), annual: row.annual.value });

    // Ciclo anterior, cerrado: datos de dos trimestres, cargados con el reloj en cada fecha. B se
    // inscribe después de la 1.ª evaluación (no le cuenta) y A no tiene nota en la 4.ª (le cuenta 0)
    const previous = await t.fixtures.inSchoolYear(t.year - 1, async () => {
      const year = t.year - 1;
      const course = await t.fixtures.createCourse({ institutionId });
      const assignment = await t.fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const setClock = (monthDay) => t.fixtures.db.query(replaceTodaySql(`${year}-${monthDay}`));
      const evaluate = (monthDay, scores) => async () => {
        const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id, date: `${year}-${monthDay}` });
        for (const [enrollmentId, value] of scores) await t.fixtures.score({ evaluationId, enrollmentId, value });
      };
      await setClock('03-01');
      const a = await enrollStudent(course.id, `${year}-03-01`);
      await evaluate('03-01', [[a, 6]])();
      await setClock('04-01');
      const b = await enrollStudent(course.id, `${year}-04-01`);
      await evaluate('04-01', [[a, 7.75], [b, 8]])();
      await setClock('07-15');
      await evaluate('07-01', [[a, 9.01], [b, 5]])();
      await evaluate('07-15', [[b, 6]])();
      return { assignment, a, b };
    });
    await t.fixtures.setEnrollmentStatus(previous.a, 'FINALIZADA');
    await t.fixtures.setEnrollmentStatus(previous.b, 'FINALIZADA');

    await t.login(teacher);
    await t.step('Ciclo cerrado', async () => {
      const averages = await checkAverages(t, previous.assignment.id, 'Ciclo cerrado');
      // A: 1.º (6 + 7,75) / 2 = 6,875; 2.º (9,01 + 0) / 2 = 4,505; anual 5,69, sin redondear antes
      // (con los trimestrales redondeados daría 5,70). B: 1.º solo la del 04/01 (8); 2.º 5,50
      t.equal(valuesOf(averages.get(previous.a)), { terms: [6.88, 4.51, null], annual: 5.69 }, 'Promedios de A');
      t.equal(valuesOf(averages.get(previous.b)), { terms: [8, 5.5, null], annual: 6.75 }, 'Promedios de B');
      const marks = averages.get(previous.a);
      t.equal([...marks.terms.map((term) => term.isFinal), marks.annual.isFinal], [true, true, false, true],
        'En un ciclo cerrado todo es Final, salvo el trimestre sin promedio');
    });

    // Ciclo actual: una evaluación del 01/01, con C calificado y D sin nota, y otra del 02/01, que
    // el 01/01 todavía es futura; todo creado el 01/01
    const { createdOn, closedTermToday } = termDates(t);
    const current = await t.fixtures.onDate(createdOn, async () => {
      const course = await t.fixtures.createCourse({ institutionId });
      const assignment = await t.fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const c = await enrollStudent(course.id);
      const d = await enrollStudent(course.id);
      const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id });
      await t.fixtures.score({ evaluationId, enrollmentId: c, value: 7 });
      await t.fixtures.createEvaluation({ assignmentId: assignment.id, date: `${t.year}-01-02` });
      return { assignment, c, d };
    });
    await t.step('Ciclo actual, 1.er trimestre abierto', async () => {
      await t.fixtures.onDate(createdOn, async () => {
        const averages = await checkAverages(t, current.assignment.id, 'El 01/01');
        t.equal(valuesOf(averages.get(current.c)), { terms: [7, null, null], annual: 7 }, 'La evaluación futura no cuenta');
        t.equal(valuesOf(averages.get(current.d)), { terms: [0, null, null], annual: 0 }, 'La evaluación sin nota cuenta 0');
        const marks = averages.get(current.c);
        t.equal([...marks.terms.map((term) => term.isFinal), marks.annual.isFinal], [false, false, false, false],
          'Con el trimestre abierto, todo es Parcial');
      });
    });
    await t.step('Ciclo actual, 1.er trimestre cerrado', async () => {
      await t.fixtures.onDate(closedTermToday, async () => {
        const averages = await checkAverages(t, current.assignment.id, 'El 09/06');
        t.equal(valuesOf(averages.get(current.c)), { terms: [3.5, null, null], annual: 3.5 }, 'La del 02/01 ya cuenta, con 0');
        const marks = averages.get(current.c);
        t.equal([...marks.terms.map((term) => term.isFinal), marks.annual.isFinal], [true, false, false, false],
          'El 1.er trimestre cerrado es Final; el anual sigue Parcial');
      });
    });

    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'scores.listAveragesByOwnAssignment', foreign.id);
    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'scores.listAveragesByOwnAssignment', removed.id);
    await t.logout();
  });
});
