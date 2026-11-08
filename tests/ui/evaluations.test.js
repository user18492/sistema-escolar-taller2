// Capa ui: Evaluaciones del Profesor. Al eliminar una evaluación con calificaciones cargadas, el
// modal advierte cuántas hay y que también se dan de baja
// (plans/profesor-evaluaciones/01-advertencia-de-baja.md). Una evaluación de un trimestre cerrado se
// ve en solo lectura (plans/promedios/02-restricciones-backend-y-vistas.md), con el reloj de la base
// fijado como en main.teacher: datos del 01/01 del ciclo actual vistos el 09/06, con el 1°
// trimestre ya cerrado y el 2° abierto. La columna Trimestre y su filtro, combinado con el de Título
// y con la paginación, se prueban con el mismo reloj, en una asignación aparte con dos páginas.
const { group, test } = require('../lib/framework');
const { loginViaUi, logoutViaUi, rowActionsState, chooseColumnFilterOption, clearColumnFilter } = require('./helpers');

const EVALUATIONS_VIEW = 'teacher/assignment-evaluations/index.html';
// El title de Editar y Eliminar en una evaluación del 1° trimestre, ya cerrado
const CLOSED_FIRST_TERM_TITLE = 'El 1° trimestre está cerrado: esta evaluación es de solo lectura.';

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
    history: [
      { plan: 'Pedido del 2026-11-08: formato único de los trimestres (sin plan en plans/)', date: '2026-11-08', change: 'Los trimestres se nombran "1° trimestre", "2° trimestre" y "3° trimestre" (antes "1.er", "2.º", "3.er") en los comentarios' },
      { plan: 'Pedido del 2026-11-08: columna y filtro Trimestre en Evaluaciones del Profesor (sin plan en plans/)', date: '2026-11-08', change: 'El title de Editar y Eliminar nombra el trimestre cerrado: espera "El 1° trimestre está cerrado: esta evaluación es de solo lectura." en lugar de solo mencionar "trimestre"' },
    ],
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
        t.equal(title, CLOSED_FIRST_TERM_TITLE, `${label}: el title nombra el trimestre cerrado`);
      }
      const manageEnabled = await ui.js(`Boolean(document.querySelector('${row(closedId)} a.manage-link'))`);
      t.check(manageEnabled, 'Gestionar sigue disponible en una evaluación de un trimestre cerrado');
      const openActions = await rowActionsState(t, row(openId));
      t.check(['edit', 'delete'].every((action) => !openActions[action].disabled), 'Editar y Eliminar siguen habilitados en una evaluación del trimestre abierto', openActions);
      t.check(!(await ui.js(`document.getElementById('openNewEvaluationModalBtn').disabled`)), 'Nueva evaluación sigue habilitado');
    });
    await logoutViaUi(t);
  });

  test('term-column-filter', 'La columna Trimestre nombra el trimestre de cada evaluación; su filtro se combina con el de Título, vuelve a la página 1 y la paginación cuenta solo las filtradas', async (t) => {
    const { ui } = t;
    const { teacher, course } = t.data;
    const closedTermToday = `${t.year}-06-09`;
    // Una asignación propia, aparte de la del setup: 3 evaluaciones del 1° trimestre y 12 del 2°
    // (dos páginas), creadas el 01/01 y vistas el 09/06, con el 1° ya cerrado
    const otherCourse = await t.fixtures.createCourse({ institutionId: course.institutionId });
    const assignment = await t.fixtures.assign({ teacherId: teacher.id, courseId: otherCourse.id });
    const firstTermDays = ['01-10', '03-15', '05-31'];
    const secondTermDays = Array.from({ length: 12 }, (_, index) => `06-${String(index + 1).padStart(2, '0')}`);
    const ids = await t.fixtures.onDate(`${t.year}-01-01`, async () => {
      const created = {};
      for (const day of [...firstTermDays, ...secondTermDays]) {
        created[day] = await t.fixtures.createEvaluation({ assignmentId: assignment.id, title: `Evaluación del ${day}`, date: `${t.year}-${day}` });
      }
      return created;
    });
    // Lo que muestra la tabla: el encabezado, el total de la paginación, la página actual y, por fila,
    // su id, su trimestre y el title de Editar
    const tableState = () => ui.js(`(() => {
      const rows = Array.from(document.querySelectorAll('tr[data-evaluation-id]'));
      return {
        headers: Array.from(document.querySelectorAll('.data-table thead th'), (th) => (th.querySelector('.column-filter-toggle') ?? th).textContent.trim()),
        results: document.querySelector('table-pagination .results-count').textContent.trim(),
        page: document.querySelector('table-pagination').page,
        rows: rows.map((row) => ({
          id: Number(row.dataset.evaluationId),
          term: row.cells[2].textContent.trim(),
          editTitle: row.querySelector('[data-action="edit"]').title,
        })),
      };
    })()`);
    const idsOf = (days) => days.map((day) => ids[day]);
    const waitResults = (results, message) => ui.waitFor(
      `document.querySelector('table-pagination .results-count').textContent.trim() === ${JSON.stringify(results)}`, { message });

    await loginViaUi(t, teacher);
    await t.fixtures.onDate(closedTermToday, async () => {
      const query = new URLSearchParams({ assignmentId: String(assignment.id) });
      t.require(await ui.navigate(`${EVALUATIONS_VIEW}?${query}`) === EVALUATIONS_VIEW, 'No se abrió Evaluaciones');
      await waitResults('Mostrando 1-10 de 15', 'Las 15 evaluaciones no aparecen en Evaluaciones');

      await t.step('Columna Trimestre', async () => {
        const state = await tableState();
        t.equal(state.headers, ['Título', 'Fecha', 'Trimestre', 'Acciones'], 'Trimestre va entre Fecha y Acciones');
        t.equal(state.rows.map(({ id }) => id), idsOf([...firstTermDays, ...secondTermDays.slice(0, 7)]), 'La página 1 sigue el orden por fecha');
        t.equal(state.rows.map(({ term }) => term), [...Array(3).fill('1° trimestre'), ...Array(7).fill('2° trimestre')], 'Cada fila nombra su trimestre');
        t.equal(state.rows[0].editTitle, CLOSED_FIRST_TERM_TITLE, 'El title de Editar nombra el trimestre cerrado');
        t.check(state.rows.slice(3).every(({ editTitle }) => editTitle !== CLOSED_FIRST_TERM_TITLE), 'Las del 2° trimestre no llevan el motivo del cierre', state.rows);
      });

      await t.step('Filtro Trimestre desde la página 2', async () => {
        await ui.click('.pagination .page-btn[data-page="2"]:not(.page-nav)');
        await waitResults('Mostrando 11-15 de 15', 'No se pasó a la página 2');
        await chooseColumnFilterOption(t, 'term', '2');
        await waitResults('Mostrando 1-10 de 12', 'El filtro Trimestre no dejó las 12 del 2° trimestre');
        const state = await tableState();
        t.equal(state.page, 1, 'Al filtrar vuelve a la página 1');
        t.equal(state.rows.map(({ id }) => id), idsOf(secondTermDays.slice(0, 10)), 'Solo las del 2° trimestre, por fecha');
        // También el 1°: las 15, otra vez en dos páginas
        await chooseColumnFilterOption(t, 'term', '1');
        await waitResults('Mostrando 1-10 de 15', 'Con los dos trimestres marcados no aparecen las 15');
      });

      await t.step('Combinado con Título', async () => {
        await clearColumnFilter(t, 'term');
        await chooseColumnFilterOption(t, 'term', '1');
        await waitResults('Mostrando 1-3 de 3', 'El filtro Trimestre no dejó las 3 del 1° trimestre');
        // Una del 2° trimestre con el filtro en el 1°: no cumple los dos
        await chooseColumnFilterOption(t, 'title', String(ids['06-05']));
        await waitResults('Mostrando 0 de 0', 'Una del 2° trimestre se ve con el filtro en el 1°');
        t.equal(await ui.text('.data-table tbody .table-message'), 'Ninguna evaluación coincide con los filtros.', 'La tabla avisa que ninguna cumple los dos filtros');
        await chooseColumnFilterOption(t, 'title', String(ids['03-15']));
        await waitResults('Mostrando 1-1 de 1', 'La del 1° trimestre elegida en Título no aparece');
        t.equal((await tableState()).rows.map(({ id }) => id), [ids['03-15']], 'Solo la elegida, que cumple los dos filtros');
        // Sin Trimestre queda solo Título, desde la página 1
        await clearColumnFilter(t, 'term');
        await chooseColumnFilterOption(t, 'title', String(ids['06-12']));
        await waitResults('Mostrando 1-1 de 1', 'Sin el filtro Trimestre, Título no muestra la del 2° trimestre');
        await clearColumnFilter(t, 'title');
        await waitResults('Mostrando 1-10 de 15', 'Sin filtros no vuelven las 15');
      });
    });
    await logoutViaUi(t);
  });
});
