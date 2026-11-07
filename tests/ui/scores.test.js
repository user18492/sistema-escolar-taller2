// Capa ui: Calificaciones del Profesor. Una evaluación con fecha futura se ve en solo lectura: se
// califica a partir de su fecha (plans/profesor-calificaciones.md). Los cambios en las notas, también
// los de otras páginas, se guardan juntos con "Guardar calificaciones", después de confirmarlo
// (pedido del 2026-11-06). Con cambios sin guardar, salir de la vista por la ruta de navegación o
// "Cerrar sesión" pide confirmación, y "Salir sin guardar" sale sin guardar nada
// (plans/profesor-calificaciones-sin-guardar/00-salir-de-la-vista.md).
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

  test('save-button', 'Las notas cargadas, corregidas y eliminadas en dos páginas se guardan juntas recién al confirmar "Guardar calificaciones"', async (t) => {
    const { ui } = t;
    const { teacher, assignment, course, enrollmentId } = t.data;
    // Once alumnos más, que van después del del setup (apellido "Suite…"): con él, diez en la página 1
    // y dos en la 2
    const enrollments = [];
    for (let i = 1; i <= 11; i += 1) {
      const student = await t.fixtures.createStudent({ institutionId: course.institutionId, lastName: `Zguardar${String(i).padStart(2, '0')}` });
      enrollments.push(await t.fixtures.enroll({ studentId: student.id, courseId: course.id }));
    }
    const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id });
    const [deleted] = enrollments;
    const [untouched, corrected] = enrollments.slice(-2);
    await t.fixtures.score({ evaluationId, enrollmentId: deleted, value: 6 });
    await t.fixtures.score({ evaluationId, enrollmentId: corrected, value: 5 });
    // Notas vigentes de la evaluación, por inscripción
    const current = async () => Object.fromEntries((await t.sql(`
      SELECT inscripcion_id AS id, nota::TEXT AS nota FROM calificacion
       WHERE evaluacion_id = $1 AND fecha_eliminacion IS NULL`, [evaluationId])).map((row) => [row.id, row.nota]));
    const before = await current();
    const row = (id) => `tr[data-enrollment-id="${id}"]`;
    const input = (id) => `${row(id)} .numeric-stepper-input`;
    const isSaveEnabled = () => ui.js(`!document.getElementById('saveScoresBtn').disabled`);
    const goToPage = async (page) => {
      await ui.dismissToasts();
      await ui.click(`.pagination .page-btn[data-page="${page}"]:not(.page-nav)`);
      await ui.idle();
    };

    await loginViaUi(t, teacher);
    const query = new URLSearchParams({ assignmentId: String(assignment.id), evaluationId: String(evaluationId) });
    t.require(await ui.navigate(`${SCORES_VIEW}?${query}`) === SCORES_VIEW, 'No se abrieron las calificaciones de la evaluación');
    await ui.idle();
    await ui.waitFor(`document.querySelector('${input(enrollmentId)}')`, { message: 'La fila del alumno del setup no está en la página 1' });
    t.check(!(await isSaveEnabled()), '"Guardar calificaciones" está deshabilitado sin cambios');

    await t.step('Cambios en las dos páginas, sin guardar', async () => {
      await ui.fill(input(enrollmentId), '7');
      await ui.press('Enter');
      await ui.click(`${row(deleted)} [data-action="delete"]`);
      t.equal(await ui.value(input(deleted)), '', 'Eliminar vacía el campo de la fila');
      await goToPage(2);
      await ui.waitFor(`document.querySelector('${input(corrected)}')`, { message: 'La fila con nota de la página 2 no apareció' });
      await ui.fill(input(corrected), '9');
      await ui.press('Enter');
      // Escribir y volver a vaciar una nota nueva no deja ningún cambio
      await ui.fill(input(untouched), '4');
      await ui.fill(input(untouched), '');
      await ui.press('Enter');
      await ui.idle();
      t.equal(await current(), before, 'Nada se guardó todavía');
      t.check(await isSaveEnabled(), '"Guardar calificaciones" se habilitó con los cambios');
      await goToPage(1);
      t.equal([await ui.value(input(enrollmentId)), await ui.value(input(deleted))], ['7', ''], 'Los cambios de la página 1 se conservan al volver a ella');
    });

    await t.step('Cancelar no guarda', async () => {
      await ui.click('#saveScoresBtn');
      await ui.waitModal('#saveScoresOverlay', true);
      await ui.click('#cancelSaveScoresBtn', { scroll: false });
      await ui.waitModal('#saveScoresOverlay', false);
      await ui.idle();
      t.equal(await current(), before, 'Cancelar no guardó nada');
      t.check(await isSaveEnabled(), 'Los cambios siguen sin guardar');
    });

    await t.step('Confirmar guarda todos los cambios', async () => {
      await ui.click('#saveScoresBtn');
      await ui.waitModal('#saveScoresOverlay', true);
      await ui.click('#confirmSaveScoresBtn', { scroll: false });
      await ui.waitModal('#saveScoresOverlay', false);
      await ui.idle();
      t.equal(await current(), { [enrollmentId]: '7.00', [corrected]: '9.00' }, 'Se cargó la nota de la página 1, se corrigió la de la página 2 y se dio de baja la eliminada');
      const { baja } = await t.sqlOne(`SELECT bool_and(fecha_eliminacion IS NOT NULL) AS baja FROM calificacion WHERE evaluacion_id = $1 AND inscripcion_id = $2`, [evaluationId, deleted]);
      t.check(baja, 'La calificación eliminada quedó dada de baja, con su fila');
      t.check(!(await isSaveEnabled()), '"Guardar calificaciones" vuelve a quedar deshabilitado');
      t.check((await ui.toasts()).some((toast) => toast.type === 'success'), 'Un toast avisa que se guardaron');
      await ui.dismissToasts();
    });
    await logoutViaUi(t);
  });
});

