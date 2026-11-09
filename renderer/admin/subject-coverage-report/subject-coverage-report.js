// Reporte Materias sin docente por curso (Administrador), abierto desde Reportes. Por cada curso
// incompleto de un ciclo lectivo (alguna materia del plan de estudios de su grado sin docente o con
// el profesor suspendido), las materias del plan, cuántas tienen docente y cuáles no lo tienen o lo
// tienen suspendido (window.api.reports.getSubjectCoverage). Los cursos completos no aparecen.
// Los filtros se aplican en el proceso principal: con cada cambio de la barra (Ciclo lectivo,
// Nivel y Turno, column-filter.js), la vista vuelve a pedir el reporte y vuelve a la página 1.
// El ciclo lectivo es el actual por defecto, con el campo
// AAAA vacío, o el año completo que se escriba (shownSchoolYear, school-year.js); la vista manda
// siempre el año resuelto. Las filas se paginan en memoria, 10 por página, con <table-pagination>.
// Cada celda de "Sin docente" y "Con docente suspendido" se muestra según cuántas materias tenga:
// ninguna, "—"; una, la materia (con el docente suspendido entre paréntesis); dos o más, la
// cantidad ("5 materias") y un botón que abre un modal con la lista completa, una por línea, dentro
// de un recuadro.
// En el ciclo lectivo actual (y solo en él), cada materia lleva su acción: en "Sin docente",
// Asignar, que abre "Nueva asignación" con el nivel, el curso y la materia cargados y bloqueados; en
// "Con docente suspendido", Reasignar, que abre "Editar asignación" de esa asignación con los
// mismos campos bloqueados, para elegir otro profesor. El formulario es el de Docencia
// (<assignment-form>, assignment-form.component.js), que guarda y avisa con sus toasts, y se
// muestra en el mismo modal que la lista (setupListModal, list-modal.component.js): Cancelar vuelve
// a la lista. En la celda con una sola materia, la acción va al lado y el modal se abre directo en
// el formulario (Cancelar lo cierra). Al guardar, o si lo elegido quedó viejo (otra sesión asignó la
// materia, la asignación ya no está vigente o el ciclo se cerró), el reporte se vuelve a pedir con
// los mismos filtros y en la misma página, y el modal vuelve a la lista actualizada de ese curso y
// esa columna, o se cierra si quedó vacía, si el curso ya no está en el reporte o si se había
// abierto directo en el formulario. Con SCHOOL_YEAR_CLOSED, antes se vuelve a pedir el ciclo actual.
// El modal se cierra con su X o con Escape, en cualquier paso, y el foco vuelve al botón que lo
// abrió (o al de la misma celda, si la tabla se volvió a dibujar).
// Un ciclo lectivo en el que la institución no tiene cursos (hasCourses, del proceso principal, sin
// mirar Nivel ni Turno) muestra solo "No existen registros…", sin la tabla ni la paginación. Un
// ciclo con cursos y ninguno incompleto sigue mostrando la tabla con su mensaje.

