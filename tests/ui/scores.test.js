// Capa ui: Calificaciones del Profesor. Una evaluación con fecha futura se ve en solo lectura: se
// califica a partir de su fecha (plans/profesor-calificaciones.md).
const { group, test } = require('../lib/framework');
const { loginViaUi, logoutViaUi } = require('./helpers');

const SCORES_VIEW = 'teacher/evaluation-scores/index.html';

group('ui.scores', 'Calificaciones: evaluación con fecha futura', {
  async setup({ fixtures }) {
    const scenario = await fixtures.teacherScenario();
    const lastDay = `${fixtures.year}-12-31`;
    const futureEvaluationId = fixtures.today < lastDay
      ? await fixtures.createEvaluation({ assignmentId: scenario.assignment.id, date: lastDay })
      : null;
    return { ...scenario, lastDay, futureEvaluationId };
  },
}, () => {
  test('future-evaluation-read-only', 'En una evaluación con fecha futura la nota queda deshabilitada y su title da la fecha; en una de hoy, habilitada', async (t) => {
    const { ui } = t;
    const { teacher, assignment, enrollmentId, evaluationId, lastDay, futureEvaluationId } = t.data;
    if (!futureEvaluationId) return t.warn('Hoy es el último día del ciclo: no hay fecha futura que probar');
    const input = `tr[data-enrollment-id="${enrollmentId}"] .numeric-stepper-input`;
    // Estado del campo de la nota del alumno: { disabled, title }, con el title del control
    const scoreField = async () => {
      await ui.waitFor(`document.querySelector('${input}')`, { message: 'La fila del alumno no apareció en Calificaciones' });
      return ui.js(`(() => {
        const input = document.querySelector('${input}');
        return { disabled: input.disabled, title: input.closest('.numeric-stepper').title };
      })()`);
    };

    await loginViaUi(t, teacher);
    await t.step('Evaluación con fecha futura, desde Gestionar', async () => {
      await ui.waitFor(`document.querySelector('tr[data-assignment-id="${assignment.id}"]')`, { message: 'La asignación no aparece en el listado del profesor' });
      await ui.click(`tr[data-assignment-id="${assignment.id}"] a.manage-link`);
      t.require(await ui.waitForView('teacher/assignment-management/index.html'), 'Gestionar no abrió la asignación');
      await ui.idle();
      await ui.click('.option-item[href*="assignment-evaluations"]');
      t.require(await ui.waitForView('teacher/assignment-evaluations/index.html'), 'No se abrió Evaluaciones');
      await ui.idle();
      await ui.waitFor(`document.querySelector('tr[data-evaluation-id="${futureEvaluationId}"] a.manage-link')`, { message: 'La evaluación con fecha futura no aparece en Evaluaciones' });
      await ui.click(`tr[data-evaluation-id="${futureEvaluationId}"] a.manage-link`);
      t.require(await ui.waitForView(SCORES_VIEW), 'Gestionar no abrió las calificaciones de la evaluación con fecha futura');
      await ui.idle();
      const field = await scoreField();
      const displayDate = lastDay.split('-').reverse().join('/');
      t.check(field.disabled, 'La nota está deshabilitada en una evaluación con fecha futura', field);
      t.check(field.title.includes(displayDate), `El title de la nota da la fecha de la evaluación (${displayDate})`, field);
    });

    await t.step('Evaluación de hoy', async () => {
      const query = new URLSearchParams({ assignmentId: String(assignment.id), evaluationId: String(evaluationId) });
      t.require(await ui.navigate(`${SCORES_VIEW}?${query}`) === SCORES_VIEW, 'No se abrieron las calificaciones de la evaluación de hoy');
      await ui.idle();
      const field = await scoreField();
      t.check(!field.disabled, 'La nota está habilitada en una evaluación de hoy', field);
    });
    await logoutViaUi(t);
  });
});
