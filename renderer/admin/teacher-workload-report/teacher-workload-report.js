// Reporte Carga docente por profesor (Administrador), abierto desde Reportes. Por cada profesor de
// la institución que no está dado de baja (activo o suspendido, también sin asignaciones), cuántas
// asignaciones vigentes tiene en los cursos de un ciclo lectivo, con el curso y la materia de cada
// una (window.api.reports.getTeacherWorkload), en una tabla de mayor a menor cantidad y, con la
// misma, por apellido (el orden llega del proceso principal).
// Arriba de la tabla, el resumen de todos los profesores del reporte (summary, calculado en el
// proceso principal): el promedio de asignaciones por profesor redondeado y cuántos quedan por
// encima, por debajo y sin asignaciones. Está fuera de la paginación, así que no cambia de página a
// página.
// Los filtros se aplican en el proceso principal: con cada cambio de la barra (Ciclo lectivo,
// Nivel y Turno, column-filter.js), la vista vuelve a pedir el reporte y vuelve a la página 1. El
// ciclo lectivo es el actual por defecto, con el campo AAAA vacío, o el año completo que se escriba
// (shownSchoolYear, school-year.js); la vista manda siempre el año resuelto. Las filas se paginan
// en memoria, 10 por página, con <table-pagination>.
// El estado es texto plano (Activo o Suspendido). La cantidad de asignaciones lleva, si no es 0, un
// botón que abre un modal con el curso y la materia de cada una, una por línea, como las celdas de
// materias de Materias sin docente por curso (list-modal.css): se cierra con su X o con Escape y el
// foco vuelve al botón que lo abrió.

