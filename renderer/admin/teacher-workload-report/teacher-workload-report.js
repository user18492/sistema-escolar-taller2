// Reporte Carga docente por profesor (Administrador), abierto desde Reportes. Por cada profesor de
// la institución que no está dado de baja (activo o suspendido, también sin asignaciones), cuántas
// asignaciones vigentes tiene en los cursos de un ciclo lectivo y en cuántos cursos distintos
// (window.api.reports.getTeacherWorkload), como un gráfico de barras horizontales (chart.css), de
// mayor a menor, con la línea del promedio de todos los profesores listados.
// Los filtros se aplican en el proceso principal: con cada cambio de la barra (Ciclo lectivo,
// Nivel y Turno, column-filter.js), la vista vuelve a pedir el reporte. El ciclo lectivo es el
// actual por defecto, con el campo AAAA vacío, o el año completo que se escriba (shownSchoolYear,
// school-year.js); la vista manda siempre el año resuelto. Sin paginación: la lista crece en alto.
// Los nombres largos se recortan con "…" y muestran su texto completo como tooltip
// (text-truncate.component.js); el resto de la fila, los conteos ("3 asignaciones en 2 cursos").

document.addEventListener('DOMContentLoaded', () => {
  const filterBar = document.querySelector('.report-filters');
  const chart = document.querySelector('.workload-chart');
  const rowsList = chart.querySelector('.workload-rows');
  const gridlines = chart.querySelector('.workload-gridlines');
  const ticks = chart.querySelector('.workload-ticks');
  const averageLine = chart.querySelector('.workload-average-line');
  const averageLabel = chart.querySelector('.workload-average-label');
  const legend = document.querySelector('.workload-card .chart-legend');
  const message = document.querySelector('.workload-message');
  const rowTemplate = document.getElementById('workloadRowTemplate');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  const EMPTY_MESSAGE = 'La institución no tiene profesores.';
  const EMPTY_VALUE = '—';
  const ALL_LABEL = 'Todos';
  // Cantidad máxima de marcas de la escala: con más asignaciones, las marcas saltan de a 2, 5,
  // 10… y la escala se extiende hasta la siguiente marca
  const MAX_TICKS = 8;
  const TICK_STEPS = [1, 2, 5];

  const averageFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Textos de Nivel y Turno tomados de las opciones de sus filtros, para que el botón diga lo
  // mismo que ellas
  const labelsOf = (selector) => Object.fromEntries(
    Array.from(document.querySelectorAll(`${selector} .dropdown-option[data-value]:not([data-value=""])`),
      (option) => [option.dataset.value, option.textContent.trim()])
  );
  const levelLabels = labelsOf('#levelFilter');
  const shiftLabels = labelsOf('#shiftFilter');

  // El valor vigente que muestra el botón de cada filtro (report-filters.css)
  const filterValue = (filter) => filterBar.querySelector(`[data-filter="${filter}"] .report-filter-value`);

  // El ciclo lectivo actual ({ year, today }): null hasta que llega
  let currentSchoolYear = null;
  // Cada pedido lleva un número: si llega la respuesta de uno anterior al último, se descarta
  let requestNumber = 0;

  // Lo que filtra cada filtro de la barra, por su data-filter: el año completo ('' = el ciclo
  // actual) y el código elegido (null = todos)
  const activeFilters = { year: '', level: null, shift: null };

  // Valor de cada filtro después de un cambio, del detalle de column-filter-change
  const FILTER_VALUES = {
    year: ({ text }) => text,
    level: ({ values }) => values[0] ?? null,
    shift: ({ values }) => values[0] ?? null,
  };

  // "Ciclo lectivo · 2026", "Nivel · Primaria", "Turno · Todos"
  const renderFilterValues = () => {
    filterValue('year').textContent = currentSchoolYear
      ? String(shownSchoolYear(activeFilters.year, currentSchoolYear))
      : EMPTY_VALUE;
    filterValue('level').textContent = levelLabels[activeFilters.level] ?? ALL_LABEL;
    filterValue('shift').textContent = shiftLabels[activeFilters.shift] ?? ALL_LABEL;
  };

  // Cargando, error o sin profesores, en lugar del gráfico y su leyenda
  const showMessage = (text) => {
    message.textContent = text;
    message.hidden = false;
    chart.hidden = true;
    legend.hidden = true;
  };

  // Paso entre marcas: el menor de 1, 2, 5, 10, 20, 50… que deja a lo sumo MAX_TICKS tramos
  const tickStep = (max) => {
    for (let magnitude = 1; ; magnitude *= 10) {
      const step = TICK_STEPS.map((base) => base * magnitude).find((candidate) => max / candidate <= MAX_TICKS);
      if (step) return step;
    }
  };

  // La escala va de 0 al mayor entre la cantidad más alta y el promedio redondeado hacia arriba
  // (al menos 1), extendida hasta la siguiente marca entera si las marcas saltan de a más de 1
  const scaleOf = (teachers, average) => {
    const top = Math.max(1, Math.ceil(average ?? 0), ...teachers.map((teacher) => teacher.assignmentCount));
    const step = tickStep(top);
    return { max: Math.ceil(top / step) * step, step };
  };

  const percentOf = (value, max) => `${(value / max) * 100}%`;

  // "1 asignación en 1 curso", "3 asignaciones en 2 cursos"; "· Suspendido" si lo está
  const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`;
  const rowTitle = (teacher) => {
    const counts = `${plural(teacher.assignmentCount, 'asignación', 'asignaciones')} en ${plural(teacher.courseCount, 'curso', 'cursos')}`;
    return teacher.suspended ? `${counts} · Suspendido` : counts;
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // usuario_id en data-teacher-id.
  const createRow = (teacher, scaleMax) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.teacherId = String(teacher.id);
    row.classList.toggle('is-suspended', teacher.suspended);
    row.title = rowTitle(teacher);
    row.querySelector('.workload-name').textContent = `${teacher.lastName}, ${teacher.firstName}`;
    row.querySelector('.workload-bar').style.width = percentOf(teacher.assignmentCount, scaleMax);
    row.querySelector('.workload-count').textContent = String(teacher.assignmentCount);
    return row;
  };

  // Las marcas enteras de la escala (debajo de las pistas) y su grilla vertical
  const renderScale = ({ max, step }) => {
    const marks = [];
    const lines = [];
    for (let value = 0; value <= max; value += step) {
      const mark = document.createElement('span');
      mark.className = 'workload-tick';
      mark.style.left = percentOf(value, max);
      mark.textContent = String(value);
      marks.push(mark);
      const line = document.createElement('span');
      line.style.left = percentOf(value, max);
      lines.push(line);
    }
    ticks.replaceChildren(...marks);
    gridlines.replaceChildren(...lines);
  };

  // La línea punteada del promedio y su etiqueta, "Promedio: 2,4". La etiqueta va a la derecha de
  // la línea, o a su izquierda si la línea queda en la mitad derecha.
  const renderAverage = (average, scaleMax) => {
    const left = percentOf(average, scaleMax);
    averageLine.style.left = left;
    averageLabel.style.left = left;
    averageLabel.classList.toggle('is-end', average / scaleMax > 0.5);
    averageLabel.textContent = `Promedio: ${averageFormat.format(average)}`;
  };

  // Las barras crecen desde cero en cada carga (chart.css): primero sin transición, para que
  // todas partan del mismo estado, y después con ella
  const playEntrance = () => {
    rowsList.classList.add('is-resetting');
    rowsList.classList.remove('is-loaded');
    void rowsList.offsetWidth; // aplica scaleX(0) de forma inmediata
    rowsList.classList.remove('is-resetting');
    void rowsList.offsetWidth; // reactiva la transición antes de animar
    rowsList.classList.add('is-loaded');
  };

  const renderReport = ({ teachers, average }) => {
    if (!teachers.length) {
      showMessage(EMPTY_MESSAGE);
      return;
    }
    const scale = scaleOf(teachers, average);
    renderScale(scale);
    renderAverage(average, scale.max);
    rowsList.replaceChildren(...teachers.map((teacher) => createRow(teacher, scale.max)));
    message.hidden = true;
    chart.hidden = false;
    legend.hidden = false;
    playEntrance();
  };

  // Pide el reporte con los filtros vigentes y lo muestra. Si en el medio llega otro cambio, la
  // respuesta de este pedido se descarta.
  async function loadReport() {
    const number = ++requestNumber;
    showMessage('Cargando reporte…');
    let response;
    try {
      response = await window.api?.reports?.getTeacherWorkload({
        schoolYear: shownSchoolYear(activeFilters.year, currentSchoolYear),
        educationLevel: activeFilters.level,
        shift: activeFilters.shift,
      });
    } catch (error) {
      console.error('Error al cargar el reporte:', error);
    }
    if (number !== requestNumber) return;
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    renderReport(response.report);
  }

  // Cada filtro de la barra avisa sus cambios (column-filter.js). Si lo que filtra no cambió (el
  // campo de año avisa cada tecla, aunque el año incompleto todavía no filtre), el reporte queda
  // como está. Antes de que llegue el ciclo actual, solo se guarda el valor.
  filterBar.addEventListener('column-filter-change', (event) => {
    const { filter } = event.target.dataset;
    const value = FILTER_VALUES[filter](event.detail);
    if (value === activeFilters[filter]) return;
    activeFilters[filter] = value;
    if (!currentSchoolYear) return;
    renderFilterValues();
    loadReport();
  });

  // Primero el ciclo lectivo actual, de la base: sin él no se sabe qué ciclo pedir
  (async () => {
    showMessage('Cargando reporte…');
    currentSchoolYear = await loadCurrentSchoolYear();
    if (!currentSchoolYear) {
      showMessage(GENERIC_LOAD_ERROR);
      return;
    }
    renderFilterValues();
    loadReport();
  })();
});
