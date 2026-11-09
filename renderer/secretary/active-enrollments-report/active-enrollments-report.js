// Reporte Inscripciones activas por curso (Secretario), abierto desde Reportes. Responde en qué
// división de un grado conviene inscribir a un alumno nuevo: por cada curso vigente de la
// institución del ciclo lectivo actual, cuántas inscripciones vigentes y activas tiene
// (window.api.reports.getActiveEnrollmentsByCourse), en una tabla por nivel educativo, grado y
// división (el orden llega del proceso principal), así las divisiones de un mismo grado quedan
// juntas.
// Los filtros se aplican en el proceso principal: con cada cambio de la barra (Curso, con
// <course-filter>, y Nivel, column-filter.js), la vista vuelve a pedir el reporte y vuelve a la
// página 1. Las filas se paginan en memoria, 10 por página, con <table-pagination>. Si ningún curso
// coincide con los filtros, la tabla lo dice.
// Cada fila lleva Inscribir, que abre en un modal el formulario "Nueva inscripción" de Inscripciones
// (<enrollment-form>, enrollment-form.component.js) con el nivel educativo y el curso de la fila
// cargados y bloqueados: solo se elige el alumno. El formulario guarda y avisa con sus toasts. El
// modal es el de los reportes del Administrador (setupListModal, list-modal.component.js), sin
// listado: Cancelar, la X y Escape lo cierran, y el foco vuelve a Inscribir (o al de la misma fila,
// si la tabla se volvió a dibujar). Al guardar, o si el curso ya no se puede elegir, el reporte se
// vuelve a pedir con los mismos filtros y en la misma página, y el modal se cierra.
// Si la institución no tiene cursos en el ciclo actual (hasCourses, del proceso principal, sin
// mirar los filtros), la vista muestra solo "No existen registros…", sin la tabla ni la paginación.

