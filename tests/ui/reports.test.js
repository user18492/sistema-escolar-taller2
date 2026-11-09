// Capa ui: Reportes del Administrador (plans/reportes-administrador/). Reportes se abre desde el
// menú lateral y muestra los tres reportes; cada uno abre su vista, con su barra de filtros, y la
// ruta de navegación vuelve a Reportes (parte 00). Materias sin docente por curso muestra solo los
// cursos incompletos, del ciclo actual por defecto; el filtro de año, el mensaje sin resultados y la
// paginación (parte 01), y las celdas de materias ("—", la materia o la cantidad con el modal de la
// lista completa). Carga docente por profesor muestra una tabla paginada, de mayor a menor, con el
// estado en texto, el modal de las asignaciones de cada profesor y el resumen del promedio arriba,
// igual en todas las páginas, y el filtro Nivel actualiza las filas y el resumen (parte 02 y pedido
// del 2026-11-09). Regularidad de los backups muestra 12 columnas con los backups de cada mes, los
// meses futuros atenuados y el último backup, que no cambia con el ciclo elegido (parte 03). En un
// ciclo sin datos (sin cursos, o sin backups), cada reporte muestra solo el mensaje "No existen
// registros…" (pedido del 2026-11-09, pruebas no-data).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar, typeInColumnFilter, chooseColumnFilterOption, clearColumnFilter } = require('./helpers');

const REPORTS_VIEW = 'admin/reports/index.html';

// ---------- Diseño estable mientras carga (pedido del 2026-11-09) ----------
// Un cambio de filtro o de página no tiene que pasar por un estado intermedio: la tabla (o el
// gráfico), sus encabezados y lo que la rodea quedan donde estaban hasta que llegan los datos, y
// entonces cambian de una vez. recordLayout registra, desde antes de `action` hasta que la vista
// queda quieta, cada estado distinto de la página: en cada mutación del contenido (antes de que
// vuelva la respuesta del proceso principal, por rápida que sea), en cada desplazamiento y en cada
// cuadro. Cada estado es el desplazamiento del área principal, la caja en la ventana (izquierda,
// arriba, ancho y alto) de los elementos de `boxes` y el texto de los de `texts` (vacío si están
// ocultos).
async function recordLayout(t, { boxes, texts }, action) {
  await t.ui.js(`(() => {
    const main = document.querySelector('.main');
    const boxes = ${JSON.stringify(boxes)};
    const texts = ${JSON.stringify(texts)};
    const box = (el) => {
      if (!el.getClientRects().length) return '-';
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    };
    const text = (el) => (el.closest('[hidden]') ? '' : el.textContent.replace(/\\s+/g, ' ').trim());
    const snapshot = () => JSON.stringify({
      scrollTop: Math.round(main.scrollTop),
      maxScroll: main.scrollHeight - main.clientHeight,
      boxes: Object.fromEntries(Object.entries(boxes).map(([name, selector]) => [name, Array.from(document.querySelectorAll(selector), box).join(' ')])),
      texts: Object.fromEntries(Object.entries(texts).map(([name, selector]) => [name, Array.from(document.querySelectorAll(selector), text).join(' | ')])),
    });
    const samples = [snapshot()];
    const push = () => {
      const sample = snapshot();
      if (sample !== samples.at(-1)) samples.push(sample);
    };
    const observer = new MutationObserver(push);
    observer.observe(document.querySelector('.main > .content'), { subtree: true, childList: true, attributes: true, characterData: true });
    main.addEventListener('scroll', push);
    let frame = requestAnimationFrame(function tick() {
      push();
      frame = requestAnimationFrame(tick);
    });
    window.__layoutRecording = {
      stop() {
        push();
        observer.disconnect();
        main.removeEventListener('scroll', push);
        cancelAnimationFrame(frame);
        return samples.map((sample) => JSON.parse(sample));
      },
    };
    return true;
  })()`);
  await action();
  await t.ui.idle({ quietMs: 400 });
  return t.ui.js('window.__layoutRecording.stop()');
}

// La página pasa del estado de antes al de después sin ninguno en el medio. `fixed`: las cajas que
// tampoco cambian entre el antes y el después (lo que está arriba de la tabla y sus encabezados).
// La página no se desplaza, salvo que el resultado la acorte por debajo de donde estaba: entonces
// queda en su nuevo final, y todo sube con ella.
function checkNoIntermediateState(t, samples, { label, fixed = [] }) {
  const before = samples[0];
  const after = samples.at(-1);
  const intermediate = samples.filter((sample) => ![before, after].some((end) => JSON.stringify(end) === JSON.stringify(sample)));
  t.check(!intermediate.length, `${label}: la página pasa al resultado sin un estado intermedio`, { before, intermediate, after });
  const expectedScroll = Math.min(before.scrollTop, Math.max(0, after.maxScroll));
  t.check(Math.abs(after.scrollTop - expectedScroll) <= 1, `${label}: la página no se desplaza`, { before: before.scrollTop, after: after.scrollTop, maxScroll: after.maxScroll });
  if (after.scrollTop !== before.scrollTop) return;
  for (const name of fixed) {
    t.equal(after.boxes[name], before.boxes[name], `${label}: ${name} queda en su lugar`);
  }
}

// Pasos de los filtros de la barra sin mover la página (los de helpers.js centran cada control):
// el usuario la desplazó un poco y cambia un filtro que sigue a la vista.
const barFilter = (filter) => `.report-filters .column-filter[data-filter="${filter}"]`;
async function openBarFilter(t, filter) {
  await t.ui.click(`${barFilter(filter)} .column-filter-toggle`, { scroll: false });
  await t.ui.waitFor(`document.querySelector('${barFilter(filter)} .column-filter-panel').matches(':popover-open')`, { message: `No se abrió el filtro ${filter}` });
}
async function chooseInBar(t, filter, value) {
  await openBarFilter(t, filter);
  await t.ui.chooseOption(`${barFilter(filter)} .dropdown-option[data-value="${value}"]`);
  if (await t.ui.js(`document.querySelector('${barFilter(filter)} .column-filter-panel').matches(':popover-open')`)) await t.ui.press('Escape');
}
// Un año en dos partes: startYearInBar escribe sobre el anterior todos los dígitos menos el último
// (un año incompleto no filtra: si había otro, la vista vuelve al ciclo actual, un cambio de filtro
// en sí mismo) y finishYearInBar escribe el último y cierra el panel.
async function startYearInBar(t, year) {
  await openBarFilter(t, 'year');
  await t.ui.click(`${barFilter('year')} .column-filter-input`, { scroll: false });
  await t.ui.press('a', { modifiers: ['control'] });
  await t.ui.type(String(year).slice(0, -1));
}
async function finishYearInBar(t, year) {
  await t.ui.type(String(year).slice(-1));
  await t.ui.press('Escape');
}
async function clearInBar(t, filter) {
  await openBarFilter(t, filter);
  await t.ui.click(`${barFilter(filter)} .column-filter-clear`, { scroll: false });
}
// Desplaza el área principal `top` píxeles (o hasta el final, con 'end'), sin pasar del máximo
const scrollMainTo = (t, top) => t.ui.js(`(() => {
  const main = document.querySelector('.main');
  main.scrollTop = ${top === 'end' ? 'main.scrollHeight' : top};
  return main.scrollTop;
})()`);