document.addEventListener('DOMContentLoaded', () => {
  // Apertura, cierre y selección de los desplegables del formulario (dropdown.component.js). Abrir
  // uno, hacer clic fuera de los buscadores o pulsar Escape cierra también los buscadores
  // (searchable-select.component.js).
  const { closeDropdown, closeAllDropdowns } = setupDropdowns({
    onToggle: closeAllSearchableMenus,
    onDismiss: dismissSearchableMenus,
  });

  const filterBar = document.querySelector('.report-filters');
  const card = document.querySelector('.coverage-card');
  const table = card.querySelector('.data-table');
  const noDataMessage = card.querySelector('.report-message');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('coverageRowTemplate');
  const summaryTemplate = document.getElementById('subjectSummaryTemplate');
  const singleTemplate = document.getElementById('subjectSingleTemplate');
  // Los scripts de los componentes se cargan sin defer en <head>: acá ya están definidos y
  // conectados
  const pagination = document.querySelector('.coverage-card table-pagination');
  const listOverlay = document.getElementById('subjectListOverlay');
  const form = listOverlay.querySelector('assignment-form');

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
  // Las filas del último reporte recibido, en el orden en que llegan del proceso principal, y su
  // ciclo lectivo (null hasta que llega)
  let courses = [];
  let reportSchoolYear = null;
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

  // El ciclo que muestra el reporte (el del filtro o el actual)
  const shownYear = () => shownSchoolYear(activeFilters.year, currentSchoolYear);

  // Asignar y Reasignar se ofrecen solo si el reporte que se muestra es del ciclo lectivo actual:
  // el que pidió shownYear() (mientras llega el de otro filtro, las filas siguen siendo del anterior)
  const isCurrentYear = () => reportSchoolYear !== null && reportSchoolYear === currentSchoolYear?.year;

  // "Ciclo lectivo · 2026", "Nivel · Primaria", "Turno · Todos"
  const renderFilterValues = () => {
    filterValue('year').textContent = currentSchoolYear ? String(shownYear()) : EMPTY_VALUE;
    filterValue('level').textContent = levelLabels[activeFilters.level] ?? ALL_LABEL;
    filterValue('shift').textContent = shiftLabels[activeFilters.shift] ?? ALL_LABEL;
  };

  // Con `hasNoData`, la card muestra solo el mensaje de ciclo sin datos; si no, la tabla
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

  // "1° A · Mañana", como en Docencia
  const courseName = (course) => `${course.gradeName} ${course.division} · ${shiftLabels[course.shift] ?? course.shift}`;

  // El curso de una fila como lo recibe el formulario: con el ciclo lectivo del reporte
  const formCourse = (course) => ({
    id: course.id,
    educationLevel: course.educationLevel,
    schoolYear: reportSchoolYear,
    gradeName: course.gradeName,
    division: course.division,
    shift: course.shift,
  });

  // ---------- Columnas de materias ----------

  // Lo que muestra cada columna de materias: la etiqueta del botón y del modal ("las 5 materias
  // sin docente de 1° A · Mañana"), las materias de la fila, como { subjectName, teacherName } y
  // los ids del reporte, y su acción en el ciclo actual: el texto y lo que abre el formulario
  const SUBJECT_COLUMNS = [
    {
      selector: '.unassigned-subjects',
      description: 'sin docente',
      items: (course) => course.unassignedSubjects,
      action: 'Asignar',
      // Nueva asignación con el curso y la materia precargados (y bloqueados)
      formOptions: (course, item) => ({
        preset: { course: formCourse(course), subject: { id: item.subjectId, name: item.subjectName } },
      }),
    },
    {
      selector: '.suspended-subjects',
      description: 'con docente suspendido',
      items: (course) => course.suspendedSubjects,
      action: 'Reasignar',
      // Editar la asignación del profesor suspendido, con el curso y la materia bloqueados. El
      // formulario no ofrece al suspendido y lo nombra en una aclaración.
      formOptions: (course, item) => ({
        assignment: {
          id: item.teacherAssignmentId,
          teacher: item.teacher,
          course: formCourse(course),
          subject: { id: item.subjectId, name: item.subjectName },
          hasEvaluations: false,
        },
        lockCourseAndSubject: true,
      }),
    },
  ];

  const subjectText = ({ subjectName, teacherName }) => (teacherName ? `${subjectName} (${teacherName})` : subjectName);

  // ---------- Modal: lista de materias y formulario ----------

  // El curso (por su id) y la columna de lo que muestra el modal, para volver a armar la lista con
  // el reporte actualizado
  let modalSource = null;

  // Si la tabla se volvió a dibujar mientras el modal estaba abierto, el foco pasa al botón de la
  // misma celda (el de la lista o la acción) en la fila nueva; si el curso ya no está, al primero
  // de la tabla y, si no hay ninguno, al botón del filtro Ciclo lectivo
  const focusAfterClose = (trigger) => {
    const courseId = trigger?.closest('tr')?.dataset.courseId;
    const column = SUBJECT_COLUMNS.find(({ selector }) => trigger?.closest(selector));
    const sameCell = courseId && column ? tbody.querySelector(`tr[data-course-id="${courseId}"] ${column.selector} button`) : null;
    return sameCell
      ?? tbody.querySelector('.list-summary-button, .list-modal-action')
      ?? filterBar.querySelector('[data-filter="year"] .column-filter-toggle');
  };

  const listModal = setupListModal(listOverlay, { form, focusAfterClose });

  // La acción de una materia ("Asignar Lengua en 1° A · Mañana"): abre el formulario en el modal.
  // `fromItem`, si está en la lista del modal; si no, en la celda.
  const createAction = (course, column, item, { fromItem }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-modal-action';
    button.textContent = column.action;
    button.setAttribute('aria-label', `${column.action} ${item.subjectName} en ${courseName(course)}`);
    button.addEventListener('click', () => {
      if (!fromItem) modalSource = { courseId: course.id, column };
      listModal.openForm(button, column.formOptions(course, item), { fromItem });
    });
    return button;
  };

  // Una materia de la lista: su nombre y, si tiene el docente suspendido, el de él al lado; en el
  // ciclo actual, con su acción a la derecha
  const createListItem = (course, column, item) => {
    const listItem = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'list-modal-text';
    text.textContent = item.subjectName;
    if (item.teacherName) {
      const teacher = document.createElement('span');
      teacher.className = 'list-modal-note';
      teacher.textContent = ` (${item.teacherName})`;
      text.append(teacher);
    }
    listItem.append(text);
    if (isCurrentYear()) listItem.append(createAction(course, column, item, { fromItem: true }));
    return listItem;
  };

  // Después de guardar, o si lo elegido quedó viejo: el reporte se vuelve a pedir en la misma página
  // y el modal vuelve a la lista de ese curso y esa columna (o se cierra). Con SCHOOL_YEAR_CLOSED,
  // antes se pide el ciclo actual: si cambió, las acciones desaparecen.
  const refreshAfterChange = async (code = null) => {
    if (code === 'SCHOOL_YEAR_CLOSED') {
      const schoolYear = await loadCurrentSchoolYear();
      if (schoolYear) {
        currentSchoolYear = schoolYear;
        form.setCurrentSchoolYear(schoolYear);
        renderFilterValues();
      }
    }
    await loadReport({ keepPage: true });
    const course = courses.find(({ id }) => id === modalSource?.courseId);
    listModal.showList(course ? modalSource.column.items(course) : []);
  };

  form.setup({
    closeDropdown,
    closeAllDropdowns,
    onSaved: () => refreshAfterChange(),
    onCancel: listModal.cancelForm,
    onStale: (code) => refreshAfterChange(code),
  });

  // ---------- Filas ----------

  // Ninguna materia: "—". Una: la materia y, en el ciclo actual, su acción al lado. Dos o más: la
  // cantidad y el botón que abre el modal.
  const fillSubjectCell = (cell, course, column) => {
    const items = column.items(course);
    if (items.length < 2) {
      if (!items.length || !isCurrentYear()) {
        cell.textContent = items.length ? subjectText(items[0]) : EMPTY_VALUE;
        return;
      }
      const single = singleTemplate.content.firstElementChild.cloneNode(true);
      single.querySelector('.subject-single-text').textContent = subjectText(items[0]);
      single.append(createAction(course, column, items[0], { fromItem: false }));
      cell.replaceChildren(single);
      return;
    }
    const summary = summaryTemplate.content.firstElementChild.cloneNode(true);
    summary.querySelector('.list-summary-count').textContent = `${items.length} materias`;
    const button = summary.querySelector('.list-summary-button');
    const title = `Ver las ${items.length} materias ${column.description}`;
    const label = `Materias ${column.description} de ${courseName(course)}`;
    button.title = title;
    button.setAttribute('aria-label', `${title} de ${courseName(course)}`);
    button.addEventListener('click', () => {
      modalSource = { courseId: course.id, column };
      listModal.openList(button, { label, items, renderItem: (item) => createListItem(course, column, item) });
    });
    cell.replaceChildren(summary);
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // curso_id en data-course-id.
  const createRow = (course) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.courseId = String(course.id);
    row.cells[0].textContent = courseName(course);
    row.cells[1].textContent = levelLabels[course.educationLevel] ?? course.educationLevel;
    row.cells[2].textContent = String(course.subjectCount);
    row.cells[3].textContent = String(course.assignedCount);
    SUBJECT_COLUMNS.forEach((column) => fillSubjectCell(row.querySelector(column.selector), course, column));
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
  // (después de guardar una asignación), en la página actual, acotada a la última. Si en el medio
  // llega otro cambio, la respuesta de este pedido se descarta. Mientras se espera, la tabla
  // conserva lo que muestra (las filas anteriores, que se pueden seguir paginando, o su mensaje) y
  // las filas nuevas la reemplazan de una vez al llegar: vaciarla en el medio la achicaba y, con la
  // página desplazada, la hacía saltar. El "Cargando reporte…" queda solo para la primera carga.
  async function loadReport({ keepPage = false } = {}) {
    const number = ++requestNumber;
    table.setAttribute('aria-busy', 'true');
    const schoolYear = shownYear();
    let response;
    try {
      response = await window.api?.reports?.getSubjectCoverage({
        schoolYear,
        educationLevel: activeFilters.level,
        shift: activeFilters.shift,
      });
    } catch (error) {
      console.error('Error al cargar el reporte:', error);
    }
    if (number !== requestNumber) return;
    table.setAttribute('aria-busy', 'false');
    if (!response?.ok) {
      isLoaded = false;
      courses = [];
      reportSchoolYear = null;
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    const { hasCourses } = response.report;
    courses = hasCourses ? response.report.courses : [];
    reportSchoolYear = schoolYear;
    isLoaded = hasCourses;
    if (!hasCourses) {
      setNoData(true);
      return;
    }
    setNoData(false);
    renderRows(keepPage ? {} : { page: 1 });
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

  // Los profesores activos y los cursos del ciclo en curso que ofrece el formulario
  form.reloadOptions();

  // Primero el ciclo lectivo actual, de la base: sin él no se sabe qué ciclo pedir
  (async () => {
    showMessage('Cargando reporte…');
    currentSchoolYear = await loadCurrentSchoolYear();
    if (!currentSchoolYear) {
      showMessage(GENERIC_LOAD_ERROR);
      return;
    }
    form.setCurrentSchoolYear(currentSchoolYear);
    renderFilterValues();
    loadReport();
  })();
});
