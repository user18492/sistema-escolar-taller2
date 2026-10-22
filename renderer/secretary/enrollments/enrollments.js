// Vista Inscripciones del Secretario: la tabla muestra las inscripciones vigentes (sin baja lógica)
// de la institución, de todos los ciclos lectivos, que llegan del proceso principal de a una página
// (window.api.enrollments.list). Los filtros de columna y la paginación se resuelven allá, sobre
// todas las inscripciones: la vista envía los filtros activos y la página, y recibe sus filas y el
// total que pasa los filtros, 10 por página, con <table-pagination>. Las opciones de los filtros
// Número de inscripción y Alumno son todas las inscripciones vigentes y sus alumnos
// (window.api.enrollments.listFilterOptions).
// Nueva inscripción, Editar y Eliminar siguen siendo maqueta: interacción puramente visual, sin
// guardar nada.

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  // Abrir un dropdown, hacer clic fuera de los buscadores o pulsar Escape cierra también los
  // buscadores (searchable-select.component.js).
  const { closeAllDropdowns } = setupDropdowns({
    onToggle: closeAllSearchableMenus,
    onDismiss: dismissSearchableMenus,
  });

  // Los textos truncados (Alumno) muestran su tooltip con el componente compartido
  // text-truncate.component.js.

  // ---------- Tabla: inscripciones de la institución ----------

  // Los filtros de Número de inscripción / Alumno / Curso / Estado viven en los encabezados
  // de la tabla y los gestiona el componente compartido column-filter.js; Curso incrusta
  // <course-filter>, el mismo filtro compuesto de Docencia.
  const table = document.querySelector('.enrollments-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('enrollmentRowTemplate');
  const optionTemplate = document.getElementById('enrollmentOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.enrollments-card table-pagination');
  const numberHeader = table.querySelector('th[data-filter="number"]');
  const studentHeader = table.querySelector('th[data-filter="student"]');
  // Curso: el componente del panel guarda los grados, las divisiones y los turnos elegidos
  // (course-filter.js)
  const courseFilter = table.querySelector('th[data-filter="course"] course-filter');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar las inscripciones. Intentá nuevamente.';
  const OPTIONS_LOAD_ERROR = 'No se pudieron cargar las opciones';

  // Textos de Estado, Turno y Nivel educativo tomados de las opciones del filtro Estado, de los
  // botones del filtro Curso y de las opciones de Nueva inscripción, para que la celda diga lo
  // mismo que ellos. Llegan como ACTIVE, COMPLETED o CANCELLED; MORNING o AFTERNOON, y PRIMARY o
  // SECONDARY.
  const labelsOf = (selector) => Object.fromEntries(
    Array.from(document.querySelectorAll(selector), (element) => [element.dataset.value, element.textContent.trim()])
  );
  const statusLabels = labelsOf('#statusFilter .dropdown-option');
  const shiftLabels = labelsOf('#courseFilter .course-filter-shift');
  const levelLabels = labelsOf('[data-filter="new-enrollment-level"] .dropdown-option');

  // Lo que filtra cada dato, con los nombres que espera el proceso principal: las inscripciones y
  // los alumnos elegidos (por su id); del curso, los grados marcados, las divisiones escritas y los
  // turnos activos, y los estados marcados. Vacío (nada elegido, "Todos" o sin texto) no filtra.
  const activeFilters = { enrollmentIds: [], studentIds: [], grades: [], divisions: [], shifts: [], statuses: [] };

  // Valores de activeFilters que fija cada columna, por su data-filter, después de un cambio: los
  // tres de Curso los da su componente y los demás llegan en el detalle de column-filter-change
  const FILTER_VALUES = {
    number: ({ values }) => ({ enrollmentIds: values.map(Number) }),
    student: ({ values }) => ({ studentIds: values.map(Number) }),
    course: () => ({
      grades: courseFilter.selectedGrades.map(({ level, name }) => ({ educationLevel: level, gradeName: name })),
      divisions: courseFilter.selectedDivisions,
      shifts: courseFilter.selectedShifts,
    }),
    status: ({ values }) => ({ statuses: values }),
  };

  const hasActiveFilters = () => Object.values(activeFilters).some((values) => values.length > 0);

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // "Apellido, Nombre"
  const fullName = (student) => `${student.lastName ?? ''}, ${student.firstName ?? ''}`;
  // "1° A, Mañana, Primaria"
  const courseName = (course) =>
    `${course.gradeName} ${course.division}, ${shiftLabels[course.shift] ?? course.shift}, ${levelLabels[course.educationLevel] ?? course.educationLevel}`;
  // La fecha llega como 'AAAA-MM-DD' y se muestra como DD/MM/AAAA
  const toDisplayDate = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('/') : '');

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // inscripcion_id en data-enrollment-id; el número de inscripción llega ya armado.
  const createRow = (enrollment) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.enrollmentId = String(enrollment.id);
    row.cells[0].textContent = enrollment.number;
    row.cells[1].querySelector('.text-truncate').textContent = fullName(enrollment.student);
    row.cells[2].textContent = courseName(enrollment.course);
    row.cells[3].textContent = toDisplayDate(enrollment.enrollmentDate);
    // <status-badge> lee sus atributos al conectarse: se fijan antes de insertar la fila
    const badge = row.querySelector('status-badge');
    badge.setAttribute('status', enrollment.status.toLowerCase());
    badge.setAttribute('label', statusLabels[enrollment.status] ?? enrollment.status);
    return row;
  };

  const createOption = (value, name, detail) => {
    const option = optionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(value);
    option.querySelector('.option-name').textContent = name;
    option.querySelector('.option-detail').textContent = detail;
    return option;
  };

  // Opciones del filtro de `header`, antes de .dropdown-empty; column-filter.js las lee al usarlas
  const fillOptions = (header, options) => {
    const list = header.querySelector('[role="listbox"]');
    list.replaceChildren(...options, list.querySelector('.dropdown-empty'));
  };

  // Pide las opciones de Número de inscripción (el número, con el alumno debajo) y de Alumno (el
  // alumno, con su email debajo): todas las inscripciones vigentes de la institución y sus
  // alumnos, no solo los de la página a la vista. Si no llegan, las dos listas quedan vacías con
  // el motivo.
  async function loadFilterOptions() {
    let response;
    try {
      response = await window.api?.enrollments?.listFilterOptions();
    } catch (error) {
      console.error('Error al cargar las opciones de los filtros:', error);
    }
    if (!response?.ok) {
      [numberHeader, studentHeader].forEach((header) => {
        header.querySelector('.dropdown-empty').textContent = OPTIONS_LOAD_ERROR;
      });
      return;
    }
    fillOptions(numberHeader, response.enrollments.map((enrollment) =>
      createOption(enrollment.id, enrollment.number, fullName(enrollment.student))));
    fillOptions(studentHeader, response.students.map((student) =>
      createOption(student.id, fullName(student), student.email)));
  }

  // Cambia con cada pedido de inscripciones: descarta la respuesta de uno anterior que llegue
  // tarde, con otra página u otros filtros
  let listRequestId = 0;

  // Pide la página `page` de las inscripciones que pasan los filtros activos: el proceso principal
  // filtra y pagina sobre todas, y devuelve las filas, el total filtrado y la página, que acota a
  // la última si la pedida ya no existe. Con eso se actualizan "Mostrando X-Y de Z" y los números
  // de página. Mientras se espera, la tabla conserva sus filas; si no tenía (al cargar la vista,
  // después de un error o sin resultados), muestra que está cargando.
  async function loadEnrollments(page) {
    listRequestId += 1;
    const requestId = listRequestId;
    table.setAttribute('aria-busy', 'true');
    if (!tbody.querySelector('tr[data-enrollment-id]')) showMessage('Cargando inscripciones…');
    let response;
    try {
      response = await window.api?.enrollments?.list(activeFilters, page, pagination.pageSize);
    } catch (error) {
      console.error('Error al cargar las inscripciones:', error);
    }
    if (requestId !== listRequestId) return;
    table.setAttribute('aria-busy', 'false');
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    pagination.update({ total: response.total, page: response.page });
    if (response.enrollments.length) tbody.replaceChildren(...response.enrollments.map(createRow));
    else showMessage(hasActiveFilters() ? 'Ninguna inscripción coincide con los filtros.' : 'No hay inscripciones registradas.');
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Si lo que filtra no cambió (Curso
  // avisa cada clic dentro de su panel), la tabla y la página quedan como están; si cambió, se
  // vuelven a pedir las inscripciones desde la página 1.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([filter, value]) => JSON.stringify(value) !== JSON.stringify(activeFilters[filter]));
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    loadEnrollments(1);
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', (event) => loadEnrollments(event.detail.page));

  loadFilterOptions();
  loadEnrollments(1);

  // ---------- Modal: Nueva inscripción ----------

  const enrollmentOverlay = document.getElementById('newEnrollmentOverlay');
  const openEnrollmentModalBtn = document.getElementById('openNewEnrollmentModalBtn');
  const cancelEnrollmentBtn = document.getElementById('cancelNewEnrollmentBtn');
  const createEnrollmentBtn = document.getElementById('createEnrollmentBtn');

  const MODAL_LEVEL_PLACEHOLDER = 'Seleccionar nivel educativo';
  const MODAL_COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const MODAL_COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';

  // Campos con búsqueda integrada (Alumno y Curso): componente compartido
  // searchable-select.component.js. El valor muestra solo el nombre, reiniciar el campo
  // conserva el filtro por nivel y cambiar de nivel vuelve a filtrar la lista en el momento.
  const searchableOptions = {
    onOpen: closeAllDropdowns,
    valueContent: 'name',
    resetClearsGroupFilter: false,
    filterOnGroupChange: true,
  };
  const modalStudentSelect = setupSearchableSelect(
    enrollmentOverlay.querySelector('[data-role="new-enrollment-student-select"]'),
    searchableOptions
  );
  const modalCourseSelect = setupSearchableSelect(
    enrollmentOverlay.querySelector('[data-role="new-enrollment-course-select"]'),
    searchableOptions
  );

  const modalLevelDropdown = enrollmentOverlay.querySelector('[data-filter="new-enrollment-level"]');
  const modalLevelLabel = modalLevelDropdown.querySelector('.dropdown-label');
  const modalLevelOptions = modalLevelDropdown.querySelectorAll('.dropdown-option');

  function updateCreateButtonState() {
    const hasStudent = Boolean(modalStudentSelect.getValue());
    const hasLevel = Boolean(modalLevelDropdown.querySelector('.dropdown-option.selected'));
    const hasCourse = Boolean(modalCourseSelect.getValue());
    createEnrollmentBtn.disabled = !(hasStudent && hasLevel && hasCourse);
  }

  modalStudentSelect.onSelect(updateCreateButtonState);
  modalCourseSelect.onSelect(updateCreateButtonState);

  modalCourseSelect.lock(MODAL_COURSE_LOCKED_PLACEHOLDER);

  // Curso depende del nivel: cambiar de nivel descarta el curso ya elegido.
  modalLevelOptions.forEach((option) => {
    option.addEventListener('click', () => {
      modalLevelLabel.classList.remove('placeholder');
      modalCourseSelect.reset();
      modalCourseSelect.setGroupFilter(option.dataset.value);
      modalCourseSelect.unlock(MODAL_COURSE_UNLOCKED_PLACEHOLDER);
      updateCreateButtonState();
    });
  });

  function resetEnrollmentForm() {
    modalStudentSelect.reset();

    modalLevelOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    modalLevelLabel.textContent = MODAL_LEVEL_PLACEHOLDER;
    modalLevelLabel.classList.add('placeholder');

    modalCourseSelect.reset();
    modalCourseSelect.setGroupFilter('');
    modalCourseSelect.lock(MODAL_COURSE_LOCKED_PLACEHOLDER);

    updateCreateButtonState();
  }

  function openEnrollmentModal() {
    resetEnrollmentForm();
    closeAllDropdowns();
    closeAllSearchableMenus();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    enrollmentOverlay.classList.add('is-open');
    enrollmentOverlay.querySelector('.modal').scrollTop = 0;
    modalStudentSelect.root.querySelector('.searchable-chevron').focus();
  }

  function closeEnrollmentModal() {
    enrollmentOverlay.classList.remove('is-open');
    closeAllDropdowns();
    closeAllSearchableMenus();
    openEnrollmentModalBtn.focus();
  }

  openEnrollmentModalBtn.addEventListener('click', openEnrollmentModal);
  cancelEnrollmentBtn.addEventListener('click', closeEnrollmentModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape cierra el modal si no hay un desplegable ni un buscador abiertos
  // (dropdown.component.js resuelve antes esa pulsación). Se escucha en el documento para que
  // funcione aunque el foco haya quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && enrollmentOverlay.classList.contains('is-open')) closeEnrollmentModal();
  });

  createEnrollmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeEnrollmentModal();
  });

  // ---------- Modal: Editar inscripción ----------

  const editOverlay = document.getElementById('editEnrollmentOverlay');
  const cancelEditEnrollmentBtn = document.getElementById('cancelEditEnrollmentBtn');
  const saveEnrollmentBtn = document.getElementById('saveEnrollmentBtn');

  const statusDropdown = editOverlay.querySelector('[data-filter="edit-enrollment-status"]');
  const statusLabel = statusDropdown.querySelector('.dropdown-label');
  const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');

  // Ícono "Editar" que abrió el modal: recupera el foco al cerrarlo.
  let editTrigger = null;

  // Marca la opción de estado cuyo texto coincide con el de la fila, replicando lo
  // que hace el listener del dropdown al elegirla con el ratón.
  function selectStatus(optionLabel) {
    statusOptions.forEach((option) => {
      const selected = option.textContent.trim() === optionLabel;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) statusLabel.textContent = option.textContent.trim();
    });
    statusLabel.classList.remove('placeholder');
  }

  statusOptions.forEach((option) => {
    option.addEventListener('click', () => {
      statusLabel.classList.remove('placeholder');
    });
  });

  function openEditModal(row, trigger) {
    editTrigger = trigger;
    selectStatus(row.cells[4].textContent.trim());

    closeAllDropdowns();
    closeAllSearchableMenus();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    editOverlay.classList.add('is-open');
    editOverlay.querySelector('.modal').scrollTop = 0;
    statusDropdown.querySelector('.dropdown-toggle').focus();
  }

  function closeEditModal() {
    editOverlay.classList.remove('is-open');
    closeAllDropdowns();
    editTrigger.focus();
  }

  // Por delegación: las filas se generan con cada página que llega del proceso principal
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openEditModal(button.closest('tr'), button);
  });

  cancelEditEnrollmentBtn.addEventListener('click', closeEditModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape: mismo criterio que en Nueva inscripción.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editOverlay.classList.contains('is-open')) closeEditModal();
  });

  saveEnrollmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeEditModal();
  });

  // ---------- Modal: Eliminar inscripción ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteEnrollmentOverlay'), {
    beforeOpen: () => {
      closeAllDropdowns();
      closeAllSearchableMenus();
    },
  });
});
