const { group, test } = require('../lib/framework');

group('main.evaluation-failure-report', 'Reporte del profesor: evaluaciones con alta desaprobación', () => {
  test('score-outcomes', 'Cuenta las notas vigentes y las inscripciones elegibles de evaluaciones propias', async (t) => {
    const { fixtures } = t;
    const reportFor = async (schoolYear) =>
      (await t.ok('reports.getEvaluationFailureRates', { schoolYear })).report;
    const teacher = await fixtures.createUser();
    let evaluationId;
    await fixtures.onDate(`${t.year}-01-02`, async () => {
      const course = await fixtures.createCourse({ institutionId: teacher.institutionId });
      const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id, date: `${t.year}-01-01` });
      const futureId = await fixtures.createEvaluation({ assignmentId: assignment.id, date: `${t.year}-01-03` });
      const enroll = async (date = `${t.year}-01-01`) => {
        const student = await fixtures.createStudent({ institutionId: teacher.institutionId });
        return fixtures.enroll({ studentId: student.id, courseId: course.id, date });
      };
      for (const value of [5.99, 6, 8, 0]) {
        const enrollmentId = await enroll();
        const scoreId = await fixtures.score({ evaluationId, enrollmentId, value });
        if (value === 8) await t.sql('UPDATE calificacion SET fecha_eliminacion = now() WHERE calificacion_id = $1', [scoreId]);
        if (value === 0) await fixtures.setEnrollmentStatus(enrollmentId, 'CANCELADA');
      }
      await enroll();
      await enroll(t.fixtures.today);
      const foreign = await fixtures.teacherScenario({ institutionId: teacher.institutionId });

      await t.login(teacher);
      await t.rejects('INVALID_INPUT', 'reports.getEvaluationFailureRates', { schoolYear: String(t.year) });
      const report = await reportFor(t.year);
      t.equal(report.passingGrade, 6, 'Nota de aprobación fija');
      t.equal(report.evaluations.map(({ id }) => id), [evaluationId],
        `No aparecen la evaluación futura ${futureId} ni la ajena ${foreign.evaluationId}`);
      const { studentCount, gradedCount, passedCount, failedCount, pendingCount, isProvisional } = report.evaluations[0];
      t.equal({ studentCount, gradedCount, passedCount, failedCount, pendingCount, isProvisional },
        { studentCount: 4, gradedCount: 2, passedCount: 1, failedCount: 1, pendingCount: 2, isProvisional: true },
        'El 6 aprueba, el 5,99 desaprueba y quedan dos inscripciones sin nota vigente');
    });

    await fixtures.onDate(`${t.year}-06-09`, async () => {
      const { evaluations } = await reportFor(t.year);
      t.equal(evaluations.find(({ id }) => id === evaluationId).isProvisional, false, 'El trimestre cerrado ya no es provisorio');
    });

    const pastYear = t.year - 1;
    const historical = await fixtures.inSchoolYear(pastYear, async () => {
      const course = await fixtures.createCourse({ institutionId: teacher.institutionId });
      const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const student = await fixtures.createStudent({ institutionId: course.institutionId });
      const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
      const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
      await fixtures.score({ evaluationId, enrollmentId, value: 5 });
      return { evaluationId, enrollmentId };
    });
    await fixtures.setEnrollmentStatus(historical.enrollmentId, 'FINALIZADA');
    const { evaluations } = await reportFor(pastYear);
    t.equal(evaluations.map(({ id, gradedCount, failedCount, isProvisional }) => ({ id, gradedCount, failedCount, isProvisional })),
      [{ id: historical.evaluationId, gradedCount: 1, failedCount: 1, isProvisional: false }],
      'El ciclo anterior conserva las notas de inscripciones finalizadas');
    await t.logout();
  });
});
