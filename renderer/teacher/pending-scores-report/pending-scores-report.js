// Reporte Calificaciones pendientes de carga (Profesor), abierto desde Reportes. Responde qué
// evaluaciones ya tomadas de sus asignaciones del ciclo lectivo actual tienen alumnos sin nota y
// cuánto falta para que cierre su trimestre, el último día en que todavía se pueden cargar
// (window.api.reports.getPendingScores). Cada nota sin cargar cuenta 0 en el promedio. Las
// evaluaciones llegan ordenadas del proceso principal, por el cierre más próximo; la base calcula la
// fecha de cierre y los días que faltan, así que la vista no hace cuentas de fechas.
// Los filtros se aplican en memoria sobre la lista completa. Sus opciones salen de las asignaciones
// vigentes del profesor en el ciclo actual, que llegan con el reporte, no de las filas: un curso o
// una materia sin pendientes también se ofrece. Nivel educativo ofrece los niveles de esas
// asignaciones; Curso, solo los cursos del nivel elegido, y Materia, solo las de las asignaciones
// que pasan Nivel y Curso. Al cambiar Nivel se rearman Curso y Materia, y al cambiar Curso, Materia;
// la elección sigue si todavía está entre las opciones. Con cada cambio, la tabla vuelve a la
// página 1; se pagina en memoria, 10 por página, con <table-pagination>.
// Cada fila lleva Gestionar, que abre las calificaciones de esa evaluación con la misma URL que arma
// Evaluaciones (?assignmentId=…&evaluationId=…).
// Sin evaluaciones pendientes, la card muestra solo "No tenés calificaciones pendientes de carga.",
// sin la tabla ni la paginación; la barra de filtros sigue visible.