group('ui.scores-unsaved', 'Calificaciones: salir de la vista con cambios sin guardar', {
  async setup({ fixtures }) {
    return fixtures.teacherScenario();
  },
}, () => {
  const EVALUATIONS_VIEW = 'teacher/assignment-evaluations/index.html';
  const BREADCRUMB_EVALUATIONS = `.breadcrumb a[href*="assignment-evaluations"]`;
  const LEAVE_OVERLAY = '#leaveScoresOverlay';

  // Inicia sesión y abre las calificaciones de la evaluación del setup. Devuelve el selector del
  // campo de la nota de su alumno.
  const openScores = async (t) => {
    const { ui } = t;
    const { teacher, assignment, enrollmentId, evaluationId } = t.data;
    await loginViaUi(t, teacher);
    const query = new URLSearchParams({ assignmentId: String(assignment.id), evaluationId: String(evaluationId) });
    t.require(await ui.navigate(`${SCORES_VIEW}?${query}`) === SCORES_VIEW, 'No se abrieron las calificaciones de la evaluación');
    await ui.idle();
    const input = `tr[data-enrollment-id="${enrollmentId}"] .numeric-stepper-input`;
    await ui.waitFor(`document.querySelector('${input}') && !document.querySelector('${input}').disabled`, { message: 'La nota del alumno no está disponible en Calificaciones' });
    return input;
  };

  // Calificaciones de la evaluación del setup, también las dadas de baja
  const scoreRows = (t) => t.sql(`
    SELECT inscripcion_id, nota::TEXT AS nota, fecha_eliminacion IS NOT NULL AS baja FROM calificacion
     WHERE evaluacion_id = $1 ORDER BY inscripcion_id`, [t.data.evaluationId]);

  // Escribe una nota sin guardarla
  const changeScore = async (t, input) => {
    await t.ui.fill(input, '7');
    await t.ui.press('Enter');
    await t.ui.idle();
    t.check(await t.ui.js(`!document.getElementById('saveScoresBtn').disabled`), 'La nota quedó como cambio sin guardar');
  };

  test('leave-unsaved-confirm', 'Con una nota sin guardar, la ruta de navegación pide confirmación: Cancelar se queda con el cambio y "Salir sin guardar" sale sin guardarlo', async (t) => {
    const { ui } = t;
    const input = await openScores(t);
    const before = await scoreRows(t);
    await changeScore(t, input);

    await t.step('Cancelar', async () => {
      await ui.click(BREADCRUMB_EVALUATIONS);
      await ui.waitModal(LEAVE_OVERLAY, true);
      t.equal(ui.view(), SCORES_VIEW, 'Con el modal abierto la vista no cambió');
      await ui.click('#cancelLeaveScoresBtn', { scroll: false });
      await ui.waitModal(LEAVE_OVERLAY, false);
      await ui.idle();
      t.equal(ui.view(), SCORES_VIEW, 'Cancelar se queda en Calificaciones');
      t.equal(await ui.value(input), '7', 'La nota sin guardar sigue en su campo');
      t.check(await ui.js(`document.activeElement === document.querySelector('${BREADCRUMB_EVALUATIONS}')`), 'El foco vuelve al enlace de la ruta de navegación');
    });

    await t.step('Salir sin guardar', async () => {
      await ui.click(BREADCRUMB_EVALUATIONS);
      await ui.waitModal(LEAVE_OVERLAY, true);
      await ui.click('#confirmLeaveScoresBtn', { scroll: false });
      t.require(await ui.waitForView(EVALUATIONS_VIEW), '"Salir sin guardar" no abrió Evaluaciones', ui.view());
      await ui.idle();
      await ui.waitFor(`document.querySelector('tr[data-evaluation-id="${t.data.evaluationId}"]')`, { message: 'Evaluaciones no muestra la evaluación de la asignación' });
      t.equal(await scoreRows(t), before, 'La nota sin guardar no se guardó');
    });
    await logoutViaUi(t);
  });

  test('logout-unsaved-confirm', 'Con una nota sin guardar, "Cerrar sesión" pide confirmación y al confirmar vuelve al login sin guardarla', async (t) => {
    const { ui } = t;
    const input = await openScores(t);
    const before = await scoreRows(t);
    await changeScore(t, input);

    await ui.click('.sidebar-profile .profile-button');
    await ui.waitFor(`document.getElementById('profilePanel').classList.contains('is-open')`, { message: 'No se abrió el menú del perfil' });
    await ui.click('#profilePanel [data-action="logout"]');
    await ui.waitModal(LEAVE_OVERLAY, true);
    t.equal(ui.view(), SCORES_VIEW, 'Con el modal abierto la sesión sigue en Calificaciones');
    await ui.click('#confirmLeaveScoresBtn', { scroll: false });
    t.require(await ui.waitForView('auth/login/index.html'), '"Salir sin guardar" no volvió al login', ui.view());
    await ui.idle();
    t.equal(await t.call('auth.getCurrentUser'), null, 'La sesión se cerró');
    t.equal(await scoreRows(t), before, 'La nota sin guardar no se guardó');
  });

  test('undo-change', 'Deshacer cambio, solo en la fila modificada, devuelve la nota guardada, deshabilita "Guardar calificaciones" y la ruta de navegación sale sin pedir confirmación', async (t) => {
    const { ui } = t;
    const input = await openScores(t);
    const row = input.replace(' .numeric-stepper-input', '');
    const undo = `${row} [data-action="undo"]`;
    const isUndoVisible = () => ui.js(`document.querySelector('${undo}')?.offsetParent != null`);
    const before = await scoreRows(t);
    const saved = await ui.value(input);
    t.check(!(await isUndoVisible()), 'Sin cambios, la fila no muestra Deshacer');
    await changeScore(t, input);
    t.check(await isUndoVisible(), 'Con la nota cambiada, la fila muestra Deshacer');

    await ui.click(undo);
    await ui.idle();
    t.equal(await ui.value(input), saved, 'El campo vuelve a la nota guardada');
    t.check(!(await isUndoVisible()), 'Deshacer se oculta');
    t.check(await ui.js(`document.querySelector('${row} .unsaved-mark').hidden`), 'La marca de cambio sin guardar se oculta');
    t.check(await ui.js(`document.getElementById('saveScoresBtn').disabled`), '"Guardar calificaciones" vuelve a quedar deshabilitado');

    await ui.click(BREADCRUMB_EVALUATIONS);
    t.require(await ui.waitForView(EVALUATIONS_VIEW), 'Con el cambio deshecho, la ruta de navegación no salió de Calificaciones sin confirmación', ui.view());
    await ui.idle();
    t.equal(await scoreRows(t), before, 'No se guardó nada');
    await logoutViaUi(t);
  });

  test('leave-without-changes', 'Sin cambios sin guardar, la ruta de navegación sale de Calificaciones sin pedir confirmación', async (t) => {
    const { ui } = t;
    await openScores(t);
    await ui.click(BREADCRUMB_EVALUATIONS);
    t.require(await ui.waitForView(EVALUATIONS_VIEW), 'La ruta de navegación no abrió Evaluaciones sin cambios sin guardar', ui.view());
    await ui.idle();
    await logoutViaUi(t);
  });
});
