// Capa ui: Evaluaciones del Profesor. Al eliminar una evaluación con calificaciones cargadas, el
// modal advierte cuántas hay y que también se dan de baja
// (plans/profesor-evaluaciones/01-advertencia-de-baja.md). Una evaluación de un trimestre cerrado se
// ve en solo lectura (plans/promedios/02-restricciones-backend-y-vistas.md), con el reloj de la base
// fijado como en main.teacher: datos del 01/01 del ciclo actual vistos el 09/06, con el 1°
// trimestre ya cerrado y el 2° abierto.
const { group, test } = require('../lib/framework');
const { loginViaUi, logoutViaUi, rowActionsState } = require('./helpers');

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

  test('term-closed-read-only', 'Una evaluación de un trimestre cerrado tiene Editar y Eliminar deshabilitados, con el motivo como title; Gestionar sigue habilitado', {
    history: [{ plan: 'Pedido del 2026-11-08: formato único de los trimestres (sin plan en plans/)', date: '2026-11-08', change: 'Los trimestres se nombran "1° trimestre", "2° trimestre" y "3° trimestre" (antes "1.er", "2.º", "3.er") en los comentarios' }],
  }, async (t) => {
    const { ui } = t;
    const { teacher, assignment } = t.data;
    const closedTermToday = `${t.year}-06-09`;
    // Una del 01/01 (1° trimestre) y otra del 09/06 (2° trimestre), creadas el 01/01
    const { closedId, openId } = await t.fixtures.onDate(`${t.year}-01-01`, async () => ({
      closedId: await t.fixtures.createEvaluation({ assignmentId: assignment.id, title: 'Del trimestre cerrado' }),
      openId: await t.fixtures.createEvaluation({ assignmentId: assignment.id, title: 'Del trimestre abierto', date: closedTermToday }),
    }));
    const row = (id) => `tr[data-evaluation-id="${id}"]`;

    await loginViaUi(t, teacher);
    await t.fixtures.onDate(closedTermToday, async () => {
      const query = new URLSearchParams({ assignmentId: String(assignment.id) });
      t.require(await ui.navigate(`${EVALUATIONS_VIEW}?${query}`) === EVALUATIONS_VIEW, 'No se abrió Evaluaciones');
      await ui.waitFor(`document.querySelector('${row(closedId)} [data-action="edit"]') && document.querySelector('${row(openId)} [data-action="edit"]')`, { message: 'Las evaluaciones de los dos trimestres no aparecen en Evaluaciones' });
      const closedActions = await rowActionsState(t, row(closedId));
      for (const action of ['edit', 'delete']) {
        const { disabled, title, label } = closedActions[action];
        t.check(disabled, `${label}: deshabilitado en una evaluación de un trimestre cerrado`, closedActions[action]);
        t.check(title !== label && /trimestre/i.test(title), `${label}: el title explica que el trimestre está cerrado`, closedActions[action]);
      }
      const manageEnabled = await ui.js(`Boolean(document.querySelector('${row(closedId)} a.manage-link'))`);
      t.check(manageEnabled, 'Gestionar sigue disponible en una evaluación de un trimestre cerrado');
      const openActions = await rowActionsState(t, row(openId));
      t.check(['edit', 'delete'].every((action) => !openActions[action].disabled), 'Editar y Eliminar siguen habilitados en una evaluación del trimestre abierto', openActions);
      t.check(!(await ui.js(`document.getElementById('openNewEvaluationModalBtn').disabled`)), 'Nueva evaluación sigue habilitado');
    });
    await logoutViaUi(t);
  });
});
