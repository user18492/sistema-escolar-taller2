// Capa ui: Reportes del Administrador (plans/reportes-administrador/). Reportes se abre desde el
// menú lateral y muestra los tres reportes; cada uno abre su vista, con su barra de filtros, y la
// ruta de navegación vuelve a Reportes (parte 00).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar } = require('./helpers');

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