document.addEventListener('DOMContentLoaded', () => {
  // Apertura, cierre y selección de los desplegables del formulario (dropdown.component.js). Abrir
  // uno, hacer clic fuera de los buscadores o pulsar Escape cierra también los buscadores
  // (searchable-select.component.js).
  const { closeAllDropdowns } = setupDropdowns({
    onToggle: closeAllSearchableMenus,
    onDismiss: dismissSearchableMenus,
  });

  const filterBar = document.querySelector('.report-filters');
  const card = document.querySelector('.active-enrollments-card');
  const table = card.querySelector('.data-table');
  const noDataMessage = card.querySelector('.report-message');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('courseRowTemplate');
  // Los scripts de los componentes se cargan sin defer en <head>: acá ya están definidos y
  // conectados
  const pagination = card.querySelector('table-pagination');
  const courseFilter = filterBar.querySelector('course-filter');
  const modalOverlay = document.getElementById('newEnrollmentOverlay');
  const form = modalOverlay.querySelector('enrollment-form');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  const EMPTY_MESSAGE = 'Ningún curso coincide con los filtros.';
  const ALL_LABEL = 'Todos';
  // Con más grados elegidos, el botón del filtro Curso dice cuántos en lugar de nombrarlos
  const MAX_NAMED_GRADES = 2;

  // Textos de Nivel y de Turno tomados de las opciones del filtro Nivel y de los botones de Turno
  // del filtro Curso, para que la celda y los botones digan lo mismo que ellos. Llegan como PRIMARY
  // o SECONDARY y MORNING o AFTERNOON.
  const labelsOf = (selector) => Object.fromEntries(
    Array.from(document.querySelectorAll(selector), (element) => [element.dataset.value, element.textContent.trim()])
  );
  const levelLabels = labelsOf('#levelFilter .dropdown-option[data-value]:not([data-value=""])');
  const shiftLabels = labelsOf('#courseFilter .course-filter-shift');

  // El valor vigente que muestra el botón de cada filtro (report-filters.css)
  const filterValue = (filter) => filterBar.querySelector(`[data-filter="${filter}"] .report-filter-value`);

  // Los cursos del último reporte recibido, en el orden en que llegan del proceso principal
  let courses = [];
  let isLoaded = false;
  // Cada pedido lleva un número: si llega la respuesta de uno anterior al último, se descarta
  let requestNumber = 0;

  // Lo que filtra cada dato, con los nombres que espera el proceso principal: el nivel educativo
  // (null = todos) y, del filtro Curso, los grados, las divisiones y los turnos (vacíos = todos)
  const activeFilters = { educationLevel: null, grades: [], divisions: [], shifts: [] };

  // Valores de activeFilters que fija cada filtro de la barra, por su data-filter, después de un
  // cambio: los de Curso los da su componente y el nivel llega en el detalle de column-filter-change
  const FILTER_VALUES = {
    course: () => ({
      grades: courseFilter.selectedGrades.map(({ level, name }) => ({ educationLevel: level, gradeName: name })),
      divisions: courseFilter.selectedDivisions,
      shifts: courseFilter.selectedShifts,
    }),
    level: ({ values }) => ({ educationLevel: values[0] ?? null }),
  };

  // Lo elegido en Curso, en pocas palabras: "1° Primaria, División A, Mañana", "3 grados,
  // Divisiones A, B" o "Todos". Los dos turnos equivalen a no filtrar por turno.
  const courseFilterText = () => {
    const { grades, divisions, shifts } = activeFilters;
    const parts = [];
    if (grades.length > MAX_NAMED_GRADES) parts.push(`${grades.length} grados`);
    else grades.forEach(({ educationLevel, gradeName }) => parts.push(`${gradeName} ${levelLabels[educationLevel] ?? educationLevel}`));
    if (divisions.length) parts.push(`${divisions.length === 1 ? 'División' : 'Divisiones'} ${divisions.join(', ')}`);
    if (shifts.length === 1) parts.push(shiftLabels[shifts[0]] ?? shifts[0]);
    return parts.length ? parts.join(', ') : ALL_LABEL;
  };

  // "Curso · 1° Primaria", "Nivel · Todos"
  const renderFilterValues = () => {
    filterValue('course').textContent = courseFilterText();
    filterValue('level').textContent = levelLabels[activeFilters.educationLevel] ?? ALL_LABEL;
  };

  // Con `hasNoData`, la card muestra solo el mensaje de ciclo sin cursos; si no, la tabla
  const setNoData = (hasNoData) => {
    card.classList.toggle('has-no-data', hasNoData);
    noDataMessage.hidden = !hasNoData;
  };

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    setNoData(false);
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // "1° A · Mañana", como en el formulario y en los reportes del Administrador
  const courseName = (course) => `${course.gradeName} ${course.division} · ${shiftLabels[course.shift] ?? course.shift}`;

  // ---------- Modal: Nueva inscripción ----------

  // Si la tabla se volvió a dibujar mientras el modal estaba abierto, el foco pasa a Inscribir en la
  // fila del mismo curso; si ya no está en la página, al primero de la tabla y, si no hay ninguno,
  // al botón del filtro Curso
  const focusAfterClose = (trigger) => {
    const courseId = trigger?.closest('tr')?.dataset.courseId;
    const sameRow = courseId ? tbody.querySelector(`tr[data-course-id="${courseId}"] [data-action="enroll"]`) : null;
    return sameRow
      ?? tbody.querySelector('[data-action="enroll"]')
      ?? filterBar.querySelector('[data-filter="course"] .column-filter-toggle');
  };

  const enrollmentModal = setupListModal(modalOverlay, { form, focusAfterClose });

  // Después de guardar, o si el curso ya no se puede elegir: el reporte se vuelve a pedir en la
  // misma página, con la cantidad nueva, y el modal se cierra
  const refreshAfterChange = async () => {
    await loadReport({ keepPage: true });
    enrollmentModal.close();
  };

  form.setup({
    closeAllDropdowns,
    onSaved: () => refreshAfterChange(),
    onCancel: enrollmentModal.cancelForm,
    onStale: () => refreshAfterChange(),
  });

  // ---------- Filas ----------

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // curso_id en data-course-id.
  const createRow = (course) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.courseId = String(course.id);
    row.cells[0].textContent = courseName(course);
    row.cells[1].textContent = levelLabels[course.educationLevel] ?? course.educationLevel;
    row.cells[2].textContent = String(course.activeEnrollmentCount);
    // "Inscribir en 1° A · Mañana, Primaria": abre el formulario con el curso de la fila
    const button = row.querySelector('[data-action="enroll"]');
    button.setAttribute('aria-label', `Inscribir en ${courseName(course)}, ${levelLabels[course.educationLevel] ?? course.educationLevel}`);
    button.addEventListener('click', () => {
      enrollmentModal.openForm(button, { preset: { course } });
    });
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de las filas del reporte (10 por página, en
  // memoria); el componente la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const pageCourses = pagination.slice(courses, { page });
    if (pageCourses.length) tbody.replaceChildren(...pageCourses.map(createRow));
    else showMessage(EMPTY_MESSAGE);
  };

  // Pide el reporte con los filtros vigentes y lo muestra desde la página 1 o, con `keepPage`
  // (después de inscribir), en la página actual, acotada a la última. Si en el medio llega otro
  // cambio, la respuesta de este pedido se descarta. Mientras se espera, la tabla conserva lo que
  // muestra y las filas nuevas la reemplazan de una vez al llegar: vaciarla en el medio la achicaba
  // y, con la página desplazada, la hacía saltar. El "Cargando reporte…" queda solo para la primera
  // carga.
  async function loadReport({ keepPage = false } = {}) {
    const number = ++requestNumber;
    table.setAttribute('aria-busy', 'true');
    let response;
    try {
      response = await window.api?.reports?.getActiveEnrollmentsByCourse({ ...activeFilters });
    } catch (error) {
      console.error('Error al cargar el reporte:', error);
    }
    if (number !== requestNumber) return;
    table.setAttribute('aria-busy', 'false');
    if (!response?.ok) {
      isLoaded = false;
      courses = [];
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    const { hasCourses } = response.report;
    courses = hasCourses ? response.report.courses : [];
    isLoaded = hasCourses;
    if (!hasCourses) {
      setNoData(true);
      return;
    }
    setNoData(false);
    renderRows(keepPage ? {} : { page: 1 });
  }

  // Cada filtro de la barra avisa sus cambios (column-filter.js). Si lo que filtra no cambió (Curso
  // avisa cada clic y cada tecla dentro de su panel), el reporte queda como está.
  filterBar.addEventListener('column-filter-change', (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([filter, value]) => JSON.stringify(value) !== JSON.stringify(activeFilters[filter]));
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    renderFilterValues();
    loadReport();
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  // Los alumnos que se pueden inscribir y los cursos del ciclo lectivo actual que ofrece el
  // formulario
  form.reloadOptions();

  showMessage('Cargando reporte…');
  renderFilterValues();
  loadReport();
});
