// Capa ui: Reportes del Administrador (plans/reportes-administrador/). Reportes se abre desde el
// menú lateral y muestra los tres reportes; cada uno abre su vista, con su barra de filtros, y la
// ruta de navegación vuelve a Reportes (parte 00). Materias sin docente por curso muestra por
// defecto los cursos incompletos del ciclo actual; el interruptor, el filtro de año y la paginación
// (parte 01).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar, typeInColumnFilter, clearColumnFilter } = require('./helpers');

const REPORTS_VIEW = 'admin/reports/index.html';

// Cada reporte: su vista y los filtros de su barra (data-filter), en orden
const REPORTS = [
  { view: 'admin/subject-coverage-report/index.html', filters: ['year', 'level', 'shift'] },
  { view: 'admin/teacher-workload-report/index.html', filters: ['year', 'level', 'shift'] },
  { view: 'admin/backup-regularity-report/index.html', filters: ['year'] },
];

group('ui.reports', 'Reportes del Administrador', () => {
  test('navigation', 'Reportes se abre desde el menú lateral, muestra los tres reportes, cada uno abre su vista con su barra de filtros y la ruta de navegación vuelve a Reportes', async (t) => {
    const { ui } = t;
    const viewOf = (href) => href.slice(href.indexOf('/renderer/') + '/renderer/'.length);

    await loginViaUi(t, SEED_USERS.admin);
    await openFromSidebar(t, REPORTS_VIEW);
    const links = await ui.js(`Array.from(document.querySelectorAll('.report-list a.report-link'), (link) => link.href)`);
    t.equal(links.map(viewOf), REPORTS.map((report) => report.view), 'Reportes muestra las tres opciones');

    for (const report of REPORTS) {
      await t.step(report.view, async () => {
        await ui.click(`.report-list a.report-link[href$="${report.view.replace('admin/', '')}"]`);
        t.require(await ui.waitForView(report.view), `La opción no abrió ${report.view}`, ui.view());
        await ui.idle();
        t.equal(await ui.js(`Array.from(document.querySelectorAll('.report-filters > .column-filter'), (filter) => filter.dataset.filter)`),
          report.filters, 'Filtros de la barra');
        t.equal(await ui.js(`document.querySelector('.sidebar-nav a.nav-item[aria-current="page"]')?.href.endsWith('/${REPORTS_VIEW}') ?? false`),
          true, 'El menú lateral sigue marcando Reportes');
        await ui.click(`.breadcrumb a[href$="reports/index.html"]`);
        t.require(await ui.waitForView(REPORTS_VIEW), 'La ruta de navegación no volvió a Reportes', ui.view());
        await ui.idle();
      });
    }
    await logoutViaUi(t);
  });
});

