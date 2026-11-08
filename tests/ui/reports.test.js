// Capa ui: Reportes del Administrador (plans/reportes-administrador/). Reportes se abre desde el
// menú lateral y muestra los tres reportes; cada uno abre su vista, con su barra de filtros, y la
// ruta de navegación vuelve a Reportes (parte 00). Materias sin docente por curso muestra por
// defecto los cursos incompletos del ciclo actual; el interruptor, el filtro de año y la paginación
// (parte 01). Carga docente por profesor muestra una fila por profesor, de mayor a menor, con la
// línea del promedio, el tono de los suspendidos y el tooltip, y el filtro Nivel actualiza las
// barras (parte 02). Regularidad de los backups muestra 12 columnas con los backups de cada mes, los
// meses futuros atenuados y el último backup, que no cambia con el ciclo elegido (parte 03).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar, typeInColumnFilter, chooseColumnFilterOption, clearColumnFilter } = require('./helpers');

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

// Reporte Carga docente por profesor (parte 02). Los datos propios agregan un profesor con más
// asignaciones que cualquiera del seed (el primero de la lista) y uno suspendido con una.
group('ui.reports.teacher-workload', 'Reportes: Carga docente por profesor', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId();
    const busiestTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Ocupado' });
    const { rows: [{ max }] } = await fixtures.db.query(`
      SELECT COALESCE(MAX(n), 0)::INT AS max FROM (
        SELECT COUNT(*) AS n FROM asignacion_docente a JOIN curso c USING (curso_id)
         WHERE c.institucion_id = $1 AND c.anio_ciclo_lectivo = $2 AND a.fecha_eliminacion IS NULL AND c.fecha_eliminacion IS NULL
         GROUP BY a.usuario_id) counts`, [institutionId, fixtures.year]);
    // Cursos nuevos de secundaria, con todas las materias de su plan, hasta superar al de más
    // asignaciones
    let count = 0;
    while (count <= max) {
      const course = await fixtures.createCourse({ level: 'SECUNDARIA', grade: '4°', shift: 'TARDE' });
      for (const subject of await fixtures.subjectsOfGrade(course.gradeId)) {
        await fixtures.assign({ teacherId: busiestTeacher.id, courseId: course.id, subjectName: subject.name });
        count += 1;
      }
    }
    const suspendedTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Suspendido' });
    await fixtures.assign({ teacherId: suspendedTeacher.id, courseId: (await fixtures.createCourse({ level: 'PRIMARIA', grade: '1°', shift: 'MAÑANA' })).id });
    await fixtures.db.query(`UPDATE usuario SET estado = FALSE WHERE usuario_id = $1`, [suspendedTeacher.id]);
    return { institutionId, busiestTeacher, suspendedTeacher };
  },
}, () => {
  const VIEW = 'admin/teacher-workload-report/index.html';
  const ROWS = '[data-teacher-id]';
  const COLUMN_LEVEL = { PRIMARY: 'PRIMARIA', SECONDARY: 'SECUNDARIA' };

  // Los profesores no dados de baja de la institución, con sus asignaciones vigentes de cursos
  // vigentes del ciclo actual (de un nivel, si llega), en el orden del reporte (consulta propia)
  const expectedTeachers = (t, educationLevel = null) => t.sql(`
    SELECT u.usuario_id AS id,
           (SELECT COUNT(*) FROM asignacion_docente a JOIN curso c USING (curso_id) JOIN grado g USING (grado_id)
             WHERE a.usuario_id = u.usuario_id AND a.fecha_eliminacion IS NULL AND c.fecha_eliminacion IS NULL
               AND c.anio_ciclo_lectivo = $2 AND ($3::TEXT IS NULL OR g.nivel_educativo = $3))::INT AS count
      FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
     WHERE u.institucion_id = $1 AND r.nombre = 'PROFESOR' AND u.fecha_eliminacion IS NULL
     ORDER BY count DESC, u.apellido, u.nombre, u.usuario_id`, [t.data.institutionId, t.year, COLUMN_LEVEL[educationLevel] ?? null]);

  // Las filas que muestra la vista, en orden: { id, count }
  const shownRows = (t) => t.ui.js(`Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}), (row) => ({
    id: Number(row.dataset.teacherId), count: Number(row.querySelector('.workload-count').textContent),
  }))`);

  // Espera que la vista muestre exactamente `expected`, en orden
  const expectRows = async (t, expected, label) => {
    const ok = await t.ui.waitFor(`JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}), (row) => ({
      id: Number(row.dataset.teacherId), count: Number(row.querySelector('.workload-count').textContent),
    }))) === ${JSON.stringify(JSON.stringify(expected))}`, { timeoutMs: 6000 });
    t.check(ok, `${label}: una fila por profesor, en el orden de la consulta propia`, { expected, shown: await shownRows(t) });
  };

  const openReport = async (t) => {
    await loginViaUi(t, SEED_USERS.admin);
    t.require(await t.ui.navigate(VIEW) === VIEW, 'No se abrió el reporte');
    await t.ui.idle();
  };

  test('rows', 'Una fila por profesor, de mayor a menor, con la línea del promedio, el tono de los suspendidos y los conteos en el tooltip', async (t) => {
    const { busiestTeacher, suspendedTeacher } = t.data;
    await openReport(t);
    const expected = (await expectedTeachers(t)).map(({ id, count }) => ({ id, count }));
    await expectRows(t, expected, 'Ciclo actual');
    t.equal((await shownRows(t))[0]?.id, busiestTeacher.id, 'La primera fila es la del profesor con más asignaciones');

    const average = expected.reduce((sum, row) => sum + row.count, 0) / expected.length;
    const averageText = `Promedio: ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(average)}`;
    const line = await t.ui.js(`(() => {
      const line = document.querySelector('.workload-average-line');
      const label = document.querySelector('.workload-average-label');
      return { visible: Boolean(line && line.getBoundingClientRect().height > 0), label: label?.textContent.trim() };
    })()`);
    t.equal(line, { visible: true, label: averageText }, 'La línea del promedio se ve, con su etiqueta');

    const suspended = await t.ui.js(`(() => {
      const row = document.querySelector('[data-teacher-id="${suspendedTeacher.id}"]');
      return row && { suspended: row.classList.contains('is-suspended'), title: row.title };
    })()`);
    t.equal(suspended, { suspended: true, title: '1 asignación en 1 curso · Suspendido' }, 'El suspendido lleva is-suspended y su tooltip');
    const busiest = await t.ui.js(`(() => {
      const row = document.querySelector('[data-teacher-id="${busiestTeacher.id}"]');
      return row && { suspended: row.classList.contains('is-suspended'), title: row.title };
    })()`);
    const busiestCount = expected[0].count;
    const busiestCourses = (await t.sqlOne(`SELECT COUNT(DISTINCT curso_id)::INT AS n FROM asignacion_docente WHERE usuario_id = $1 AND fecha_eliminacion IS NULL`, [busiestTeacher.id])).n;
    t.equal(busiest, { suspended: false, title: `${busiestCount} asignaciones en ${busiestCourses} ${busiestCourses === 1 ? 'curso' : 'cursos'}` },
      'Un activo, sin is-suspended y con sus conteos en el tooltip');
    await logoutViaUi(t);
  });

  test('level-filter', 'Un cambio de Nivel actualiza las barras', async (t) => {
    await openReport(t);
    await expectRows(t, (await expectedTeachers(t)).map(({ id, count }) => ({ id, count })), 'Todos los niveles');
    await chooseColumnFilterOption(t, 'level', 'PRIMARY');
    await expectRows(t, (await expectedTeachers(t, 'PRIMARY')).map(({ id, count }) => ({ id, count })), 'Primaria');
    t.equal(await t.ui.js(`document.querySelector('.report-filters [data-filter="level"] .report-filter-value').textContent.trim()`),
      'Primaria', 'El botón muestra el nivel elegido');
    // La barra del profesor ocupado (todas sus asignaciones son de secundaria) queda vacía
    t.equal(await t.ui.js(`document.querySelector('[data-teacher-id="${t.data.busiestTeacher.id}"] .workload-bar').getBoundingClientRect().width`),
      0, 'Sin asignaciones de primaria, la barra del profesor ocupado queda vacía');
    await logoutViaUi(t);
  });
});

