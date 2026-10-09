// Vista Asignaciones del Profesor: la tabla muestra las asignaciones docentes vigentes a cargo del
// profesor de la sesión, de todos los ciclos lectivos, que llegan del proceso principal
// (window.api.teacherAssignments.listOwn), y los filtros de columna las filtran en memoria. Las
// opciones del filtro Materia son las materias de esas asignaciones. La lista filtrada se pagina en
// memoria, 10 por página, con <table-pagination>.
// "Gestionar" abre la vista de gestión de la asignación con los datos de su fila.

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Tabla: asignaciones del profesor ----------

  const table = document.querySelector('.assignments-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('assignmentRowTemplate');
  const subjectOptionTemplate = document.getElementById('subjectOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.assignments-card table-pagination');
  const subjectHeader = table.querySelector('th[data-filter="subject"]');
  // Curso: el componente del panel guarda los grados, las divisiones y los turnos elegidos
  // (course-filter.js). Nivel educativo es solo una columna informativa: se filtra desde Curso.
  const courseFilter = table.querySelector('th[data-filter="course"] course-filter');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar las asignaciones. Intentá nuevamente.';

  // Textos de Turno y Nivel educativo tomados de los botones de turno y de las filas de nivel del
  // filtro Curso, para que la celda diga lo mismo que ellos. Llegan como MORNING o AFTERNOON y
  // PRIMARY o SECONDARY; `key` es el data-* que guarda ese código.
  const labelsOf = (selector, key) => Object.fromEntries(
    Array.from(document.querySelectorAll(selector), (element) => [element.dataset[key], element.textContent.trim()])
  );
  const shiftLabels = labelsOf('#courseFilter .course-filter-shift', 'value');
  const levelLabels = labelsOf('#courseFilter [data-level-header]', 'levelHeader');

  // En el orden en que llegan del proceso principal
  let assignments = [];
  let isLoaded = false;

  // Un grado se repite entre niveles educativos (hay un 1° de primaria y otro de secundaria): se lo
  // identifica con los dos datos
  const gradeKey = (level, name) => `${level}:${name}`;

  // Lo que filtra cada dato de la asignación: las materias marcadas (por su id), el año completo
  // y, del curso, los grados marcados, las divisiones escritas y los turnos activos. Vacío (nada
  // elegido, "Todas" o sin texto) no filtra.
  const activeFilters = { grade: [], division: [], shift: [], subject: [], year: '' };

  // Valores de activeFilters que fija cada columna, por su data-filter, después de un cambio: los
  // tres de Curso los da su componente y los demás llegan en el detalle de column-filter-change
  const FILTER_VALUES = {
    course: () => ({
      grade: courseFilter.selectedGrades.map(({ level, name }) => gradeKey(level, name)),
      division: courseFilter.selectedDivisions,
      shift: courseFilter.selectedShifts,
    }),
    subject: ({ values }) => ({ subject: values }),
    year: ({ text }) => ({ year: text }),
  };

  // Si la asignación pasa cada filtro con ese valor, que no está vacío. Con los dos turnos activos
  // pasan todas, igual que sin ninguno.
  const FILTER_MATCHERS = {
    grade: ({ course }, grades) => grades.includes(gradeKey(course.educationLevel, course.gradeName)),
    division: ({ course }, divisions) => divisions.includes(course.division),
    shift: ({ course }, shifts) => shifts.includes(course.shift),
    subject: ({ subject }, ids) => ids.includes(String(subject.id)),
    year: ({ course }, year) => String(course.schoolYear) === year,
  };

  // Entre sí se combinan con Y; un filtro vacío no descarta nada
  const matchesFilters = (assignment) =>
    Object.entries(activeFilters).every(([filter, value]) => value.length === 0 || FILTER_MATCHERS[filter](assignment, value));

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // "1° A · Mañana"
  const courseName = (course) => `${course.gradeName} ${course.division} · ${shiftLabels[course.shift] ?? course.shift}`;

  // Datos de la fila que "Gestionar" le pasa por la URL a la vista de gestión de la asignación, en
  // el orden de las columnas: esa vista se encabeza con ellos y los reenvía a las que abre
  const SUMMARY_FIELDS = ['course', 'level', 'subject', 'year'];

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // asignacion_docente_id en data-assignment-id.
  const createRow = ({ id, course, subject }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.assignmentId = String(id);
    const texts = [
      courseName(course),
      levelLabels[course.educationLevel] ?? course.educationLevel,
      subject.name,
      String(course.schoolYear),
    ];
    const params = new URLSearchParams();
    texts.forEach((text, index) => {
      row.cells[index].textContent = text;
      params.set(SUMMARY_FIELDS[index], text);
    });
    // El href se asigna antes de conectar el <manage-link>, que lo lee al generarse
    const manageLink = row.querySelector('manage-link');
    manageLink.setAttribute('href', `${manageLink.getAttribute('href')}?${params.toString()}`);
    return row;
  };

  const createSubjectOption = (subject) => {
    const option = subjectOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(subject.id);
    option.textContent = subject.name;
    return option;
  };

  const nameCollator = new Intl.Collator('es');

  // Las materias (por nombre) que tienen alguna asignación en la lista cargada, una vez cada una:
  // las opciones de su filtro
  const listedSubjects = () =>
    [...new Map(assignments.map(({ subject }) => [subject.id, subject])).values()]
      .sort((a, b) => nameCollator.compare(a.name, b.name) || a.id - b.id);

  // Opciones de Materia, después de "Todas"; column-filter.js las lee al usarlas.
  // Llegan sin marcar, así que ese filtro deja de aplicarse y su embudo se actualiza.
  const fillFilterOptions = () => {
    const subjectList = subjectHeader.querySelector('[role="listbox"]');
    subjectList.replaceChildren(subjectList.querySelector('.dropdown-option[data-value=""]'), ...listedSubjects().map(createSubjectOption));
    activeFilters.subject = [];
    subjectHeader.dispatchEvent(new Event('column-filter-refresh'));
  };

  // Muestra la página `page` (por defecto, la actual) de las asignaciones que pasan los filtros (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar un filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const visibleAssignments = assignments.filter(matchesFilters);
    const pageAssignments = pagination.slice(visibleAssignments, { page });
    if (pageAssignments.length) tbody.replaceChildren(...pageAssignments.map(createRow));
    else showMessage(assignments.length ? 'Ninguna asignación coincide con los filtros.' : 'No hay asignaciones a tu cargo.');
  };

  // Pide la lista y, al llegar, arma las opciones de Materia y muestra las asignaciones con lo que
  // se haya elegido mientras tanto en Curso y Ciclo lectivo.
  async function loadAssignments() {
    isLoaded = false;
    showMessage('Cargando asignaciones…');
    let response;
    try {
      response = await window.api?.teacherAssignments?.listOwn();
    } catch (error) {
      console.error('Error al cargar las asignaciones:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    assignments = response.teacherAssignments;
    isLoaded = true;
    fillFilterOptions();
    renderRows();
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Si lo que filtra no cambió (el
  // campo de año avisa cada tecla, aunque el año incompleto todavía no filtre, y Curso, cada clic
  // dentro de su panel), la tabla y la página quedan como están. Mientras carga o si la carga
  // falló, se guardan los valores sin reemplazar el mensaje de la tabla.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([filter, value]) => String(value) !== String(activeFilters[filter]));
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    if (isLoaded) renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadAssignments();
});
