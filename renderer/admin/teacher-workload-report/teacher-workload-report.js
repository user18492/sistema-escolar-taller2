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
// botón que abre un modal con el curso y la materia de cada una, una por línea dentro de un
// recuadro, como las celdas de materias de Materias sin docente por curso (list-modal.css).
// En el ciclo lectivo actual (y solo en él), cada asignación de la lista lleva Reasignar, también
// las de un profesor suspendido: abre "Editar asignación" con la asignación cargada y el nivel, el
// curso y la materia bloqueados, para elegir otro profesor ("Guardar cambios" queda deshabilitado
// mientras sea el mismo). El formulario es el de Docencia (<assignment-form>,
// assignment-form.component.js), que guarda y avisa con sus toasts, y se muestra en el mismo modal
// que la lista (setupListModal, list-modal.component.js): Cancelar vuelve a la lista. Al guardar, o
// si la asignación quedó vieja (ya no está vigente o el ciclo se cerró), el reporte se vuelve a
// pedir con los mismos filtros, en la misma página y con su resumen, y el modal vuelve a la lista
// actualizada de ese profesor, o se cierra si quedó sin asignaciones. Con SCHOOL_YEAR_CLOSED, antes
// se vuelve a pedir el ciclo actual.
// El modal se cierra con su X o con Escape, en cualquier paso, y el foco vuelve al botón que lo
// abrió (o al de la misma fila, si la tabla se volvió a dibujar).
// Un ciclo lectivo en el que la institución no tiene cursos (hasCourses, del proceso principal, sin
// mirar Nivel ni Turno) muestra solo "No existen registros…", sin el resumen, la tabla ni la
// paginación, en lugar de todos los profesores con 0. Un ciclo con cursos y profesores sin
// asignaciones se muestra igual que cualquier otro.