document.addEventListener('DOMContentLoaded', () => {
  const filterBar = document.querySelector('.report-filters');
  const card = document.querySelector('.pending-scores-card');
  const table = card.querySelector('.data-table');
  const noDataMessage = card.querySelector('.report-message');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('evaluationRowTemplate');
  // Los scripts de los componentes se cargan sin defer en <head>: acá ya están definidos y
  // conectados
  const pagination = card.querySelector('table-pagination');
  const filterRoot = (filter) => filterBar.querySelector(`[data-filter="${filter}"]`);
  const courseFilterRoot = filterRoot('course');
  const levelFilterRoot = filterRoot('level');
  const subjectFilterRoot = filterRoot('subject');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  const EMPTY_MESSAGE = 'Ninguna evaluación coincide con los filtros.';
  const ALL_LABEL = 'Todos';
  const ALL_SUBJECTS_LABEL = 'Todas';

  // Los mismos textos de Nivel educativo y de Turno que Asignaciones. Llegan como PRIMARY o
  // SECONDARY y MORNING o AFTERNOON.
  const LEVEL_LABELS = { PRIMARY: 'Primaria', SECONDARY: 'Secundaria' };
  const LEVEL_ORDER = ['PRIMARY', 'SECONDARY'];
  const SHIFT_LABELS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
  const SHIFT_ORDER = ['MORNING', 'AFTERNOON'];

  // El valor vigente que muestra el botón de cada filtro (report-filters.css)
  const filterValue = (filter) => filterBar.querySelector(`[data-filter="${filter}"] .report-filter-value`);

  // Las asignaciones y las evaluaciones del último reporte recibido; las evaluaciones, en el orden en
  // que llegan del proceso principal
  let assignments = [];
  let evaluations = [];
  let isLoaded = false;
  // Cada pedido lleva un número: si llega la respuesta de uno anterior al último, se descarta
  let requestNumber = 0;

  // Lo que filtra cada filtro de la barra, como el data-value de su opción (null = todos): el nivel
  // educativo, el id del curso y el id de la materia
  const activeFilters = { educationLevel: null, course: null, subject: null };

  const levelLabel = (level) => LEVEL_LABELS[level] ?? level;
  // "1° A · Mañana": el grado, la división y el turno de un curso
  const courseName = (course) => `${course.gradeName} ${course.division} · ${SHIFT_LABELS[course.shift] ?? course.shift}`;
  // "1° A · Mañana · Primaria": el curso en Curso
  const courseWithLevel = (course) => `${courseName(course)} · ${levelLabel(course.educationLevel)}`;
  // 'AAAA-MM-DD' → 'DD/MM/AAAA', como en Evaluaciones
  const toDisplayDate = (isoDate) => isoDate.split('-').reverse().join('/');
  // Los días que faltan para el cierre del trimestre
  const daysLeftText = (daysLeft) => {
    if (daysLeft === 0) return 'Cierra hoy';
    if (daysLeft === 1) return 'Falta 1 día';
    return `Faltan ${daysLeft} días`;
  };

  const nameCollator = new Intl.Collator('es');

  // ---------- Filtros ----------

  // Todos los cursos son del ciclo actual: el id alcanza para identificarlos
  const passesLevel = (course) => !activeFilters.educationLevel || course.educationLevel === activeFilters.educationLevel;
  const passesCourse = (course) => !activeFilters.course || String(course.id) === activeFilters.course;
  const passesSubject = (subject) => !activeFilters.subject || String(subject.id) === activeFilters.subject;

  const matchesFilters = ({ course, subject }) => passesLevel(course) && passesCourse(course) && passesSubject(subject);

  // Sin repetir, por la clave que da `keyOf`
  const uniqueBy = (items, keyOf) => Array.from(new Map(items.map((item) => [keyOf(item), item])).values());

  const createOption = (value, text) => {
    const option = document.createElement('li');
    option.className = 'dropdown-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.value = value;
    option.textContent = text;
    return option;
  };

  // Reemplaza las opciones de un filtro; la elegida sigue si todavía está entre ellas y, si no,
  // deja de filtrar
  const replaceOptions = (root, filterKey, options) => {
    const selected = activeFilters[filterKey];
    const kept = replaceColumnFilterOptions(root, options, selected ? [selected] : []);
    activeFilters[filterKey] = kept[0] ?? null;
  };

  // Nivel educativo: los niveles de las asignaciones, primero Primaria y después Secundaria
  const fillLevelOptions = () => {
    const levels = new Set(assignments.map(({ course }) => course.educationLevel));
    const ordered = [...LEVEL_ORDER.filter((level) => levels.has(level)), ...[...levels].filter((level) => !LEVEL_ORDER.includes(level))];
    replaceOptions(levelFilterRoot, 'educationLevel', ordered.map((level) => createOption(level, levelLabel(level))));
  };

  // Curso: los cursos de las asignaciones del nivel elegido, por nivel, grado, división y turno
  const fillCourseOptions = () => {
    const courses = uniqueBy(assignments.map(({ course }) => course).filter(passesLevel), (course) => course.id)
      .sort((a, b) =>
        LEVEL_ORDER.indexOf(a.educationLevel) - LEVEL_ORDER.indexOf(b.educationLevel)
        || a.gradeName.localeCompare(b.gradeName, 'es', { numeric: true })
        || a.division.localeCompare(b.division)
        || SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift));
    replaceOptions(courseFilterRoot, 'course', courses.map((course) => createOption(String(course.id), courseWithLevel(course))));
  };

  // Materia: las materias de las asignaciones que pasan Nivel y Curso, por nombre
  const fillSubjectOptions = () => {
    const subjects = uniqueBy(
      assignments.filter(({ course }) => passesLevel(course) && passesCourse(course)).map(({ subject }) => subject),
      (subject) => subject.id
    ).sort((a, b) => nameCollator.compare(a.name, b.name));
    replaceOptions(subjectFilterRoot, 'subject', subjects.map((subject) => createOption(String(subject.id), subject.name)));
  };

  // El texto de la opción elegida de un filtro, o `allLabel` si no filtra
  const selectedText = (root, filterKey, allLabel) => {
    const selected = root.querySelector('.dropdown-option.selected[data-value]:not([data-value=""])');
    return activeFilters[filterKey] && selected ? selected.textContent.trim() : allLabel;
  };

  // "Curso · 1° A · Mañana · Primaria", "Nivel educativo · Todos", "Materia · Matemática"
  const renderFilterValues = () => {
    filterValue('course').textContent = selectedText(courseFilterRoot, 'course', ALL_LABEL);
    filterValue('level').textContent = activeFilters.educationLevel ? levelLabel(activeFilters.educationLevel) : ALL_LABEL;
    filterValue('subject').textContent = selectedText(subjectFilterRoot, 'subject', ALL_SUBJECTS_LABEL);
  };

  // Lo que fija cada filtro de la barra, por su data-filter, con el detalle de column-filter-change
  const FILTER_VALUES = {
    course: ({ values }) => ({ course: values[0] ?? null }),
    level: ({ values }) => ({ educationLevel: values[0] ?? null }),
    subject: ({ values }) => ({ subject: values[0] ?? null }),
  };

  // ---------- Tabla ----------

  // Con `hasNoData`, la card muestra solo el mensaje de sin pendientes; si no, la tabla
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

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // evaluacion_id en data-evaluation-id.
  const createRow = (evaluation) => {
    const { id, title, evaluationDate, term, teacherAssignmentId, course, subject } = evaluation;
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.evaluationId = String(id);
    row.querySelector('.course-name').textContent = courseName(course);
    row.querySelector('.course-level').textContent = levelLabel(course.educationLevel);
    row.querySelector('.col-subject .text-truncate').textContent = subject.name;
    row.querySelector('.col-evaluation .text-truncate').textContent = title;
    row.querySelector('.evaluation-date').textContent = toDisplayDate(evaluationDate);
    row.querySelector('.evaluation-term').setAttribute('term', String(term));
    row.querySelector('.col-pending').textContent = `${evaluation.pendingCount} de ${evaluation.studentCount}`;
    row.querySelector('.closing-date').textContent = toDisplayDate(evaluation.closingDate);
    row.querySelector('.closing-days').textContent = daysLeftText(evaluation.daysLeft);
    // "Gestionar" abre las calificaciones de la evaluación con el id de su asignación y el suyo, como
    // desde Evaluaciones. El href se asigna antes de conectar el <manage-link>, que lo lee al
    // generarse.
    const manageLink = row.querySelector('manage-link');
    const params = new URLSearchParams({ assignmentId: String(teacherAssignmentId), evaluationId: String(id) });
    manageLink.setAttribute('href', `${manageLink.getAttribute('href')}?${params.toString()}`);
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de las evaluaciones que pasan los filtros (10
  // por página, en memoria); el componente la acota a la última que quede. Sin evaluaciones, la card
  // muestra solo el mensaje de sin pendientes.
  const renderRows = ({ page } = {}) => {
    if (!evaluations.length) {
      setNoData(true);
      return;
    }
    const visibleEvaluations = evaluations.filter(matchesFilters);
    const pageEvaluations = pagination.slice(visibleEvaluations, { page });
    setNoData(false);
    if (pageEvaluations.length) tbody.replaceChildren(...pageEvaluations.map(createRow));
    else showMessage(EMPTY_MESSAGE);
  };

  // Pide el reporte y lo muestra desde la página 1. Si en el medio llega otro pedido, la respuesta
  // de este se descarta. El "Cargando reporte…" queda para la primera carga.
  async function loadReport() {
    const number = ++requestNumber;
    table.setAttribute('aria-busy', 'true');
    let response;
    try {
      response = await window.api?.reports?.getPendingScores();
    } catch (error) {
      console.error('Error al cargar el reporte:', error);
    }
    if (number !== requestNumber) return;
    table.setAttribute('aria-busy', 'false');
    if (!response?.ok) {
      isLoaded = false;
      assignments = [];
      evaluations = [];
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    ({ assignments, evaluations } = response.report);
    isLoaded = true;
    fillLevelOptions();
    fillCourseOptions();
    fillSubjectOptions();
    renderFilterValues();
    renderRows({ page: 1 });
  }

  // Cada filtro de la barra avisa sus cambios (column-filter.js). Un nivel nuevo rearma Curso y
  // Materia; un curso nuevo, Materia. Mientras carga o si la carga falló, se guardan los valores sin
  // reemplazar el mensaje de la tabla.
  filterBar.addEventListener('column-filter-change', (event) => {
    const filter = event.target.dataset.filter;
    const values = FILTER_VALUES[filter](event.detail);
    const hasChanged = Object.entries(values).some(([key, value]) => value !== activeFilters[key]);
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    if (filter === 'level') fillCourseOptions();
    if (filter === 'level' || filter === 'course') fillSubjectOptions();
    renderFilterValues();
    if (isLoaded) renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  showMessage('Cargando reporte…');
  renderFilterValues();
  loadReport();
});
