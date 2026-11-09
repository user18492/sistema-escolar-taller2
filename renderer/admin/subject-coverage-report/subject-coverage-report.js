// Reporte Materias sin docente por curso (Administrador), abierto desde Reportes. Por cada curso
// incompleto de un ciclo lectivo (alguna materia del plan de estudios de su grado sin docente o con
// el profesor suspendido), las materias del plan, cuántas tienen docente y cuáles no lo tienen o lo
// tienen suspendido (window.api.reports.getSubjectCoverage). Los cursos completos no aparecen.
// Los filtros se aplican en el proceso principal: con cada cambio de la barra (Ciclo lectivo,
// Nivel y Turno, column-filter.js), la vista vuelve a pedir el reporte y vuelve a la página 1.
// El ciclo lectivo es el actual por defecto, con el campo
// AAAA vacío, o el año completo que se escriba (shownSchoolYear, school-year.js); la vista manda
// siempre el año resuelto. Las filas se paginan en memoria, 10 por página, con <table-pagination>.
// Las listas largas se recortan con "…" y muestran su texto completo como tooltip
// (text-truncate.component.js).

document.addEventListener('DOMContentLoaded', () => {
  const filterBar = document.querySelector('.report-filters');
  const table = document.querySelector('.coverage-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('coverageRowTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.coverage-card table-pagination');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  // Sin filas: con los filtros elegidos no hay cursos incompletos
  const EMPTY_MESSAGE = 'Todos los cursos tienen docente asignado en todas sus materias.';
  const EMPTY_VALUE = '—';
  const ALL_LABEL = 'Todos';

  // Textos de Nivel y Turno tomados de las opciones de sus filtros, para que la celda y el botón
  // digan lo mismo que ellas. Llegan como PRIMARY o SECONDARY y MORNING o AFTERNOON.
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
  // Las filas del último reporte recibido, en el orden en que llegan del proceso principal
  let courses = [];
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

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // "1° A · Mañana", como en Docencia
  const courseName = (course) => `${course.gradeName} ${course.division} · ${shiftLabels[course.shift] ?? course.shift}`;

  // Lista separada por comas, o "—" si está vacía
  const listText = (items) => (items.length ? items.join(', ') : EMPTY_VALUE);

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // curso_id en data-course-id.
  const createRow = (course) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.courseId = String(course.id);
    row.cells[0].textContent = courseName(course);
    row.cells[1].textContent = levelLabels[course.educationLevel] ?? course.educationLevel;
    row.cells[2].textContent = String(course.subjectCount);
    row.cells[3].textContent = String(course.assignedCount);
    row.querySelector('.unassigned-subjects').textContent = listText(course.unassignedSubjects);
    row.querySelector('.suspended-subjects').textContent = listText(
      course.suspendedSubjects.map(({ subjectName, teacherName }) => `${subjectName} (${teacherName})`)
    );
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de las filas del reporte (10 por página, en
  // memoria); el componente la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const pageCourses = pagination.slice(courses, { page });
    if (pageCourses.length) tbody.replaceChildren(...pageCourses.map(createRow));
    else showMessage(EMPTY_MESSAGE);
  };

  // Pide el reporte con los filtros vigentes y lo muestra desde la página 1. Si en el medio llega
  // otro cambio, la respuesta de este pedido se descarta.
  async function loadReport() {
    const number = ++requestNumber;
    isLoaded = false;
    showMessage('Cargando reporte…');
    let response;
    try {
      response = await window.api?.reports?.getSubjectCoverage({
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
    courses = response.report.courses;
    isLoaded = true;
    renderRows({ page: 1 });
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

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
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