// Reporte Materias sin docente por curso (parte 01). Los datos propios aseguran más de 10 cursos
// incompletos en el ciclo actual (dos páginas), uno completo y uno incompleto del ciclo anterior.
group('ui.reports.subject-coverage', 'Reportes: Materias sin docente por curso', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId();
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const completeCourse = await fixtures.createCourse({ level: 'PRIMARIA', grade: '1°', shift: 'MAÑANA' });
    for (const subject of await fixtures.subjectsOfGrade(completeCourse.gradeId)) {
      await fixtures.assign({ teacherId: teacher.id, courseId: completeCourse.id, subjectName: subject.name });
    }
    for (let index = 0; index < 11; index += 1) await fixtures.createCourse();
    const closedCourse = await fixtures.inSchoolYear(fixtures.year - 1, () => fixtures.createCourse());
    return { institutionId, completeCourse, closedCourse };
  },
}, () => {
  const VIEW = 'admin/subject-coverage-report/index.html';
  const ROWS = 'tr[data-course-id]';

  // Los cursos vigentes de la institución en el ciclo `year`; con `onlyIncomplete`, solo los que
  // tienen alguna materia del plan sin docente o con un profesor suspendido (consulta propia)
  const expectedIds = async (t, year, onlyIncomplete) => (await t.sql(`
    SELECT c.curso_id FROM curso c
     WHERE c.institucion_id = $1 AND c.fecha_eliminacion IS NULL AND c.anio_ciclo_lectivo = $2
       AND (NOT $3 OR EXISTS (
         SELECT 1 FROM grado_materia gm
          WHERE gm.grado_id = c.grado_id
            AND NOT EXISTS (SELECT 1 FROM asignacion_docente a JOIN usuario u USING (usuario_id)
                             WHERE a.curso_id = c.curso_id AND a.grado_materia_id = gm.grado_materia_id
                               AND a.fecha_eliminacion IS NULL AND u.fecha_eliminacion IS NULL AND u.estado)))
     ORDER BY c.curso_id`, [t.data.institutionId, year, onlyIncomplete])).map((row) => row.curso_id);

  // Lo que muestra la vista: el ciclo del botón, el interruptor, el total del pie, la página y los
  // ids de las filas
  const viewState = (t) => t.ui.js(`(() => ({
    year: document.querySelector('.report-filters [data-filter="year"] .report-filter-value').textContent.trim(),
    onlyIncomplete: document.getElementById('onlyIncompleteSwitch').checked,
    total: Number((document.querySelector('table-pagination .results-count').textContent.match(/(\\d+)\\s*$/) || [])[1]),
    page: document.querySelector('table-pagination').page,
    ids: Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}), (row) => Number(row.dataset.courseId)),
  }))()`);

  // Espera que la vista muestre el ciclo `year` con el total de `ids` y la primera página de ellos
  const expectRows = async (t, { year, ids, label }) => {
    const ok = await t.ui.waitFor(`(() => {
      const total = Number((document.querySelector('table-pagination .results-count').textContent.match(/(\\d+)\\s*$/) || [])[1]);
      const shown = Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}), (row) => Number(row.dataset.courseId));
      const expected = ${JSON.stringify(ids)};
      return total === expected.length && shown.length === Math.min(10, expected.length)
        && shown.every((id) => expected.includes(id))
        && document.querySelector('.report-filters [data-filter="year"] .report-filter-value').textContent.trim() === '${year}';
    })()`, { timeoutMs: 6000 });
    t.check(ok, `${label}: el ciclo ${year} con ${ids.length} cursos`, { expected: ids, state: await viewState(t) });
  };

  const openReport = async (t) => {
    await loginViaUi(t, SEED_USERS.admin);
    t.require(await t.ui.navigate(VIEW) === VIEW, 'No se abrió el reporte');
    await t.ui.idle();
  };

  test('default-school-year', 'Por defecto muestra los cursos incompletos del ciclo actual, con el interruptor activado', async (t) => {
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year, true), label: 'Ciclo actual' });
    const state = await viewState(t);
    t.equal(state.onlyIncomplete, true, 'El interruptor arranca activado');
    t.check(!state.ids.includes(t.data.completeCourse.id), 'El curso completo no aparece', state);
    t.equal(await t.ui.js(`document.querySelector('.report-filters [data-filter="year"] .column-filter-input').value`), '', 'El campo del año queda vacío');
    await logoutViaUi(t);
  });

  test('switch-off', 'Desactivar el interruptor muestra también los cursos completos', async (t) => {
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year, true), label: 'Con el interruptor activado' });
    await t.ui.click('#onlyIncompleteSwitch');
    const all = await expectedIds(t, t.year, false);
    await expectRows(t, { year: t.year, ids: all, label: 'Con el interruptor desactivado' });
    // El curso completo, en la página que le toque
    const found = await t.ui.waitFor(`(() => {
      if (document.querySelector('tr[data-course-id="${t.data.completeCourse.id}"]')) return true;
      document.querySelectorAll('table-pagination .page-nav')[1]?.click();
      return false;
    })()`, { timeoutMs: 6000 });
    t.check(found, 'El curso completo aparece con el interruptor desactivado', await viewState(t));
    await logoutViaUi(t);
  });

  test('year-filter', 'Un año en el filtro muestra los cursos de ese ciclo y "Limpiar filtro" vuelve al actual', async (t) => {
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year, true), label: 'Ciclo actual' });
    await typeInColumnFilter(t, 'year', '.column-filter-input', String(t.year - 1));
    const closedIds = await expectedIds(t, t.year - 1, true);
    t.check(closedIds.includes(t.data.closedCourse.id), 'La consulta propia incluye el curso del ciclo anterior', closedIds);
    await expectRows(t, { year: t.year - 1, ids: closedIds, label: 'Ciclo anterior' });
    await clearColumnFilter(t, 'year');
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year, true), label: 'Después de "Limpiar filtro"' });
    await logoutViaUi(t);
  });

  test('pagination', 'Con más de 10 cursos, la segunda página muestra los siguientes y un cambio de filtro vuelve a la página 1', async (t) => {
    await openReport(t);
    const ids = await expectedIds(t, t.year, true);
    t.require(ids.length > 10, 'El ciclo actual tiene que tener más de 10 cursos incompletos', ids);
    await expectRows(t, { year: t.year, ids, label: 'Página 1' });
    const firstPage = (await viewState(t)).ids;
    await t.ui.click('.pagination .page-btn[data-page="2"]:not(.page-nav)');
    const ok = await t.ui.waitFor(`document.querySelector('table-pagination').page === 2
      && document.querySelectorAll(${JSON.stringify(ROWS)}).length === ${Math.min(10, ids.length - 10)}`, { timeoutMs: 6000 });
    const secondPage = (await viewState(t)).ids;
    t.check(ok, 'La página 2 muestra los cursos que siguen', await viewState(t));
    t.check(secondPage.every((id) => ids.includes(id) && !firstPage.includes(id)), 'La página 2 no repite los de la página 1', { firstPage, secondPage });
    await t.ui.click('#onlyIncompleteSwitch');
    const back = await t.ui.waitFor(`document.querySelector('table-pagination').page === 1
      && document.querySelectorAll(${JSON.stringify(ROWS)}).length === 10`, { timeoutMs: 6000 });
    t.check(back, 'El cambio del interruptor vuelve a la página 1', await viewState(t));
    await logoutViaUi(t);
  });
});