// ---------- Ciclo lectivo sin datos (pedido del 2026-11-09) ----------
// En un ciclo sin datos (sin cursos, o sin backups en Regularidad de los backups), el área de datos
// muestra solo NO_DATA_MESSAGE. noDataState devuelve, para cada nombre de `selectors`, si se ve
// (algún elemento con caja) y el texto del mensaje (null si no se ve).
const NO_DATA_MESSAGE = 'No existen registros pertenecientes al ciclo lectivo seleccionado.';
const noDataState = (t, { message, ...selectors }) => t.ui.js(`(() => {
  const isShown = (selector) => Array.from(document.querySelectorAll(selector)).some((el) => el.getClientRects().length > 0);
  const messageEl = document.querySelector(${JSON.stringify(message)});
  const selectors = ${JSON.stringify(selectors)};
  return {
    message: messageEl && messageEl.getClientRects().length ? messageEl.textContent.trim() : null,
    ...Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, isShown(selector)])),
  };
})()`);
// Espera que la vista muestre (o deje de mostrar, con `shown` false) el mensaje de ciclo sin datos
// para el ciclo `year` del botón del filtro
const waitNoData = (t, { message, year, shown }) => t.ui.waitFor(`(() => {
  const el = document.querySelector(${JSON.stringify(message)});
  const isShown = Boolean(el && el.getClientRects().length && el.textContent.trim() === ${JSON.stringify(NO_DATA_MESSAGE)});
  return isShown === ${shown}
    && document.querySelector('.report-filters [data-filter="year"] .report-filter-value').textContent.trim() === '${year}';
})()`, { timeoutMs: 6000 });

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
// incompletos en el ciclo actual (dos páginas), uno completo y uno incompleto del ciclo anterior,
// y, dos ciclos atrás, un curso de primaria a la mañana con todas sus materias asignadas (sin
// cursos incompletos con esos filtros).
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
    const olderCompleteCourse = await fixtures.inSchoolYear(fixtures.year - 2, async () => {
      const course = await fixtures.createCourse({ level: 'PRIMARIA', grade: '1°', shift: 'MAÑANA' });
      for (const subject of await fixtures.subjectsOfGrade(course.gradeId)) {
        await fixtures.assign({ teacherId: teacher.id, courseId: course.id, subjectName: subject.name });
      }
      return course;
    });
    // Tres ciclos atrás, un curso por cada forma de celda de "Sin docente" y "Con docente
    // suspendido" (ninguna materia, una, varias), con un profesor que se suspende después de asignarlo
    const suspendedTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Suspendido' });
    const subjectCells = await fixtures.inSchoolYear(fixtures.year - 3, async () => {
      // Todas asignadas, una al suspendido: Sin docente "—", Con docente suspendido una
      const oneSuspended = await fixtures.createCourse();
      const oneSuspendedSubjects = await fixtures.subjectsOfGrade(oneSuspended.gradeId);
      for (const [index, subject] of oneSuspendedSubjects.entries()) {
        await fixtures.assign({ teacherId: index === 0 ? suspendedTeacher.id : teacher.id, courseId: oneSuspended.id, subjectName: subject.name });
      }
      // Todas menos una, dos al suspendido: Sin docente una, Con docente suspendido varias
      const oneUnassigned = await fixtures.createCourse();
      const oneUnassignedSubjects = await fixtures.subjectsOfGrade(oneUnassigned.gradeId);
      for (const [index, subject] of oneUnassignedSubjects.slice(1).entries()) {
        await fixtures.assign({ teacherId: index < 2 ? suspendedTeacher.id : teacher.id, courseId: oneUnassigned.id, subjectName: subject.name });
      }
      // Ninguna asignada: Sin docente varias, Con docente suspendido "—"
      const noneAssigned = await fixtures.createCourse();
      return {
        oneSuspended: { id: oneSuspended.id, suspended: [oneSuspendedSubjects[0].name] },
        oneUnassigned: { id: oneUnassigned.id, unassigned: [oneUnassignedSubjects[0].name], suspended: oneUnassignedSubjects.slice(1, 3).map((subject) => subject.name) },
        noneAssigned: { id: noneAssigned.id, unassigned: (await fixtures.subjectsOfGrade(noneAssigned.gradeId)).map((subject) => subject.name) },
      };
    });
    await fixtures.db.query('UPDATE usuario SET estado = false WHERE usuario_id = $1', [suspendedTeacher.id]);
    const suspendedTeacherName = `${suspendedTeacher.firstName} ${suspendedTeacher.lastName}`;
    return { institutionId, completeCourse, closedCourse, olderCompleteCourse, subjectCells, suspendedTeacherName };
  },
}, () => {
  const VIEW = 'admin/subject-coverage-report/index.html';
  const ROWS = 'tr[data-course-id]';

  // Los cursos incompletos de la institución en el ciclo `year`: los vigentes con alguna materia
  // del plan sin docente o con un profesor suspendido (consulta propia). `level` y `shift`, con los
  // valores de la base (PRIMARIA, MAÑANA...), filtran el nivel y el turno; sin ellos, todos.
  const expectedIds = async (t, year, { level = null, shift = null } = {}) => (await t.sql(`
    SELECT c.curso_id FROM curso c JOIN grado g USING (grado_id)
     WHERE c.institucion_id = $1 AND c.fecha_eliminacion IS NULL AND c.anio_ciclo_lectivo = $2
       AND ($3::VARCHAR IS NULL OR g.nivel_educativo = $3) AND ($4::VARCHAR IS NULL OR c.turno = $4)
       AND EXISTS (
         SELECT 1 FROM grado_materia gm
          WHERE gm.grado_id = c.grado_id
            AND NOT EXISTS (SELECT 1 FROM asignacion_docente a JOIN usuario u USING (usuario_id)
                             WHERE a.curso_id = c.curso_id AND a.grado_materia_id = gm.grado_materia_id
                               AND a.fecha_eliminacion IS NULL AND u.fecha_eliminacion IS NULL AND u.estado))
     ORDER BY c.curso_id`, [t.data.institutionId, year, level, shift])).map((row) => row.curso_id);

  // Lo que muestra la vista: el ciclo del botón, el total del pie, la página, los ids de las filas
  // y el mensaje de la tabla, si hay
  const viewState = (t) => t.ui.js(`(() => ({
    year: document.querySelector('.report-filters [data-filter="year"] .report-filter-value').textContent.trim(),
    total: Number((document.querySelector('table-pagination .results-count').textContent.match(/(\\d+)\\s*$/) || [])[1]),
    page: document.querySelector('table-pagination').page,
    ids: Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}), (row) => Number(row.dataset.courseId)),
    message: document.querySelector('.coverage-card .table-message')?.textContent.trim() ?? null,
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

  test('default-school-year', 'Por defecto muestra solo los cursos incompletos del ciclo actual, sin interruptor', {
    history: [{ plan: 'Pedido del 2026-11-09: sin el interruptor "Solo cursos incompletos" (sin plan en plans/)', date: '2026-11-09', change: 'Sin el interruptor: la barra no lo tiene y la tabla muestra solo los incompletos' }],
  }, async (t) => {
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Ciclo actual' });
    const state = await viewState(t);
    t.check(!state.ids.includes(t.data.completeCourse.id), 'El curso completo no aparece', state);
    t.equal(await t.ui.js(`document.querySelectorAll('.report-filters input[type="checkbox"]').length`), 0, 'La barra no tiene un interruptor');
    t.equal(await t.ui.js(`document.querySelector('.report-filters [data-filter="year"] .column-filter-input').value`), '', 'El campo del año queda vacío');
    await logoutViaUi(t);
  });

  test('no-results', 'Sin cursos incompletos con los filtros elegidos, la tabla lo dice', async (t) => {
    const year = t.year - 2;
    t.require((await expectedIds(t, year, { level: 'PRIMARIA', shift: 'MAÑANA' })).length === 0,
      `El ciclo ${year} no tiene que tener cursos incompletos de primaria a la mañana`);
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Ciclo actual' });
    await typeInColumnFilter(t, 'year', '.column-filter-input', String(year));
    await chooseColumnFilterOption(t, 'level', 'PRIMARY');
    await chooseColumnFilterOption(t, 'shift', 'MORNING');
    await expectRows(t, { year, ids: [], label: 'Primaria a la mañana' });
    const state = await viewState(t);
    t.equal(state.message, 'Todos los cursos tienen docente asignado en todas sus materias.', 'El mensaje sin resultados', state);
    t.check(!state.ids.includes(t.data.olderCompleteCourse.id), 'El curso completo de ese ciclo no aparece', state);
    await logoutViaUi(t);
  });

  test('no-data', 'Un ciclo sin cursos muestra solo "No existen registros…", sin la tabla ni la paginación, también con Nivel y Turno; un ciclo con cursos y ninguno incompleto sigue mostrando la tabla, y "Limpiar filtro" vuelve al actual', {
    history: [{ plan: 'Pedido del 2026-11-09: mensaje de ciclo lectivo sin datos en los reportes (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' }],
  }, async (t) => {
    const emptyYear = t.year - 20;
    t.require((await t.sql(`SELECT 1 FROM curso WHERE institucion_id = $1 AND anio_ciclo_lectivo = $2`, [t.data.institutionId, emptyYear])).length === 0,
      `El ciclo ${emptyYear} no tiene que tener cursos`);
    const PARTS = { message: '.coverage-card .report-message', table: '.coverage-card .data-table', pagination: '.coverage-card .pagination' };
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Ciclo actual' });
    t.equal(await noDataState(t, PARTS), { message: null, table: true, pagination: true }, 'Ciclo actual: la tabla y la paginación, sin el mensaje');

    await typeInColumnFilter(t, 'year', '.column-filter-input', String(emptyYear));
    t.check(await waitNoData(t, { message: PARTS.message, year: emptyYear, shown: true }), `Ciclo ${emptyYear}: aparece el mensaje`, await noDataState(t, PARTS));
    t.equal(await noDataState(t, PARTS), { message: NO_DATA_MESSAGE, table: false, pagination: false }, `Ciclo ${emptyYear}: solo el mensaje`);
    await chooseColumnFilterOption(t, 'level', 'PRIMARY');
    await t.ui.idle({ quietMs: 400 });
    t.equal(await noDataState(t, PARTS), { message: NO_DATA_MESSAGE, table: false, pagination: false }, 'Con Nivel Primaria, también');

    // Dos ciclos atrás, primaria: un solo curso, completo. El ciclo tiene datos, sin filas.
    await typeInColumnFilter(t, 'year', '.column-filter-input', String(t.year - 2));
    t.check(await waitNoData(t, { message: PARTS.message, year: t.year - 2, shown: false }), `Ciclo ${t.year - 2}: el mensaje desaparece`, await noDataState(t, PARTS));
    t.equal(await noDataState(t, PARTS), { message: null, table: true, pagination: true }, `Ciclo ${t.year - 2}: la tabla vuelve`);
    t.equal((await viewState(t)).message, 'Todos los cursos tienen docente asignado en todas sus materias.', 'con el mensaje sin resultados de la tabla');

    await clearColumnFilter(t, 'level');
    await clearColumnFilter(t, 'year');
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Después de "Limpiar filtro"' });
    t.equal(await noDataState(t, PARTS), { message: null, table: true, pagination: true }, 'Ciclo actual otra vez: la tabla y la paginación');
    await logoutViaUi(t);
  });

  test('year-filter', 'Un año en el filtro muestra los cursos incompletos de ese ciclo y "Limpiar filtro" vuelve al actual', {
    history: [{ plan: 'Pedido del 2026-11-09: sin el interruptor "Solo cursos incompletos" (sin plan en plans/)', date: '2026-11-09', change: 'La consulta propia ya no recibe onlyIncomplete: siempre los incompletos' }],
  }, async (t) => {
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Ciclo actual' });
    await typeInColumnFilter(t, 'year', '.column-filter-input', String(t.year - 1));
    const closedIds = await expectedIds(t, t.year - 1);
    t.check(closedIds.includes(t.data.closedCourse.id), 'La consulta propia incluye el curso del ciclo anterior', closedIds);
    await expectRows(t, { year: t.year - 1, ids: closedIds, label: 'Ciclo anterior' });
    await clearColumnFilter(t, 'year');
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Después de "Limpiar filtro"' });
    await logoutViaUi(t);
  });

  test('pagination', 'Con más de 10 cursos, la segunda página muestra los siguientes y un cambio de filtro vuelve a la página 1', {
    history: [{ plan: 'Pedido del 2026-11-09: sin el interruptor "Solo cursos incompletos" (sin plan en plans/)', date: '2026-11-09', change: 'El cambio que vuelve a la página 1 es el de Nivel (Secundaria), no el del interruptor' }],
  }, async (t) => {
    await openReport(t);
    const ids = await expectedIds(t, t.year);
    t.require(ids.length > 10, 'El ciclo actual tiene que tener más de 10 cursos incompletos', ids);
    await expectRows(t, { year: t.year, ids, label: 'Página 1' });
    const firstPage = (await viewState(t)).ids;
    await t.ui.click('.pagination .page-btn[data-page="2"]:not(.page-nav)');
    const ok = await t.ui.waitFor(`document.querySelector('table-pagination').page === 2
      && document.querySelectorAll(${JSON.stringify(ROWS)}).length === ${Math.min(10, ids.length - 10)}`, { timeoutMs: 6000 });
    const secondPage = (await viewState(t)).ids;
    t.check(ok, 'La página 2 muestra los cursos que siguen', await viewState(t));
    t.check(secondPage.every((id) => ids.includes(id) && !firstPage.includes(id)), 'La página 2 no repite los de la página 1', { firstPage, secondPage });
    // Los 11 cursos propios son de secundaria: con Nivel Secundaria sigue habiendo más de una página
    await chooseColumnFilterOption(t, 'level', 'SECONDARY');
    const back = await t.ui.waitFor(`document.querySelector('table-pagination').page === 1
      && document.querySelector('.report-filters [data-filter="level"] .report-filter-value').textContent.trim() === 'Secundaria'
      && document.querySelectorAll(${JSON.stringify(ROWS)}).length === 10`, { timeoutMs: 6000 });
    t.check(back, 'El cambio de Nivel vuelve a la página 1', await viewState(t));
    await logoutViaUi(t);
  });

  test('subject-cells', 'Sin docente y Con docente suspendido muestran "—", la materia o la cantidad con un botón que abre la lista completa en un modal, que se cierra con la X y con Escape', {
    history: [{ plan: 'Pedido del 2026-11-09: celdas de materias según la cantidad, con modal para dos o más (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' }],
  }, async (t) => {
    const { subjectCells: cells, suspendedTeacherName: teacher } = t.data;
    const OVERLAY = '#subjectListOverlay';
    const COLUMNS = { unassigned: '.unassigned-subjects', suspended: '.suspended-subjects' };
    const withTeacher = (names) => names.map((name) => `${name} (${teacher})`);
    const sorted = (list) => [...list].sort();

    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Ciclo actual' });
    await typeInColumnFilter(t, 'year', '.column-filter-input', String(t.year - 3));
    await expectRows(t, { year: t.year - 3, ids: await expectedIds(t, t.year - 3), label: 'Tres ciclos atrás' });

    // Lo que muestra una celda: su texto y, si tiene, la etiqueta del botón
    const cellState = (id, column) => t.ui.js(`(() => {
      const cell = document.querySelector('tr[data-course-id="${id}"] ${COLUMNS[column]}');
      return { text: cell.textContent.replace(/\\s+/g, ' ').trim(), button: cell.querySelector('.list-summary-button')?.getAttribute('aria-label') ?? null };
    })()`);
    const modalState = () => t.ui.js(`(() => ({
      label: document.querySelector('${OVERLAY} .modal').getAttribute('aria-label'),
      items: Array.from(document.querySelectorAll('#subjectList li'), (item) => item.textContent),
      focus: document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || null,
    }))()`);

    // Ninguna materia y una sola: texto, sin botón
    t.equal(await cellState(cells.oneSuspended.id, 'unassigned'), { text: '—', button: null }, 'Sin docente sin materias');
    t.equal(await cellState(cells.noneAssigned.id, 'suspended'), { text: '—', button: null }, 'Con docente suspendido sin materias');
    t.equal(await cellState(cells.oneUnassigned.id, 'unassigned'), { text: cells.oneUnassigned.unassigned[0], button: null }, 'Sin docente con una materia');
    t.equal(await cellState(cells.oneSuspended.id, 'suspended'), { text: withTeacher(cells.oneSuspended.suspended)[0], button: null }, 'Con docente suspendido con una materia, con el docente');

    // Varias: la cantidad y el botón; el modal lista todas, se cierra con la X (clic) y con Escape,
    // y el foco vuelve al botón
    const many = [
      { id: cells.noneAssigned.id, column: 'unassigned', description: 'sin docente', items: cells.noneAssigned.unassigned, close: 'x' },
      { id: cells.oneUnassigned.id, column: 'suspended', description: 'con docente suspendido', items: withTeacher(cells.oneUnassigned.suspended), close: 'Escape' },
    ];
    for (const cell of many) {
      await t.step(`${cell.column} con ${cell.items.length}`, async () => {
        const state = await cellState(cell.id, cell.column);
        const buttonLabel = `Ver las ${cell.items.length} materias ${cell.description} de `;
        t.equal(state.text, `${cell.items.length} materias`, 'La cantidad');
        t.check(state.button?.startsWith(buttonLabel), 'El botón dice qué abre', state);
        await t.ui.click(`tr[data-course-id="${cell.id}"] ${COLUMNS[cell.column]} .list-summary-button`);
        t.require(await t.ui.waitModal(OVERLAY, true), 'El modal no se abrió');
        const open = await modalState();
        t.equal(sorted(open.items), sorted(cell.items), 'El modal lista todas las materias', open);
        t.check(open.label.startsWith(`Materias ${cell.description} de `), 'El modal tiene nombre accesible', open);
        t.equal(open.focus, 'closeSubjectListBtn', 'El foco pasa a la X');
        if (cell.close === 'x') await t.ui.click('#closeSubjectListBtn');
        else await t.ui.press('Escape');
        t.require(await t.ui.waitModal(OVERLAY, false), `El modal no se cerró con ${cell.close}`);
        t.equal((await modalState()).focus, state.button, 'El foco vuelve al botón');
      });
    }
    await logoutViaUi(t);
  });

  test('stable-layout', 'Cada filtro y cada página reemplazan las filas sin vaciar la tabla en el medio: la tabla, sus encabezados y la paginación no saltan y la página no se desplaza, también con un filtro sin resultados', {
    history: [{ plan: 'Pedido del 2026-11-09: la tabla de los reportes salta al aplicar un filtro (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' }],
  }, async (t) => {
    const LAYOUT = {
      boxes: { filters: '.report-filters', card: '.coverage-card', headers: '.coverage-card thead th', footer: '.coverage-card .table-footer' },
      texts: { rows: '.coverage-card tbody tr', results: '.coverage-card .results-count' },
    };
    const FIXED = ['filters', 'headers'];
    await openReport(t);
    await expectRows(t, { year: t.year, ids: await expectedIds(t, t.year), label: 'Ciclo actual' });

    // Cada cambio, con la página desplazada un poco (los filtros siguen a la vista) o hasta el final
    // (para llegar a la paginación)
    const steps = [
      { label: 'Nivel Secundaria', scroll: 80, action: () => chooseInBar(t, 'level', 'SECONDARY') },
      { label: 'Página 2', scroll: 'end', action: () => t.ui.click('.coverage-card .pagination .page-btn[data-page="2"]:not(.page-nav)', { scroll: false }) },
      { label: 'Página 1', scroll: 'end', action: () => t.ui.click('.coverage-card .pagination .page-btn[data-page="1"]:not(.page-nav)', { scroll: false }) },
      { label: 'Turno Tarde', scroll: 80, action: () => chooseInBar(t, 'shift', 'AFTERNOON') },
      { label: 'Turno Mañana', scroll: 80, action: () => chooseInBar(t, 'shift', 'MORNING') },
      { label: `Ciclo ${t.year - 1}`, scroll: 80, prepare: () => startYearInBar(t, t.year - 1), action: () => finishYearInBar(t, t.year - 1) },
      { label: `Ciclo ${t.year - 2}`, scroll: 80, prepare: () => startYearInBar(t, t.year - 2), action: () => finishYearInBar(t, t.year - 2) },
      // Primaria a la mañana de dos ciclos atrás: sin cursos incompletos
      { label: 'Nivel Primaria, sin resultados', scroll: 80, action: () => chooseInBar(t, 'level', 'PRIMARY'), empty: true },
      { label: 'Limpiar Nivel', scroll: 0, action: () => clearInBar(t, 'level') },
      { label: 'Limpiar Ciclo lectivo', scroll: 80, action: () => clearInBar(t, 'year') },
    ];
    for (const step of steps) {
      await t.step(step.label, async () => {
        await scrollMainTo(t, step.scroll);
        if (step.prepare) {
          await step.prepare();
          await t.ui.idle({ quietMs: 400 });
        }
        const samples = await recordLayout(t, LAYOUT, step.action);
        checkNoIntermediateState(t, samples, { label: step.label, fixed: FIXED });
        if (step.empty) {
          t.equal(samples.at(-1).texts.rows, 'Todos los cursos tienen docente asignado en todas sus materias.', 'El mensaje sin resultados');
        }
      });
    }
    await logoutViaUi(t);
  });
});

// Reporte Carga docente por profesor (parte 02 y pedido del 2026-11-09: tabla paginada con el
// resumen del promedio arriba). Los datos propios agregan un profesor con más asignaciones que
// cualquiera del seed (el primero de la lista), uno suspendido con una y uno sin asignaciones.
group('ui.reports.teacher-workload', 'Reportes: Carga docente por profesor', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId();
    // Un ciclo con un curso y sin asignaciones: tiene datos, con todos los profesores en 0
    const zeroYear = fixtures.year - 10;
    await fixtures.inSchoolYear(zeroYear, () => fixtures.createCourse());
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
    const idleTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Libre' });
    return { institutionId, busiestTeacher, suspendedTeacher, idleTeacher, zeroYear };
  },
}, () => {
  const VIEW = 'admin/teacher-workload-report/index.html';
  const ROWS = '.workload-card tbody tr[data-teacher-id]';
  const OVERLAY = '#assignmentListOverlay';
  const PAGE_SIZE = 10;
  const COLUMN_LEVEL = { PRIMARY: 'PRIMARIA', SECONDARY: 'SECUNDARIA' };
  const SHIFT_LABELS = { 'MAÑANA': 'Mañana', TARDE: 'Tarde' };

  // Los profesores no dados de baja de la institución, con sus asignaciones vigentes de cursos
  // vigentes del ciclo actual (de un nivel, si llega), en el orden del reporte (consulta propia):
  // la fila que tiene que mostrar la vista ({ id, name, status, count, button }) y el texto de cada
  // asignación del modal
  const expectedTeachers = async (t, educationLevel = null) => {
    const rows = await t.sql(`
      SELECT u.usuario_id AS id, u.nombre AS "firstName", u.apellido AS "lastName", u.estado AS active,
             COALESCE(json_agg(json_build_object('grade', g.nombre, 'division', c.division, 'shift', c.turno, 'subject', m.nombre)
                               ORDER BY g.nivel_educativo, g.nombre, c.division, c.turno, m.nombre)
                        FILTER (WHERE a.asignacion_docente_id IS NOT NULL), '[]') AS assignments
        FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
        LEFT JOIN asignacion_docente a ON a.usuario_id = u.usuario_id AND a.fecha_eliminacion IS NULL
             AND EXISTS (SELECT 1 FROM curso c2 JOIN grado g2 USING (grado_id)
                          WHERE c2.curso_id = a.curso_id AND c2.fecha_eliminacion IS NULL AND c2.anio_ciclo_lectivo = $2
                            AND ($3::TEXT IS NULL OR g2.nivel_educativo = $3))
        LEFT JOIN curso c ON c.curso_id = a.curso_id
        LEFT JOIN grado g ON g.grado_id = c.grado_id
        LEFT JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
        LEFT JOIN materia m ON m.materia_id = gm.materia_id
       WHERE u.institucion_id = $1 AND r.nombre = 'PROFESOR' AND u.fecha_eliminacion IS NULL
       GROUP BY u.usuario_id
       ORDER BY COUNT(a.asignacion_docente_id) DESC, u.apellido, u.nombre, u.usuario_id`,
    [t.data.institutionId, t.year, COLUMN_LEVEL[educationLevel] ?? null]);
    return rows.map((row) => ({
      id: row.id,
      name: `${row.lastName}, ${row.firstName}`,
      lastName: row.lastName,
      firstName: row.firstName,
      status: row.active ? 'Activo' : 'Suspendido',
      count: row.assignments.length,
      assignments: row.assignments.map((a) => `${a.grade} ${a.division} · ${SHIFT_LABELS[a.shift]} — ${a.subject}`),
    }));
  };

  // La fila esperada en la tabla: el botón solo si tiene asignaciones
  const rowOf = ({ id, name, status, count }) => ({ id, name, status, count, button: count > 0 });

  // El texto del resumen esperado para una lista de profesores (promedio redondeado y grupos contra
  // ese entero)
  const summaryTextOf = (teachers) => {
    const counts = teachers.map((teacher) => teacher.count);
    const average = Math.round(counts.reduce((sum, count) => sum + count, 0) / counts.length);
    const above = counts.filter((count) => count > average).length;
    const below = counts.filter((count) => count > 0 && count < average).length;
    const without = counts.filter((count) => count === 0).length;
    return `${average} ${average === 1 ? 'asignación' : 'asignaciones'} por profesor: (${above} por encima) (${below} por debajo) (${without} sin asignaciones)`;
  };

  // Lo que muestra la vista: la página, las filas y el resumen (el título y el texto, sin espacios
  // de más)
  const VIEW_STATE = `(() => ({
    page: document.querySelector('.workload-card table-pagination').page,
    rows: Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}), (row) => ({
      id: Number(row.dataset.teacherId),
      name: row.cells[0].textContent.trim(),
      status: row.cells[1].textContent.trim(),
      count: Number(row.cells[2].querySelector('.list-summary-count')?.textContent ?? row.cells[2].textContent),
      button: Boolean(row.cells[2].querySelector('.list-summary-button')),
    })),
    title: document.querySelector('.workload-summary-title').textContent.trim(),
    summary: document.querySelector('.workload-summary-text').textContent.replace(/\\s+/g, ' ').trim(),
  }))()`;
  const viewState = (t) => t.ui.js(VIEW_STATE);

  // Espera que la vista muestre la página `page` de `expected`, con su resumen
  const expectPage = async (t, expected, { page, label }) => {
    const rows = expected.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(rowOf);
    const summary = summaryTextOf(expected);
    const target = JSON.stringify({ page, rows, title: 'Promedio general', summary });
    const ok = await t.ui.waitFor(`JSON.stringify(${VIEW_STATE}) === ${JSON.stringify(target)}`, { timeoutMs: 6000 });
    const state = await viewState(t);
    t.check(ok,`${label}: la página ${page}, en el orden de la consulta propia, con el resumen de todos`, { expected: JSON.parse(target), shown: state });
  };

  const openReport = async (t) => {
    await loginViaUi(t, SEED_USERS.admin);
    t.require(await t.ui.navigate(VIEW) === VIEW, 'No se abrió el reporte');
    await t.ui.idle();
  };

  const goToPage = (t, page) => t.ui.click(`.workload-card .pagination .page-btn[data-page="${page}"]:not(.page-nav)`);
  const lastPageOf = (expected) => Math.ceil(expected.length / PAGE_SIZE);
  const pageOf = (expected, id) => Math.floor(expected.findIndex((teacher) => teacher.id === id) / PAGE_SIZE) + 1;

  test('rows', 'Una fila por profesor, de mayor a menor y por apellido, con el estado en texto, paginada de a 10, y el resumen igual en todas las páginas', {
    history: [{ plan: 'Pedido del 2026-11-09: tabla en lugar del gráfico (sin plan en plans/)', date: '2026-11-09', change: 'Prueba reescrita: filas de la tabla, paginación y resumen en lugar de las barras, la línea del promedio y el tooltip' }],
  }, async (t) => {
    const { busiestTeacher, suspendedTeacher, idleTeacher } = t.data;
    await openReport(t);
    const expected = await expectedTeachers(t);
    t.require(expected.length > PAGE_SIZE, 'La institución tiene que tener más de 10 profesores', expected.length);
    await expectPage(t, expected, { page: 1, label: 'Ciclo actual' });
    t.equal((await viewState(t)).rows[0]?.id, busiestTeacher.id, 'La primera fila es la del profesor con más asignaciones');

    // Cada página, con el mismo resumen
    for (let page = 2; page <= lastPageOf(expected); page += 1) {
      await goToPage(t, page);
      await expectPage(t, expected, { page, label: `Página ${page}` });
    }
    // Los sin asignaciones quedan al final, con 0 y sin botón; el suspendido dice Suspendido
    const zeros = expected.filter((teacher) => teacher.count === 0);
    t.equal(expected.slice(-zeros.length).map((teacher) => teacher.id), zeros.map((teacher) => teacher.id), 'Los sin asignaciones son los últimos');
    await goToPage(t, pageOf(expected, idleTeacher.id));
    await expectPage(t, expected, { page: pageOf(expected, idleTeacher.id), label: 'Página del profesor sin asignaciones' });
    const idle = (await viewState(t)).rows.find((row) => row.id === idleTeacher.id);
    t.equal(idle && { status: idle.status, count: idle.count, button: idle.button }, { status: 'Activo', count: 0, button: false },
      'El profesor sin asignaciones muestra 0, sin botón');
    await goToPage(t, pageOf(expected, suspendedTeacher.id));
    await expectPage(t, expected, { page: pageOf(expected, suspendedTeacher.id), label: 'Página del profesor suspendido' });
    const suspended = (await viewState(t)).rows.find((row) => row.id === suspendedTeacher.id);
    t.equal(suspended && { status: suspended.status, count: suspended.count, button: suspended.button }, { status: 'Suspendido', count: 1, button: true },
      'El suspendido dice Suspendido, con su asignación y el botón');
    t.equal(await t.ui.js(`getComputedStyle(document.querySelector('[data-teacher-id="${suspendedTeacher.id}"] td:nth-child(2)')).color
      === getComputedStyle(document.querySelector('[data-teacher-id="${suspendedTeacher.id}"] td:nth-child(1)')).color
      && !document.querySelector('[data-teacher-id="${suspendedTeacher.id}"] td:nth-child(2) *')`), true, 'El estado es texto plano, sin color propio ni badge');
    await logoutViaUi(t);
  });

  test('assignment-list', 'El botón de la cantidad abre el modal con el curso y la materia de cada asignación, que se cierra con la X y con Escape y devuelve el foco', {
    history: [{ plan: 'Pedido del 2026-11-09: tabla en lugar del gráfico (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' }],
  }, async (t) => {
    const { busiestTeacher, suspendedTeacher } = t.data;
    await openReport(t);
    const expected = await expectedTeachers(t);
    await expectPage(t, expected, { page: 1, label: 'Ciclo actual' });
    const modalState = () => t.ui.js(`(() => ({
      label: document.querySelector('${OVERLAY} .modal').getAttribute('aria-label'),
      items: Array.from(document.querySelectorAll('#assignmentList li'), (item) => item.textContent),
      focus: document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || null,
    }))()`);

    const cases = [
      { teacher: busiestTeacher, close: 'x' },
      { teacher: suspendedTeacher, close: 'Escape' },
    ];
    for (const { teacher, close } of cases) {
      await t.step(`${teacher.firstName} (${close})`, async () => {
        const row = expected.find((candidate) => candidate.id === teacher.id);
        const page = pageOf(expected, teacher.id);
        if ((await viewState(t)).page !== page) await goToPage(t, page);
        await expectPage(t, expected, { page, label: `Página de ${teacher.firstName}` });
        const button = `[data-teacher-id="${teacher.id}"] .list-summary-button`;
        const buttonLabel = await t.ui.js(`document.querySelector('${button}').getAttribute('aria-label')`);
        t.equal(buttonLabel, `${row.count === 1 ? 'Ver la asignación' : `Ver las ${row.count} asignaciones`} de ${row.firstName} ${row.lastName}`, 'El botón dice qué abre');
        await t.ui.click(button);
        t.require(await t.ui.waitModal(OVERLAY, true), 'El modal no se abrió');
        const open = await modalState();
        t.equal(open.items, row.assignments, 'El modal lista el curso y la materia de cada asignación, en orden', open);
        t.equal(open.label, `Asignaciones de ${row.firstName} ${row.lastName}`, 'El modal tiene nombre accesible');
        t.equal(open.focus, 'closeAssignmentListBtn', 'El foco pasa a la X');
        if (close === 'x') await t.ui.click('#closeAssignmentListBtn');
        else await t.ui.press('Escape');
        t.require(await t.ui.waitModal(OVERLAY, false), `El modal no se cerró con ${close}`);
        t.equal((await modalState()).focus, buttonLabel, 'El foco vuelve al botón');
      });
    }
    await logoutViaUi(t);
  });

  test('level-filter', 'Un cambio de Nivel actualiza las filas y el resumen y vuelve a la página 1', {
    history: [{ plan: 'Pedido del 2026-11-09: tabla en lugar del gráfico (sin plan en plans/)', date: '2026-11-09', change: 'Compara las filas de la tabla y el resumen en lugar de las barras, y la vuelta a la página 1' }],
  }, async (t) => {
    await openReport(t);
    const all = await expectedTeachers(t);
    await expectPage(t, all, { page: 1, label: 'Todos los niveles' });
    await goToPage(t, 2);
    await expectPage(t, all, { page: 2, label: 'Todos los niveles, página 2' });
    await chooseColumnFilterOption(t, 'level', 'PRIMARY');
    const primary = await expectedTeachers(t, 'PRIMARY');
    await expectPage(t, primary, { page: 1, label: 'Primaria' });
    t.equal(await t.ui.js(`document.querySelector('.report-filters [data-filter="level"] .report-filter-value').textContent.trim()`),
      'Primaria', 'El botón muestra el nivel elegido');
    // Todas las asignaciones del profesor ocupado son de secundaria: en primaria tiene 0
    t.equal(primary.find((teacher) => teacher.id === t.data.busiestTeacher.id)?.count, 0, 'Sin asignaciones de primaria, el profesor ocupado tiene 0');
    await logoutViaUi(t);
  });

  test('stable-layout', 'Cada filtro y cada página reemplazan las filas y el resumen sin vaciarlos en el medio: el resumen, la tabla, sus encabezados y la paginación no saltan y la página no se desplaza, también en un ciclo sin asignaciones', {
    history: [
      { plan: 'Pedido del 2026-11-09: la tabla de los reportes salta al aplicar un filtro (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' },
      { plan: 'Pedido del 2026-11-09: mensaje de ciclo lectivo sin datos en los reportes (sin plan en plans/)', date: '2026-11-09', change: 'El ciclo sin asignaciones es uno con un curso (zeroYear): uno sin cursos ya no muestra la tabla, sino el mensaje de ciclo sin datos (prueba no-data)' },
    ],
  }, async (t) => {
    const LAYOUT = {
      boxes: {
        filters: '.report-filters', summary: '.workload-summary-card', card: '.workload-card',
        headers: '.workload-card thead th', footer: '.workload-card .table-footer',
      },
      texts: { summary: '.workload-summary-text', rows: '.workload-card tbody tr', results: '.workload-card .results-count' },
    };
    const FIXED = ['filters', 'summary', 'headers'];
    // Un ciclo con un curso y sin asignaciones: todos los profesores con 0
    const emptyYear = t.data.zeroYear;
    t.require(Number.isInteger(emptyYear), 'Falta zeroYear en los datos del grupo');
    t.require((await t.sql(`SELECT 1 FROM asignacion_docente a JOIN curso c USING (curso_id) WHERE c.institucion_id = $1 AND c.anio_ciclo_lectivo = $2`,
      [t.data.institutionId, emptyYear])).length === 0, `El ciclo ${emptyYear} no tiene que tener asignaciones`);
    await openReport(t);
    await expectPage(t, await expectedTeachers(t), { page: 1, label: 'Ciclo actual' });

    const steps = [
      { label: 'Nivel Primaria', scroll: 80, action: () => chooseInBar(t, 'level', 'PRIMARY') },
      { label: 'Página 2', scroll: 'end', action: () => t.ui.click('.workload-card .pagination .page-btn[data-page="2"]:not(.page-nav)', { scroll: false }) },
      { label: 'Siguiente', scroll: 'end', action: () => t.ui.click('.workload-card .pagination .page-nav:last-child', { scroll: false }) },
      { label: 'Turno Mañana', scroll: 80, action: () => chooseInBar(t, 'shift', 'MORNING') },
      { label: 'Nivel Secundaria', scroll: 80, action: () => chooseInBar(t, 'level', 'SECONDARY') },
      { label: `Ciclo ${t.year - 1}`, scroll: 80, prepare: () => startYearInBar(t, t.year - 1), action: () => finishYearInBar(t, t.year - 1) },
      { label: `Ciclo ${emptyYear}, sin asignaciones`, scroll: 80, prepare: () => startYearInBar(t, emptyYear), action: () => finishYearInBar(t, emptyYear), empty: true },
      { label: 'Limpiar Ciclo lectivo', scroll: 80, action: () => clearInBar(t, 'year') },
      { label: 'Limpiar Turno', scroll: 0, action: () => clearInBar(t, 'shift') },
    ];
    for (const step of steps) {
      await t.step(step.label, async () => {
        await scrollMainTo(t, step.scroll);
        if (step.prepare) {
          await step.prepare();
          await t.ui.idle({ quietMs: 400 });
        }
        const samples = await recordLayout(t, LAYOUT, step.action);
        checkNoIntermediateState(t, samples, { label: step.label, fixed: FIXED });
        if (step.empty) {
          t.check(samples.at(-1).texts.summary.startsWith('0 asignaciones por profesor:'), 'El resumen de un ciclo sin asignaciones', samples.at(-1).texts.summary);
        }
      });
    }
    await logoutViaUi(t);
  });

  test('no-data', 'Un ciclo sin cursos muestra solo "No existen registros…", sin el resumen, la tabla ni la paginación; un ciclo con cursos y sin asignaciones muestra a todos con 0 y el resumen, y "Limpiar filtro" vuelve al actual', {
    history: [{ plan: 'Pedido del 2026-11-09: mensaje de ciclo lectivo sin datos en los reportes (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' }],
  }, async (t) => {
    const { zeroYear } = t.data;
    t.require(Number.isInteger(zeroYear), 'Falta zeroYear en los datos del grupo');
    const emptyYear = t.year - 20;
    t.require((await t.sql(`SELECT 1 FROM curso WHERE institucion_id = $1 AND anio_ciclo_lectivo = $2`, [t.data.institutionId, emptyYear])).length === 0,
      `El ciclo ${emptyYear} no tiene que tener cursos`);
    const PARTS = {
      message: '.workload-card .report-message', summary: '.workload-summary-card', table: '.workload-card .data-table', pagination: '.workload-card .pagination',
    };
    const WITH_DATA = { message: null, summary: true, table: true, pagination: true };
    await openReport(t);
    await expectPage(t, await expectedTeachers(t), { page: 1, label: 'Ciclo actual' });
    t.equal(await noDataState(t, PARTS), WITH_DATA, 'Ciclo actual: el resumen, la tabla y la paginación, sin el mensaje');

    await typeInColumnFilter(t, 'year', '.column-filter-input', String(emptyYear));
    t.check(await waitNoData(t, { message: PARTS.message, year: emptyYear, shown: true }), `Ciclo ${emptyYear}: aparece el mensaje`, await noDataState(t, PARTS));
    t.equal(await noDataState(t, PARTS), { message: NO_DATA_MESSAGE, summary: false, table: false, pagination: false }, `Ciclo ${emptyYear}: solo el mensaje`);

    await typeInColumnFilter(t, 'year', '.column-filter-input', String(zeroYear));
    t.check(await waitNoData(t, { message: PARTS.message, year: zeroYear, shown: false }), `Ciclo ${zeroYear}: el mensaje desaparece`, await noDataState(t, PARTS));
    t.equal(await noDataState(t, PARTS), WITH_DATA, `Ciclo ${zeroYear}, con cursos y sin asignaciones: el resumen, la tabla y la paginación`);
    const zero = await viewState(t);
    t.check(zero.rows.length > 0 && zero.rows.every((row) => row.count === 0 && !row.button), 'Todos los profesores con 0', zero.rows);
    t.check(zero.summary.startsWith('0 asignaciones por profesor:'), 'El resumen en 0', zero.summary);

    await clearColumnFilter(t, 'year');
    await expectPage(t, await expectedTeachers(t), { page: 1, label: 'Después de "Limpiar filtro"' });
    t.equal(await noDataState(t, PARTS), WITH_DATA, 'Ciclo actual otra vez: el resumen, la tabla y la paginación');
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

  test('chart-card', 'La tarjeta del gráfico tiene solo el gráfico: sin encabezado, eje vertical, grilla ni nota al pie; con los meses, la línea base y la leyenda en cuadrados', {
    history: [{ plan: 'Pedido del 2026-11-09: simplificar la tarjeta del gráfico de Regularidad de los backups (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' }],
  }, async (t) => {
    await openReport(t);
    for (const year of [t.year, t.year - 1]) {
      await t.step(`Ciclo ${year}`, async () => {
        if (year !== t.year) await typeInColumnFilter(t, 'year', '.column-filter-input', String(year));
        const counts = await expectedCounts(t, year);
        await expectColumns(t, { year, counts, label: `Ciclo ${year}` });
        await t.ui.idle({ quietMs: 600 });
        const card = await t.ui.js(`(() => {
          const card = document.querySelector('.backup-chart-card');
          const rect = (el) => el.getBoundingClientRect();
          const cardRect = rect(card);
          const bars = card.querySelector('.chart-bars');
          const values = Array.from(card.querySelectorAll('.backup-value:not([hidden])'), rect);
          const style = getComputedStyle(card);
          return {
            removed: ['.chart-header', 'h2', '.chart-y-axis', '.chart-gridlines', '.backup-limitations'].filter((selector) => card.querySelector(selector)),
            labels: Array.from(card.querySelectorAll('.chart-col-label'), (label) => label.textContent.trim()),
            baseline: getComputedStyle(bars).borderBottomStyle + ' ' + getComputedStyle(bars).borderBottomWidth,
            markers: Array.from(card.querySelectorAll('.legend-item:not([hidden]) .legend-dot'), (dot) => getComputedStyle(dot).borderRadius),
            valuesInside: values.every((value) => value.top >= cardRect.top + parseFloat(style.paddingTop) - 1),
            topGap: Math.round(Math.min(...values.map((value) => value.top), rect(bars).top) - cardRect.top),
            bottomGap: Math.round(cardRect.bottom - rect(card.querySelector('.chart-legend')).bottom),
          };
        })()`);
        t.equal(card.removed, [], 'Sin título, descripción, eje vertical, grilla ni nota al pie');
        t.equal(card.labels, ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'], 'Los meses en el eje horizontal');
        t.equal(card.baseline, 'solid 1px', 'La línea base bajo las columnas');
        t.check(card.markers.length >= 1 && card.markers.every((radius) => radius === '2px'), 'Los marcadores de la leyenda son cuadrados', card.markers);
        t.check(card.valuesInside, 'Las cantidades quedan dentro del margen de la tarjeta', card);
        t.check(card.topGap <= 48 && card.bottomGap <= 32, 'Sin huecos arriba ni abajo donde estaban el encabezado y la nota', card);
      });
    }
    await logoutViaUi(t);
  });

  test('stable-layout', 'Un cambio de año reemplaza el gráfico sin ocultarlo en el medio: el indicador, el gráfico y su leyenda no saltan y la página no se desplaza; un ciclo sin backups pasa al mensaje de una vez, sin mover el indicador', {
    history: [
      { plan: 'Pedido del 2026-11-09: la tabla de los reportes salta al aplicar un filtro (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' },
      { plan: 'Pedido del 2026-11-09: simplificar la tarjeta del gráfico de Regularidad de los backups (sin plan en plans/)', date: '2026-11-09', change: 'Sin el eje vertical ni las limitaciones, que se quitaron de la tarjeta' },
      { plan: 'Pedido del 2026-11-09: mensaje de ciclo lectivo sin datos en los reportes (sin plan en plans/)', date: '2026-11-09', change: 'En el ciclo sin backups y en la vuelta desde él, el gráfico se reemplaza por el mensaje (y al revés): solo quedan fijos la barra y el indicador' },
    ],
  }, async (t) => {
    // La caja del gráfico y no la de cada columna: las columnas crecen desde la base en cada carga
    // (chart.css), con una transformación que también cambia su caja
    const LAYOUT = {
      boxes: {
        filters: '.report-filters', lastBackup: '.last-backup-card', card: '.backup-chart-card', chart: '.backup-chart',
        legend: '.chart-legend',
      },
      texts: { message: '.backup-chart-message', values: '.backup-value', lastBackup: '.last-backup-text' },
    };
    const FIXED = ['filters', 'lastBackup', 'card', 'chart', 'legend'];
    const emptyYear = t.year - 20;
    t.require((await expectedCounts(t, emptyYear)).every((count) => count === 0), `El ciclo ${emptyYear} no tiene que tener backups`);
    await openReport(t);
    await expectColumns(t, { year: t.year, counts: await expectedCounts(t, t.year), label: 'Ciclo actual' });

    const steps = [
      { label: `Ciclo ${t.year - 1}`, scroll: 80, prepare: () => startYearInBar(t, t.year - 1), action: () => finishYearInBar(t, t.year - 1) },
      { label: `Ciclo ${emptyYear}, sin backups`, scroll: 80, prepare: () => startYearInBar(t, emptyYear), action: () => finishYearInBar(t, emptyYear), noData: true },
      { label: 'Limpiar Ciclo lectivo', scroll: 80, action: () => clearInBar(t, 'year'), fromNoData: true },
    ];
    for (const step of steps) {
      await t.step(step.label, async () => {
        await scrollMainTo(t, step.scroll);
        if (step.prepare) {
          await step.prepare();
          await t.ui.idle({ quietMs: 400 });
        }
        const samples = await recordLayout(t, LAYOUT, step.action);
        const changesCard = step.noData || step.fromNoData;
        checkNoIntermediateState(t, samples, { label: step.label, fixed: changesCard ? ['filters', 'lastBackup'] : FIXED });
        if (step.noData) t.equal(samples.at(-1).texts.message, NO_DATA_MESSAGE, 'El mensaje de ciclo sin datos');
      });
    }
    await logoutViaUi(t);
  });

  test('no-data', 'Un año sin backups muestra solo "No existen registros…", sin el gráfico ni su leyenda, con el indicador del último backup igual; "Limpiar filtro" vuelve al gráfico del actual', {
    history: [{ plan: 'Pedido del 2026-11-09: mensaje de ciclo lectivo sin datos en los reportes (sin plan en plans/)', date: '2026-11-09', change: 'Prueba nueva' }],
  }, async (t) => {
    const emptyYear = t.year - 20;
    t.require((await expectedCounts(t, emptyYear)).every((count) => count === 0), `El ciclo ${emptyYear} no tiene que tener backups`);
    const PARTS = { message: '.backup-chart-message', chart: '.backup-chart', legend: '.chart-legend', lastBackup: '.last-backup-card' };
    const WITH_DATA = { message: null, chart: true, legend: true, lastBackup: true };
    await openReport(t);
    await expectColumns(t, { year: t.year, counts: await expectedCounts(t, t.year), label: 'Ciclo actual' });
    t.equal(await noDataState(t, PARTS), WITH_DATA, 'Ciclo actual: el gráfico y su leyenda, sin el mensaje');
    const before = await viewState(t);

    await typeInColumnFilter(t, 'year', '.column-filter-input', String(emptyYear));
    t.check(await waitNoData(t, { message: PARTS.message, year: emptyYear, shown: true }), `Ciclo ${emptyYear}: aparece el mensaje`, await noDataState(t, PARTS));
    t.equal(await noDataState(t, PARTS), { message: NO_DATA_MESSAGE, chart: false, legend: false, lastBackup: true }, `Ciclo ${emptyYear}: solo el mensaje y el indicador`);
    const after = await viewState(t);
    t.equal({ summary: after.summary, date: after.date }, { summary: before.summary, date: before.date }, 'El indicador del último backup no cambia');

    // El ciclo anterior tiene backups (los de la preparación del grupo): vuelve el gráfico
    await typeInColumnFilter(t, 'year', '.column-filter-input', String(t.year - 1));
    await expectColumns(t, { year: t.year - 1, counts: await expectedCounts(t, t.year - 1), label: 'Ciclo anterior' });
    t.equal(await noDataState(t, PARTS), WITH_DATA, 'Ciclo anterior: el gráfico otra vez');

    await clearColumnFilter(t, 'year');
    await expectColumns(t, { year: t.year, counts: await expectedCounts(t, t.year), label: 'Después de "Limpiar filtro"' });
    t.equal(await noDataState(t, PARTS), WITH_DATA, 'Ciclo actual otra vez: el gráfico y su leyenda');
    await logoutViaUi(t);
  });
});
