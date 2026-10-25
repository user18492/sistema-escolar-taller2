// Capa main: casos de uso del Profesor por la API del preload (asignaciones propias, alumnos del
// curso, evaluaciones y calificaciones). Opera con un profesor propio sobre un curso propio del ciclo
// actual; cada resultado se comprueba con una consulta independiente.
const { group, test } = require('../lib/framework');
const { sortedIds, sortedNumbers } = require('../lib/domain');

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
    // Inscripciones del curso en los demás estados
    const finishedStudent = await fixtures.createStudent();
    const finished = await fixtures.enroll({ studentId: finishedStudent.id, courseId: course.id });
    const cancelledStudent = await fixtures.createStudent();
    const cancelled = await fixtures.enroll({ studentId: cancelledStudent.id, courseId: course.id });
    await fixtures.setEnrollmentStatus(cancelled, 'CANCELADA');
    const deletedStudent = await fixtures.createStudent();
    await fixtures.enroll({ studentId: deletedStudent.id, courseId: course.id, deleted: true });
    // La finalizada tiene una nota de cuando estaba activa
    await fixtures.score({ evaluationId: scenario.evaluationId, enrollmentId: finished, value: 6.5 });
    await fixtures.setEnrollmentStatus(finished, 'FINALIZADA');
    return { ...scenario, second, foreign, foreignEvaluation, removed, finished, cancelled, assignment };
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

  test('students', 'Los alumnos de la asignación son las inscripciones vigentes, activas y finalizadas, de su curso', async (t) => {
    await t.login(t.data.teacher);
    const { enrollments } = await t.ok('enrollments.listByOwnAssignment', t.data.assignment.id);
    const expected = await t.sql(`
      SELECT i.inscripcion_id AS id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
       WHERE i.curso_id = $1 AND i.fecha_eliminacion IS NULL AND e.nombre IN ('ACTIVA', 'FINALIZADA')`, [t.data.course.id]);
    t.equal(sortedIds(enrollments), sortedNumbers(expected), 'Inscripciones listadas');
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

  test('scores', 'Carga, corrección y baja de una nota; la finalizada es de solo lectura', async (t) => {
    await t.login(t.data.teacher);
    const { assignment, evaluationId, enrollmentId, finished } = t.data;
    const listed = await t.ok('scores.listByOwnEvaluation', assignment.id, evaluationId);
    const expected = await t.sql(`
      SELECT i.inscripcion_id AS id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
       WHERE i.curso_id = $1 AND i.fecha_eliminacion IS NULL AND e.nombre IN ('ACTIVA', 'FINALIZADA')`, [t.data.course.id]);
    t.equal(listed.scores.map((score) => score.enrollmentId).sort((a, b) => a - b), sortedNumbers(expected), 'Una fila por inscripción activa o finalizada');
    const finishedRow = listed.scores.find((score) => score.enrollmentId === finished);
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
    await t.rejects('ENROLLMENT_NOT_ACTIVE', 'scores.save', assignment.id, evaluationId, { enrollmentId: finished, value: 9 });
    await t.rejects('TEACHER_ASSIGNMENT_NOT_FOUND', 'scores.listByOwnEvaluation', t.data.foreign.id, t.data.foreignEvaluation);
    await t.rejects('EVALUATION_NOT_FOUND', 'scores.listByOwnEvaluation', assignment.id, t.data.foreignEvaluation);
    await t.logout();
  });

  test('evaluation-delete-keeps-scores', 'Hoy la baja de una evaluación conserva vigentes sus calificaciones', {
    kind: 'current',
    affectedBy: ['profesor-evaluaciones'],
  }, async (t) => {
    await t.login(t.data.teacher);
    const { assignment, enrollmentId } = t.data;
    const { evaluation } = await t.ok('evaluations.create', assignment.id, { title: 'Con notas', evaluationDate: t.today });
    await t.ok('scores.save', assignment.id, evaluation.id, { enrollmentId, value: 5 });
    await t.ok('evaluations.delete', assignment.id, evaluation.id);
    const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM calificacion WHERE evaluacion_id = $1 AND fecha_eliminacion IS NULL`, [evaluation.id]);
    t.equal(count, 1, 'La calificación sigue vigente');
    await t.logout();
  });

  test('score-on-future-evaluation', 'Hoy se puede calificar una evaluación con fecha futura', {
    kind: 'current',
    affectedBy: ['profesor-calificaciones'],
  }, async (t) => {
    const lastDay = `${t.year}-12-31`;
    if (t.today >= lastDay) return t.warn('Hoy es el último día del ciclo: no hay fecha futura que probar');
    await t.login(t.data.teacher);
    const { assignment, enrollmentId } = t.data;
    const { evaluation } = await t.ok('evaluations.create', assignment.id, { title: 'Futura', evaluationDate: lastDay });
    await t.ok('scores.save', assignment.id, evaluation.id, { enrollmentId, value: 6 });
    await t.logout();
  });
});