document.addEventListener('DOMContentLoaded', () => {
  const filterBar = document.querySelector('.report-filters');
  const table = document.querySelector('.workload-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('workloadRowTemplate');
  const summaryTemplate = document.getElementById('assignmentSummaryTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.workload-card table-pagination');

  const summaryAverage = document.querySelector('.workload-summary-average');
  const summaryGroups = document.querySelector('.workload-summary-groups');
  const summaryAbove = document.querySelector('.workload-summary-above');
  const summaryBelow = document.querySelector('.workload-summary-below');
  const summaryWithout = document.querySelector('.workload-summary-without');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  const EMPTY_MESSAGE = 'La institución no tiene profesores.';
  const EMPTY_VALUE = '—';
  const ALL_LABEL = 'Todos';
  const STATUS_LABELS = { active: 'Activo', suspended: 'Suspendido' };

  // Textos de Nivel y Turno tomados de las opciones de sus filtros, para que el botón y el modal
  // digan lo mismo que ellas
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
  // Los profesores del último reporte recibido, en el orden en que llegan del proceso principal
  let teachers = [];
  let isLoaded = false;
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

  // ---------- Resumen ----------

  // "3 asignaciones por profesor:" y "(18 por encima)", "(27 por debajo)", "(4 sin asignaciones)".
  // Sin reporte (cargando, error o sin profesores), solo "—".
  const renderSummary = (summary) => {
    const hasAverage = summary?.average !== null && summary?.average !== undefined;
    summaryGroups.hidden = !hasAverage;
    if (!hasAverage) {
      summaryAverage.textContent = EMPTY_VALUE;
      return;
    }
    const noun = summary.average === 1 ? 'asignación' : 'asignaciones';
    summaryAverage.textContent = `${summary.average} ${noun} por profesor:`;
    summaryAbove.textContent = `(${summary.aboveCount} por encima)`;
    summaryBelow.textContent = `(${summary.belowCount} por debajo)`;
    summaryWithout.textContent = `(${summary.withoutAssignmentsCount} sin asignaciones)`;
  };

  // Cargando, error o sin resultados, en una única fila de todo el ancho, y el resumen vacío
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
    renderSummary(null);
  };

  // "Pérez, Ana" en la tabla (ordenada por apellido); "Ana Pérez" en las etiquetas
  const listName = (teacher) => `${teacher.lastName}, ${teacher.firstName}`;
  const fullName = (teacher) => `${teacher.firstName} ${teacher.lastName}`;

  // "1° A · Mañana — Matemática", con el curso como en Docencia
  const assignmentText = (assignment) =>
    `${assignment.gradeName} ${assignment.division} · ${shiftLabels[assignment.shift] ?? assignment.shift} — ${assignment.subjectName}`;

  // ---------- Modal: asignaciones de un profesor ----------

  const listOverlay = document.getElementById('assignmentListOverlay');
  const listModal = listOverlay.querySelector('.modal');
  const assignmentList = document.getElementById('assignmentList');
  const closeListBtn = document.getElementById('closeAssignmentListBtn');
  // El botón de la fila que abrió el modal, al que vuelve el foco al cerrarlo
  let listTrigger = null;

  const openAssignmentList = (trigger, teacher) => {
    listTrigger = trigger;
    listModal.setAttribute('aria-label', `Asignaciones de ${fullName(teacher)}`);
    assignmentList.replaceChildren(...teacher.assignments.map((assignment) => {
      const item = document.createElement('li');
      item.textContent = assignmentText(assignment);
      return item;
    }));
    listModal.scrollTop = 0;
    listOverlay.classList.add('is-open');
    closeListBtn.focus();
  };

  const closeAssignmentList = () => {
    listOverlay.classList.remove('is-open');
    listTrigger?.focus();
    listTrigger = null;
  };

  closeListBtn.addEventListener('click', closeAssignmentList);

  // Escape se escucha en el documento para que funcione aunque el foco haya quedado fuera de un
  // control (clic en el texto de la lista). El overlay no cierra el modal al hacer clic fuera.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && listOverlay.classList.contains('is-open')) closeAssignmentList();
  });

  // ---------- Filas ----------

  // Sin asignaciones: "0", sin botón. Con una o más: la cantidad y el botón que abre el modal.
  const fillCountCell = (cell, teacher) => {
    const count = teacher.assignmentCount;
    if (count === 0) {
      cell.textContent = '0';
      return;
    }
    const summary = summaryTemplate.content.firstElementChild.cloneNode(true);
    summary.querySelector('.list-summary-count').textContent = String(count);
    const button = summary.querySelector('.list-summary-button');
    const title = count === 1 ? 'Ver la asignación' : `Ver las ${count} asignaciones`;
    button.title = title;
    button.setAttribute('aria-label', `${title} de ${fullName(teacher)}`);
    button.addEventListener('click', () => openAssignmentList(button, teacher));
    cell.replaceChildren(summary);
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // usuario_id en data-teacher-id.
  const createRow = (teacher) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.teacherId = String(teacher.id);
    row.querySelector('.workload-name').textContent = listName(teacher);
    row.querySelector('.workload-status').textContent = teacher.suspended ? STATUS_LABELS.suspended : STATUS_LABELS.active;
    fillCountCell(row.querySelector('.workload-count'), teacher);
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de las filas del reporte (10 por página, en
  // memoria); el componente la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const pageTeachers = pagination.slice(teachers, { page });
    if (pageTeachers.length) tbody.replaceChildren(...pageTeachers.map(createRow));
    else showMessage(EMPTY_MESSAGE);
  };

  // Pide el reporte con los filtros vigentes y lo muestra desde la página 1, con su resumen. Si en
  // el medio llega otro cambio, la respuesta de este pedido se descarta.
  async function loadReport() {
    const number = ++requestNumber;
    isLoaded = false;
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
    teachers = response.report.teachers;
    isLoaded = true;
    renderRows({ page: 1 });
    if (teachers.length) renderSummary(response.report.summary);
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

  // Previo, Siguiente o un número: el componente ya marcó la página nueva. El resumen no cambia.
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
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
