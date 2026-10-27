// Capa ui: Evaluaciones del Profesor. Al eliminar una evaluación con calificaciones cargadas, el
// modal advierte cuántas hay y que también se dan de baja
// (plans/profesor-evaluaciones/01-advertencia-de-baja.md).
const { group, test } = require('../lib/framework');
const { loginViaUi, logoutViaUi } = require('./helpers');

const EVALUATIONS_VIEW = 'teacher/assignment-evaluations/index.html';

group('ui.evaluations', 'Evaluaciones: advertencia al eliminar una evaluación calificada', {
  async setup({ fixtures }) {
    const scenario = await fixtures.teacherScenario();
    const { course, enrollmentId, evaluationId, assignment } = scenario;
    const secondStudent = await fixtures.createStudent();
    const secondEnrollmentId = await fixtures.enroll({ studentId: secondStudent.id, courseId: course.id });
    await fixtures.score({ evaluationId, enrollmentId });
    await fixtures.score({ evaluationId, enrollmentId: secondEnrollmentId });
    const unscoredEvaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
    return { ...scenario, unscoredEvaluationId };
  },
}, () => {
  test('delete-warning', 'Eliminar una evaluación con calificaciones advierte cuántas tiene, y una sin calificaciones no', async (t) => {
    const { ui } = t;
    const { teacher, assignment, evaluationId, unscoredEvaluationId } = t.data;
    const deleteButton = (id) => `tr[data-evaluation-id="${id}"] [data-action="delete"]`;
    // Abre el modal de Eliminar desde la fila y devuelve su descripción
    const openDeleteModal = async (id) => {
      await ui.click(deleteButton(id));
      await ui.waitModal('#deleteEvaluationOverlay', true);
      return ui.text('#deleteEvaluationDescription');
    };

    await loginViaUi(t, teacher);
    const query = new URLSearchParams({ assignmentId: String(assignment.id) });
    t.require(await ui.navigate(`${EVALUATIONS_VIEW}?${query}`) === EVALUATIONS_VIEW, 'No se abrió Evaluaciones');
    await ui.waitFor(`document.querySelector('${deleteButton(unscoredEvaluationId)}') && document.querySelector('${deleteButton(evaluationId)}')`, { message: 'Las evaluaciones del setup no aparecen en Evaluaciones' });

    await t.step('Sin calificaciones', async () => {
      const description = await openDeleteModal(unscoredEvaluationId);
      t.check(description && !/\d/.test(description), 'La descripción no menciona ninguna cantidad', description);
      await ui.click('#cancelDeleteEvaluationBtn', { scroll: false });
      await ui.waitModal('#deleteEvaluationOverlay', false);
    });

    await t.step('Con dos calificaciones', async () => {
      const description = await openDeleteModal(evaluationId);
      t.check(description.includes('2'), 'La descripción advierte las 2 calificaciones', description);
      await ui.click('#confirmDeleteEvaluationBtn', { scroll: false });
      await ui.waitModal('#deleteEvaluationOverlay', false);
      await ui.idle();
    });

    const state = await t.sqlOne(`
      SELECT e.fecha_eliminacion IS NOT NULL AS baja,
             (SELECT COUNT(*)::INT FROM calificacion c WHERE c.evaluacion_id = e.evaluacion_id AND c.fecha_eliminacion IS NULL) AS vigentes
        FROM evaluacion e WHERE e.evaluacion_id = $1`, [evaluationId]);
    t.equal(state, { baja: true, vigentes: 0 }, 'La evaluación quedó dada de baja y sin calificaciones vigentes');
    await logoutViaUi(t);
  });
});