// Reporte Regularidad de los backups (parte 03). Los datos propios: dos backups del ciclo actual
// (hace 3 y hace 40 días, con la fecha de la base) y tres del anterior, dos de ellos en marzo.
group('ui.reports.backup-regularity', 'Reportes: Regularidad de los backups', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId();
    await fixtures.db.query(`
      INSERT INTO respaldo (institucion_id, usuario_id, usuario_nombre, usuario_apellido, fecha)
      SELECT $1, 0, 'Suite', 'Backup', (day + TIME '12:00')::TIMESTAMPTZ
        FROM unnest(ARRAY[fn_fecha_actual() - 3, fn_fecha_actual() - 40,
                          make_date($2 - 1, 3, 15), make_date($2 - 1, 3, 20), make_date($2 - 1, 8, 1)]) AS day`,
    [institutionId, fixtures.year]);
    return { institutionId };
  },
}, () => {
  const VIEW = 'admin/backup-regularity-report/index.html';
  const COLUMNS = '.chart-col[data-month]';

  // Los backups de la institución en cada mes del año `year`, por rangos de fechas (consulta propia)
  const expectedCounts = async (t, year) => (await t.sql(`
    SELECT (SELECT COUNT(*) FROM respaldo r
             WHERE r.institucion_id = $1 AND r.fecha >= make_date($2, m, 1)
               AND r.fecha < make_date($2, m, 1) + INTERVAL '1 month')::INT AS count
      FROM generate_series(1, 12) AS m ORDER BY m`, [t.data.institutionId, year])).map((row) => row.count);

  // Lo que muestra la vista: el ciclo del botón, el indicador y, por columna, el mes, la cantidad,
  // si es futura y su tooltip
  const viewState = (t) => t.ui.js(`(() => ({
    year: document.querySelector('.report-filters [data-filter="year"] .report-filter-value').textContent.trim(),
    summary: document.querySelector('.last-backup-summary').textContent.trim(),
    date: document.querySelector('.last-backup-date').hidden ? null : document.querySelector('.last-backup-date').textContent.trim(),
    columns: Array.from(document.querySelectorAll(${JSON.stringify(COLUMNS)}), (column) => ({
      month: Number(column.dataset.month),
      count: Number(column.querySelector('.backup-value').textContent),
      future: column.classList.contains('is-future'),
      title: column.title,
    })),
  }))()`);

  // Espera que la vista muestre el ciclo `year` con las cantidades `counts`
  const expectColumns = async (t, { year, counts, label }) => {
    const ok = await t.ui.waitFor(`(() => {
      const shown = Array.from(document.querySelectorAll(${JSON.stringify(COLUMNS)}), (column) => Number(column.querySelector('.backup-value').textContent));
      return JSON.stringify(shown) === ${JSON.stringify(JSON.stringify(counts))}
        && document.querySelector('.report-filters [data-filter="year"] .report-filter-value').textContent.trim() === '${year}';
    })()`, { timeoutMs: 6000 });
    t.check(ok, `${label}: el ciclo ${year} con los backups de cada mes`, { expected: counts, state: await viewState(t) });
  };

  const openReport = async (t) => {
    await loginViaUi(t, SEED_USERS.admin);
    t.require(await t.ui.navigate(VIEW) === VIEW, 'No se abrió el reporte');
    await t.ui.idle();
  };

  test('columns', '12 columnas con los backups de cada mes del ciclo actual, los meses futuros atenuados y el indicador del último backup', async (t) => {
    await openReport(t);
    await expectColumns(t, { year: t.year, counts: await expectedCounts(t, t.year), label: 'Ciclo actual' });
    const state = await viewState(t);
    t.equal(state.columns.map((column) => column.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'Una columna por mes, en orden');
    const currentMonth = Number(t.today.slice(5, 7));
    t.equal(state.columns.filter((column) => column.future).map((column) => column.month),
      state.columns.map((column) => column.month).filter((month) => month > currentMonth), 'Los meses posteriores al de hoy van atenuados');
    t.check(state.columns.every((column) => (column.future ? column.title === 'Mes futuro' : column.title.endsWith(`${t.year}: ${column.count} ${column.count === 1 ? 'backup' : 'backups'}`))),
      'El tooltip de cada columna', state.columns);

    const { days } = await t.sqlOne(`SELECT fn_fecha_actual() - MAX(fecha)::DATE AS days FROM respaldo WHERE institucion_id = $1`, [t.data.institutionId]);
    t.equal(state.summary, `Último backup: hace ${days} ${days === 1 ? 'día' : 'días'}`, 'El indicador cuenta los días desde el último backup');
    t.check(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(state.date ?? ''), 'La fecha completa, DD/MM/AAAA hh:mm, como texto secundario', state.date);
    await logoutViaUi(t);
  });

  test('year-filter', 'Un cambio de año cambia las columnas pero no el indicador, y "Limpiar filtro" vuelve al ciclo actual', async (t) => {
    await openReport(t);
    await expectColumns(t, { year: t.year, counts: await expectedCounts(t, t.year), label: 'Ciclo actual' });
    const before = await viewState(t);

    await typeInColumnFilter(t, 'year', '.column-filter-input', String(t.year - 1));
    const previousCounts = await expectedCounts(t, t.year - 1);
    t.equal(previousCounts[2], 2, 'La consulta propia cuenta los dos backups de marzo del ciclo anterior');
    await expectColumns(t, { year: t.year - 1, counts: previousCounts, label: 'Ciclo anterior' });
    const after = await viewState(t);
    t.equal({ summary: after.summary, date: after.date }, { summary: before.summary, date: before.date }, 'El indicador no cambia con el ciclo');
    t.equal(after.columns.filter((column) => column.future).length, 0, 'En un ciclo pasado no hay meses futuros');
    t.equal(after.columns[2].title, `Marzo ${t.year - 1}: 2 backups`, 'El tooltip de marzo');

    await clearColumnFilter(t, 'year');
    await expectColumns(t, { year: t.year, counts: await expectedCounts(t, t.year), label: 'Después de "Limpiar filtro"' });
    await logoutViaUi(t);
  });
});