document.addEventListener('DOMContentLoaded', () => {
  // Apertura, cierre y selección de los desplegables del formulario (dropdown.component.js). Abrir
  // uno, hacer clic fuera de los buscadores o pulsar Escape cierra también los buscadores
  // (searchable-select.component.js).
  const { closeDropdown, closeAllDropdowns } = setupDropdowns({
    onToggle: closeAllSearchableMenus,
    onDismiss: dismissSearchableMenus,
  });

  const filterBar = document.querySelector('.report-filters');
  const card = document.querySelector('.workload-card');
  const table = card.querySelector('.data-table');
  const noDataMessage = card.querySelector('.report-message');
  const summaryCard = document.querySelector('.workload-summary-card');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('workloadRowTemplate');
  const summaryTemplate = document.getElementById('assignmentSummaryTemplate');
  // Los scripts de los componentes se cargan sin defer en <head>: acá ya están definidos y
  // conectados
  const pagination = document.querySelector('.workload-card table-pagination');
  const listOverlay = document.getElementById('assignmentListOverlay');
  const form = listOverlay.querySelector('assignment-form');

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
  // Los profesores del último reporte recibido, en el orden en que llegan del proceso principal, y
  // su ciclo lectivo (null hasta que llega)
  let teachers = [];
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

  // Reasignar se ofrece solo si el reporte que se muestra es del ciclo lectivo actual: el que pidió
  // shownYear() (mientras llega el de otro filtro, las filas siguen siendo del anterior)
  const isCurrentYear = () => reportSchoolYear !== null && reportSchoolYear === currentSchoolYear?.year;

  // "Ciclo lectivo · 2026", "Nivel · Primaria", "Turno · Todos"
  const renderFilterValues = () => {
    filterValue('year').textContent = currentSchoolYear ? String(shownYear()) : EMPTY_VALUE;
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

  // Con `hasNoData`, la vista muestra solo el mensaje de ciclo sin datos; si no, el resumen y la
  // tabla
  const setNoData = (hasNoData) => {
    card.classList.toggle('has-no-data', hasNoData);
    noDataMessage.hidden = !hasNoData;
    summaryCard.hidden = hasNoData;
  };

  // Cargando, error o sin resultados, en una única fila de todo el ancho, y el resumen vacío
  const showMessage = (message) => {
    setNoData(false);
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

  // ---------- Modal: asignaciones de un profesor y formulario ----------

  // El profesor (su id) de la lista que muestra el modal, para volver a armarla con el reporte
  // actualizado
  let modalTeacherId = null;

  // Si la tabla se volvió a dibujar mientras el modal estaba abierto, el foco pasa al botón de la
  // misma fila; si el profesor ya no está en la página o quedó sin asignaciones (sin botón), al
  // primero de la tabla y, si no hay ninguno, al botón del filtro Ciclo lectivo
  const focusAfterClose = (trigger) => {
    const teacherId = trigger?.closest('tr')?.dataset.teacherId;
    const sameRow = teacherId ? tbody.querySelector(`tr[data-teacher-id="${teacherId}"] .list-summary-button`) : null;
    return sameRow
      ?? tbody.querySelector('.list-summary-button')
      ?? filterBar.querySelector('[data-filter="year"] .column-filter-toggle');
  };

  const listModal = setupListModal(listOverlay, { form, focusAfterClose });

  // La asignación de la lista como la recibe el formulario: con el profesor de la fila y el ciclo
  // lectivo del reporte. El nivel, el curso y la materia quedan bloqueados.
  const formAssignment = (teacher, assignment) => ({
    id: assignment.id,
    teacher: { id: teacher.id, firstName: teacher.firstName, lastName: teacher.lastName },
    course: {
      id: assignment.courseId,
      educationLevel: assignment.educationLevel,
      schoolYear: reportSchoolYear,
      gradeName: assignment.gradeName,
      division: assignment.division,
      shift: assignment.shift,
    },
    subject: { id: assignment.subjectId, name: assignment.subjectName },
    hasEvaluations: false,
  });

  // Una asignación de la lista: el curso y la materia y, en el ciclo actual, Reasignar a la derecha
  // ("Reasignar 1° A · Mañana — Matemática"), que pasa al formulario en el mismo modal
  const createListItem = (teacher, assignment) => {
    const listItem = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'list-modal-text';
    text.textContent = assignmentText(assignment);
    listItem.append(text);
    if (!isCurrentYear()) return listItem;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-modal-action';
    button.textContent = 'Reasignar';
    button.setAttribute('aria-label', `Reasignar ${assignmentText(assignment)}`);
    button.addEventListener('click', () => {
      listModal.openForm(button, {
        assignment: formAssignment(teacher, assignment),
        lockCourseAndSubject: true,
        requireTeacherChange: true,
      }, { fromItem: true });
    });
    listItem.append(button);
    return listItem;
  };

  const openAssignmentList = (trigger, teacher) => {
    modalTeacherId = teacher.id;
    listModal.openList(trigger, {
      label: `Asignaciones de ${fullName(teacher)}`,
      items: teacher.assignments,
      renderItem: (assignment) => createListItem(teacher, assignment),
    });
  };

  // Después de guardar, o si la asignación quedó vieja: el reporte se vuelve a pedir en la misma
  // página, con su resumen, y el modal vuelve a la lista de ese profesor (o se cierra si quedó sin
  // asignaciones). Con SCHOOL_YEAR_CLOSED, antes se pide el ciclo actual: si cambió, Reasignar
  // desaparece.
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
    const teacher = teachers.find(({ id }) => id === modalTeacherId);
    listModal.showList(teacher ? teacher.assignments : []);
  };

  form.setup({
    closeDropdown,
    closeAllDropdowns,
    onSaved: () => refreshAfterChange(),
    onCancel: listModal.cancelForm,
    onStale: (code) => refreshAfterChange(code),
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

  // Pide el reporte con los filtros vigentes y lo muestra desde la página 1 o, con `keepPage`
  // (después de reasignar), en la página actual, acotada a la última, siempre con su resumen. Si en
  // el medio llega otro cambio, la respuesta de este pedido se descarta. Mientras se espera, la
  // tabla y el resumen conservan lo que muestran (las filas anteriores se pueden seguir paginando)
  // y los datos nuevos los reemplazan de una vez al llegar: vaciarlos en el medio achicaba la tabla
  // y, con la página desplazada, la hacía saltar. El "Cargando reporte…" queda solo para la primera
  // carga.
  async function loadReport({ keepPage = false } = {}) {
    const number = ++requestNumber;
    table.setAttribute('aria-busy', 'true');
    const schoolYear = shownYear();
    let response;
    try {
      response = await window.api?.reports?.getTeacherWorkload({
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
      teachers = [];
      reportSchoolYear = null;
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    const { hasCourses } = response.report;
    teachers = hasCourses ? response.report.teachers : [];
    reportSchoolYear = schoolYear;
    isLoaded = hasCourses;
    if (!hasCourses) {
      setNoData(true);
      return;
    }
    setNoData(false);
    renderRows(keepPage ? {} : { page: 1 });
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
