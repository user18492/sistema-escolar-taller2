const { group, test } = require('../lib/framework');

const REPORT_VIEW = 'teacher/evaluation-failure-report/index.html';
const row = (id) => `tr[data-evaluation-id="${id}"]`;

group('ui.evaluation-failure-report', 'Reporte del profesor: evaluaciones con alta desaprobación', () => {
  test('criteria-and-detail', 'Distingue una evaluación para revisar de una con poca carga y conserva los criterios al volver del detalle', async (t) => {
    const { fixtures, ui } = t;
    const teacher = await fixtures.createUser();
    await fixtures.onDate(`${t.year}-01-01`, async () => {
      const course = await fixtures.createCourse({ institutionId: teacher.institutionId });
      const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const reviewId = await fixtures.createEvaluation({ assignmentId: assignment.id, title: 'Evaluación con cobertura' });
      const incompleteId = await fixtures.createEvaluation({ assignmentId: assignment.id, title: 'Evaluación con poca carga' });
      const ungradedId = await fixtures.createEvaluation({ assignmentId: assignment.id, title: 'Evaluación sin notas' });
      for (let index = 0; index < 12; index++) {
        const student = await fixtures.createStudent({ institutionId: teacher.institutionId });
        const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
        if (index < 10) await fixtures.score({ evaluationId: reviewId, enrollmentId, value: index < 4 ? 5.99 : 6 });
        if (index === 0) await fixtures.score({ evaluationId: incompleteId, enrollmentId, value: 4 });
      }

      await t.login(teacher);
      await ui.navigate('teacher/reports/index.html');
      await ui.click('a[href="../evaluation-failure-report/index.html"]');
      await ui.waitForView(REPORT_VIEW);
      await ui.waitFor(`document.querySelector('${row(reviewId)}') !== null`);
      const statusOf = (id) => ui.js(`document.querySelector('${row(id)}')?.dataset.status`);
      const textOf = (selector) => ui.js(`document.querySelector('${selector}')?.textContent`);
      t.equal(await statusOf(reviewId), 'review', 'El 40 % exacto alcanza para revisar');
      t.equal(await statusOf(incompleteId), 'incomplete', 'Pocas notas, aunque todas estén desaprobadas');
      t.equal(await statusOf(ungradedId), 'ungraded', 'Sin notas');
      t.equal(await textOf(`${row(reviewId)} .coverage-count`), '10 de 12', 'Cobertura sobre el total');
      t.equal(await textOf(`${row(reviewId)} .pending-count`), '2 sin nota', 'Sin nota aparte');
      t.equal(await ui.js(`document.querySelector('${row(reviewId)} .provisional').hidden`), false, 'Resultado provisorio');

      await ui.fill('input[name="failure"]', '41');
      await ui.click('.failure-criteria button');
      t.equal(await statusOf(reviewId), 'regular', 'El umbral que eligió el profesor se aplica');
      await ui.fill('input[name="coverage"]', '90');
      await ui.click('.failure-criteria button');
      t.equal(await statusOf(reviewId), 'incomplete', 'Una cobertura mínima mayor también se aplica');
      await ui.click('button[data-status="incomplete"]');
      await ui.click(`${row(reviewId)} a`);
      await ui.waitForView('teacher/evaluation-scores/index.html');
      await ui.waitFor('document.querySelector(".scores-card tbody tr[data-enrollment-id]") !== null');
      await ui.click('#returnToFailureReport');
      await ui.waitForView(REPORT_VIEW);
      await ui.waitFor(`document.querySelector('${row(reviewId)}') !== null`);
      t.equal(await ui.js(`document.querySelector('input[name="failure"]').value`), '41', 'Volvió con el umbral elegido');
      t.equal(await ui.js(`document.querySelector('button[data-status="incomplete"]').getAttribute('aria-pressed')`),
        'true', 'Volvió con el filtro de estado');
      await t.logout();
    });
  });
});
