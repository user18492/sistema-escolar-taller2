// Vista Asignaciones del Profesor: la tabla muestra las asignaciones docentes vigentes a cargo del
// profesor de la sesión, que llegan del proceso principal (window.api.teacherAssignments.listOwn) de
// todos los ciclos lectivos, y los filtros de columna las filtran en memoria. Muestra un solo ciclo
// (shownSchoolYear, school-year.js): por defecto el actual, que llega de la base con la lista, con
// el filtro Ciclo lectivo sin aplicar, o el año elegido en ese filtro. Las opciones del filtro
// Materia son las materias de las asignaciones de ese ciclo, y se rearman al cambiarlo. La lista
// filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// "Gestionar" abre la vista de gestión de la asignación con el id de su fila.

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

  // Textos de Nivel educativo tomados de las filas de nivel del filtro Curso, para que la celda diga
  // lo mismo que ellas. Llegan como PRIMARY o SECONDARY; `key` es el data-* que guarda ese código.
  const labelsOf = (selector, key) => Object.fromEntries(
    Array.from(document.querySelectorAll(selector), (element) => [element.dataset[key], element.textContent.trim()])
  );
  const levelLabels = labelsOf('#courseFilter [data-level-header]', 'levelHeader');

  // En el orden en que llegan del proceso principal
  let assignments = [];
  let isLoaded = false;
  // El ciclo lectivo actual ({ year, today }), que llega con la lista: null hasta entonces
  let currentSchoolYear = null;

  // Un grado se repite entre niveles educativos (hay un 1° de primaria y otro de secundaria): se lo
  // identifica con los dos datos
  const gradeKey = (level, name) => `${level}:${name}`;

  // Lo que filtra cada dato de la asignación: las materias marcadas (por su id), el año completo
  // y, del curso, los grados marcados, las divisiones escritas y los turnos activos. Vacío (nada
  // elegido, "Todas" o sin texto) no filtra, salvo el año, que vacío muestra el ciclo actual.
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

  // Si la asignación pasa cada filtro con ese valor, que no está vacío (el del año, también vacío:
  // entonces es el del ciclo actual). Con los dos turnos activos pasan todas, igual que sin ninguno.
  const FILTER_MATCHERS = {
    grade: ({ course }, grades) => grades.includes(gradeKey(course.educationLevel, course.gradeName)),
    division: ({ course }, divisions) => divisions.includes(course.division),
    shift: ({ course }, shifts) => shifts.includes(course.shift),
    subject: ({ subject }, ids) => ids.includes(String(subject.id)),
    year: ({ course }, year) => course.schoolYear === shownSchoolYear(year, currentSchoolYear),
  };

  // Entre sí se combinan con Y; un filtro vacío no descarta nada, salvo el año, que siempre deja
  // solo las asignaciones del ciclo que se muestra
  const matchesFilters = (assignment) =>
    Object.entries(activeFilters).every(([filter, value]) =>
      (value.length === 0 && filter !== 'year') || FILTER_MATCHERS[filter](assignment, value));

  // Sin resultados: si no hay ningún filtro aplicado, el profesor no tiene asignaciones en el ciclo
  // actual
  const emptyMessage = () => (Object.values(activeFilters).some((value) => value.length > 0)
    ? 'Ninguna asignación coincide con los filtros.'
    : `No hay asignaciones a tu cargo en el ciclo lectivo ${currentSchoolYear.year}.`);

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // asignacion_docente_id en data-assignment-id.
  const createRow = ({ id, course, subject }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.assignmentId = String(id);
    const texts = [
      courseLabel(course),
      levelLabels[course.educationLevel] ?? course.educationLevel,
      subject.name,
      String(course.schoolYear),
    ];
    texts.forEach((text, index) => {
      row.cells[index].textContent = text;
    });
    // "Gestionar" le pasa por la URL a la vista de gestión solo el id de la asignación: esa vista
    // le pide sus datos al proceso principal. El href se asigna antes de conectar el
    // <manage-link>, que lo lee al generarse.
    const manageLink = row.querySelector('manage-link');
    const params = new URLSearchParams({ assignmentId: String(id) });
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

  // Las materias (por nombre) que tienen alguna asignación del ciclo que se muestra en la lista
  // cargada, una vez cada una: las opciones de su filtro
  const listedSubjects = () =>
    [...new Map(assignments
      .filter((assignment) => FILTER_MATCHERS.year(assignment, activeFilters.year))
      .map(({ subject }) => [subject.id, subject])).values()]
      .sort((a, b) => nameCollator.compare(a.name, b.name) || a.id - b.id);

  // Opciones de Materia, después de "Todas" (replaceColumnFilterOptions, column-filter.js). Se
  // rearman al cargar la lista y al cambiar el ciclo que se muestra: las elegidas que siguen siendo
  // opciones quedan marcadas y las demás dejan de filtrar.
  const fillFilterOptions = () => {
    activeFilters.subject = replaceColumnFilterOptions(subjectHeader, listedSubjects().map(createSubjectOption), activeFilters.subject);
  };

  // Muestra la página `page` (por defecto, la actual) de las asignaciones que pasan los filtros (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar un filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const visibleAssignments = assignments.filter(matchesFilters);
    const pageAssignments = pagination.slice(visibleAssignments, { page });
    if (pageAssignments.length) tbody.replaceChildren(...pageAssignments.map(createRow));
    else showMessage(emptyMessage());
  };

  // Pide la lista junto con el ciclo lectivo actual, el que se muestra por defecto, y, al llegar los
  // dos, arma las opciones de Materia y muestra las asignaciones con lo que se haya elegido mientras
  // tanto en Curso y Ciclo lectivo. Si no llega alguno, la tabla muestra el error.
  async function loadAssignments() {
    isLoaded = false;
    showMessage('Cargando asignaciones…');
    let response;
    let schoolYear = null;
    try {
      [response, schoolYear] = await Promise.all([window.api?.teacherAssignments?.listOwn(), loadCurrentSchoolYear()]);
    } catch (error) {
      console.error('Error al cargar las asignaciones:', error);
    }
    if (!response?.ok || !schoolYear) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    assignments = response.teacherAssignments;
    currentSchoolYear = schoolYear;
    isLoaded = true;
    fillFilterOptions();
    renderRows();
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Si lo que filtra no cambió (el
  // campo de año avisa cada tecla, aunque el año incompleto todavía no filtre, y Curso, cada clic
  // dentro de su panel), la tabla y la página quedan como están. Mientras carga o si la carga
  // falló, se guardan los valores sin reemplazar el mensaje de la tabla. Un cambio de ciclo
  // (elegir otro año o limpiar el filtro) rearma antes las opciones de Materia.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([filter, value]) => String(value) !== String(activeFilters[filter]));
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    if (!isLoaded) return;
    if ('year' in values) fillFilterOptions();
    renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadAssignments();
});
