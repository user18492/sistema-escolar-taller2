// Vista Inscripciones del Secretario: la tabla muestra las inscripciones vigentes (sin baja lógica)
// de la institución, de todos los ciclos lectivos y en cualquier estado, sin las de alumnos dados de
// baja, que llegan del proceso principal de a una página (window.api.enrollments.list). Los filtros
// de columna y la paginación se resuelven allá, sobre todas las inscripciones: la vista envía los
// filtros activos y la página, y recibe sus filas y el total que pasa los filtros, 10 por página,
// con <table-pagination>. Las opciones de los filtros Número de inscripción y Alumno son las mismas
// inscripciones y sus alumnos (window.api.enrollments.listFilterOptions).
// Nueva inscripción la crea (window.api.enrollments.create), siempre activa y con la fecha del día:
// el formulario ofrece los alumnos vigentes y activos de la institución sin una inscripción activa y
// sus cursos vigentes del ciclo lectivo actual, los del nivel educativo elegido
// (listEnrollableStudents, listEnrollableCourses). El resultado se avisa con un toast
// (toast.component.js): si se creó, la tabla pasa a la página donde quedó, con el total
// recalculado; si no, el modal sigue abierto con lo elegido.
// Editar solo cambia el estado: el modal pide la inscripción al abrirse (window.api.enrollments.get)
// para marcar su estado actual y guarda el elegido (window.api.enrollments.update). También se avisa
// con un toast: si se guardó, la tabla vuelve a pedir la página a la vista, con los mismos filtros;
// si no, el modal sigue abierto con el estado elegido.
// Eliminar pide confirmación en "Eliminar inscripción" (confirm-modal.component.js) y solo al
// confirmar da de baja la inscripción (window.api.enrollments.delete), que deja de listarse: la tabla
// vuelve a pedir la página a la vista con los mismos filtros, con el total recalculado, o la anterior
// si quedó vacía. El resultado también se avisa con un toast y el modal se cierra siempre.
// Imprimir comprobante (data-action="print") es solo visual por ahora: el clic no hace nada.

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
  // Texto de .dropdown-empty de los filtros Número de inscripción y Alumno cuando sus opciones
  // llegaron
  const NO_RESULTS_TEXT = numberHeader.querySelector('.dropdown-empty').textContent;

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

  // Opciones del filtro de `header`, antes de .dropdown-empty; column-filter.js las lee al usarlas.
  // `filter` es lo que filtra esa columna en activeFilters: al volver a llenarlas (después de un
  // alta o una baja), las elegidas siguen marcadas y, si alguna ya no llega (se dio de baja la
  // inscripción, u otra sesión dio de baja al alumno), deja de filtrar. El embudo se actualiza.
  const fillOptions = (header, filter, options) => {
    const list = header.querySelector('[role="listbox"]');
    const emptyState = list.querySelector('.dropdown-empty');
    emptyState.textContent = NO_RESULTS_TEXT;
    list.replaceChildren(...options, emptyState);
    const values = options.map((option) => Number(option.dataset.value));
    activeFilters[filter] = activeFilters[filter].filter((value) => values.includes(value));
    options.forEach((option) => {
      const isSelected = activeFilters[filter].includes(Number(option.dataset.value));
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
    header.dispatchEvent(new Event('column-filter-refresh'));
  };

  // Las opciones de los filtros llegaron alguna vez: si no llegan al volver a pedirlas, se
  // conservan las que había
  let hasFilterOptions = false;

  // Pide las opciones de Número de inscripción (el número, con el alumno debajo) y de Alumno (el
  // alumno, con su email debajo): todas las inscripciones que lista la tabla sin filtros y sus
  // alumnos, no solo los de la página a la vista. Se vuelven a pedir después de un alta, para sumar
  // la inscripción nueva y su alumno, y después de una baja, para quitarlos. Si no llegan la primera
  // vez, las dos listas quedan vacías con el motivo.
  async function loadFilterOptions() {
    let response;
    try {
      response = await window.api?.enrollments?.listFilterOptions();
    } catch (error) {
      console.error('Error al cargar las opciones de los filtros:', error);
    }
    if (!response?.ok) {
      if (hasFilterOptions) return;
      [numberHeader, studentHeader].forEach((header) => {
        header.querySelector('.dropdown-empty').textContent = OPTIONS_LOAD_ERROR;
      });
      return;
    }
    hasFilterOptions = true;
    fillOptions(numberHeader, 'enrollmentIds', response.enrollments.map((enrollment) =>
      createOption(enrollment.id, enrollment.number, fullName(enrollment.student))));
    fillOptions(studentHeader, 'studentIds', response.students.map((student) =>
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
  // Con `enrollmentId` (una inscripción recién creada), el proceso principal devuelve en cambio la
  // página donde quedó, si pasa los filtros. Devuelve las inscripciones que quedaron en la tabla, o
  // null si no llegaron o si un pedido posterior reemplazó a este.
  async function loadEnrollments(page, enrollmentId = null) {
    listRequestId += 1;
    const requestId = listRequestId;
    table.setAttribute('aria-busy', 'true');
    if (!tbody.querySelector('tr[data-enrollment-id]')) showMessage('Cargando inscripciones…');
    let response;
    try {
      response = await window.api?.enrollments?.list(activeFilters, page, pagination.pageSize, enrollmentId);
    } catch (error) {
      console.error('Error al cargar las inscripciones:', error);
    }
    if (requestId !== listRequestId) return null;
    table.setAttribute('aria-busy', 'false');
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return null;
    }
    pagination.update({ total: response.total, page: response.page });
    if (response.enrollments.length) tbody.replaceChildren(...response.enrollments.map(createRow));
    else showMessage(hasActiveFilters() ? 'Ninguna inscripción coincide con los filtros.' : 'No hay inscripciones registradas.');
    return response.enrollments;
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
  const enrollmentModal = enrollmentOverlay.querySelector('.modal');
  const enrollmentModalBody = enrollmentOverlay.querySelector('.modal-body');
  const openEnrollmentModalBtn = document.getElementById('openNewEnrollmentModalBtn');
  const cancelEnrollmentBtn = document.getElementById('cancelNewEnrollmentBtn');
  const createEnrollmentBtn = document.getElementById('createEnrollmentBtn');
  const courseOptionTemplate = document.getElementById('courseOptionTemplate');
  let isSaving = false;

  const MODAL_LEVEL_PLACEHOLDER = 'Seleccionar nivel educativo';
  const MODAL_COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const MODAL_COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';
  // Texto del botón principal, en reposo y mientras se espera la respuesta
  const CREATE_TEXT = createEnrollmentBtn.textContent;
  const CREATING_TEXT = 'Creando…';

  // Códigos con los que el proceso principal avisa que el alumno o el curso elegidos ya no se pueden
  // elegir (otra sesión los dio de baja, pasó al alumno a egresado o lo inscribió, o cambió el año):
  // las listas del formulario quedaron viejas y se vuelven a pedir la próxima vez que se abra el
  // modal. Mientras tanto, el formulario conserva lo elegido.
  const STALE_OPTION_CODES = [
    'STUDENT_NOT_FOUND',
    'STUDENT_DELETED',
    'STUDENT_NOT_ACTIVE',
    'STUDENT_ALREADY_ENROLLED',
    'COURSE_NOT_FOUND',
    'COURSE_DELETED',
    'COURSE_OUT_OF_SCHOOL_YEAR',
  ];

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // Descripción de un toast de éxito del alta o de la edición. `isShown` dice si la inscripción quedó
  // a la vista después de volver a pedir la tabla: si no (false), porque no coincide con los filtros
  // activos, se aclara; si la tabla no llegó (null), no.
  const withShownNote = (description, isShown) =>
    (isShown === false ? `${description} No se muestra en la tabla porque no coincide con los filtros aplicados.` : description);

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

  // PRIMARY o SECONDARY, o '' si todavía no se eligió
  const selectedLevel = () => modalLevelDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? '';

  function updateCreateButtonState() {
    const hasStudent = Boolean(modalStudentSelect.getValue());
    const hasLevel = Boolean(selectedLevel());
    const hasCourse = Boolean(modalCourseSelect.getValue());
    createEnrollmentBtn.disabled = !(hasStudent && hasLevel && hasCourse);
  }

  // ---------- Modal: alumnos y cursos que se pueden elegir ----------

  // Alumnos y cursos que ofrece el alta, como llegaron del proceso principal; null si no llegaron
  let enrollableStudents = null;
  let enrollableCourses = null;
  let isLoadingFormOptions = false;
  // Llegaron las dos listas y siguen al día: si no, se vuelven a pedir al abrir el modal
  let hasFormOptions = false;

  // "Álvarez, Camila", con su DNI debajo (48.123.456)
  const createStudentOption = (student) => createOption(student.id, fullName(student), formatDni(student.dni));

  // "1° A · Mañana": el nivel educativo ya se eligió en el campo anterior, y data-level filtra la
  // lista por él. Todos son del ciclo lectivo actual, así que no llevan el año.
  const createCourseOption = (course) => {
    const option = courseOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(course.id);
    option.dataset.level = course.educationLevel;
    option.querySelector('.option-name').textContent =
      `${course.gradeName} ${course.division} · ${shiftLabels[course.shift] ?? course.shift}`;
    return option;
  };

  // Lista `key` de la respuesta de `request`, o null si no llegó
  const requestOptions = async (request, key) => {
    let response;
    try {
      response = await request();
    } catch (error) {
      console.error('Error al cargar las opciones del formulario:', error);
    }
    return response?.ok ? response[key] : null;
  };

  // Alumno queda bloqueado, con el motivo, mientras su lista se carga, si no llegó o si llegó vacía
  const updateStudentField = () => {
    if (isLoadingFormOptions) modalStudentSelect.lock('Cargando alumnos…');
    else if (!enrollableStudents) modalStudentSelect.lock('No se pudieron cargar los alumnos');
    else if (!enrollableStudents.length) modalStudentSelect.lock('No hay alumnos para inscribir');
    else modalStudentSelect.unlock();
  };

  // Curso depende del nivel educativo: sin nivel queda bloqueado a la espera de uno y, con nivel,
  // muestra sus cursos o, si no hay ninguno para elegir, el motivo. Cada cambio de nivel descarta
  // el curso elegido.
  const updateCourseField = () => {
    const level = selectedLevel();
    modalCourseSelect.reset();
    modalCourseSelect.setGroupFilter(level);
    if (!level) modalCourseSelect.lock(MODAL_COURSE_LOCKED_PLACEHOLDER);
    else if (isLoadingFormOptions) modalCourseSelect.lock('Cargando cursos…');
    else if (!enrollableCourses) modalCourseSelect.lock('No se pudieron cargar los cursos');
    else if (!enrollableCourses.some((course) => course.educationLevel === level)) {
      modalCourseSelect.lock(`No hay cursos de ${levelLabels[level] ?? level} en el ciclo lectivo actual`);
    } else modalCourseSelect.unlock(MODAL_COURSE_UNLOCKED_PLACEHOLDER);
    updateCreateButtonState();
  };

  // Pide los alumnos que se pueden inscribir y los cursos del ciclo lectivo actual: las opciones de
  // Alumno y de Curso. Se piden al cargar la vista y se vuelven a pedir al abrir el modal si no
  // llegaron, si hubo un alta (el alumno inscripto deja de estar en Alumno), una baja (si era activa,
  // su alumno vuelve a estar) o si el proceso principal avisó que quedaron viejas. Mientras se espera, Alumno y Curso quedan bloqueados; el nivel
  // educativo elegido se conserva.
  async function loadFormOptions() {
    if (isLoadingFormOptions) return;
    isLoadingFormOptions = true;
    hasFormOptions = false;
    updateStudentField();
    updateCourseField();
    [enrollableStudents, enrollableCourses] = await Promise.all([
      requestOptions(() => window.api?.enrollments?.listEnrollableStudents(), 'students'),
      requestOptions(() => window.api?.enrollments?.listEnrollableCourses(), 'courses'),
    ]);
    isLoadingFormOptions = false;
    hasFormOptions = Boolean(enrollableStudents && enrollableCourses);
    modalStudentSelect.setOptions((enrollableStudents ?? []).map(createStudentOption));
    modalCourseSelect.setOptions((enrollableCourses ?? []).map(createCourseOption));
    updateStudentField();
    updateCourseField();
  }

  // ---------- Modal: formulario ----------

  modalStudentSelect.onSelect(updateCreateButtonState);
  modalCourseSelect.onSelect(updateCreateButtonState);

  // dropdown.component.js ya marcó el nivel elegido
  modalLevelDropdown.addEventListener('dropdown-change', updateCourseField);

  function resetEnrollmentForm() {
    modalStudentSelect.reset();
    updateStudentField();

    modalLevelOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    modalLevelLabel.textContent = MODAL_LEVEL_PLACEHOLDER;
    modalLevelLabel.classList.add('placeholder');

    updateCourseField();
  }

  // Mientras se espera la respuesta, el cuerpo del modal queda inerte, así lo enviado coincide con
  // lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled: conservan el foco,
  // como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    enrollmentModalBody.inert = saving;
    enrollmentModal.setAttribute('aria-busy', String(saving));
    [cancelEnrollmentBtn, createEnrollmentBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    createEnrollmentBtn.textContent = saving ? CREATING_TEXT : CREATE_TEXT;
  };

  function openEnrollmentModal() {
    resetEnrollmentForm();
    // Las listas no llegaron al cargar la vista, cambiaron con un alta o una baja o quedaron viejas:
    // se vuelven a pedir
    if (!hasFormOptions) loadFormOptions();
    closeAllDropdowns();
    closeAllSearchableMenus();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    enrollmentOverlay.classList.add('is-open');
    enrollmentModal.scrollTop = 0;
    // El primer campo o, si está bloqueado, Cancelar
    const studentChevron = modalStudentSelect.root.querySelector('.searchable-chevron');
    (studentChevron.disabled ? cancelEnrollmentBtn : studentChevron).focus();
  }

  function closeEnrollmentModal() {
    enrollmentOverlay.classList.remove('is-open');
    closeAllDropdowns();
    closeAllSearchableMenus();
    openEnrollmentModalBtn.focus();
  }

  // Después de un alta, la inscripción nueva y su alumno pasan a ser opciones de los filtros Número
  // de inscripción y Alumno (las elegidas siguen marcadas), y la tabla pasa a la página donde quedó,
  // con el total y la paginación recalculados. Si no coincide con los filtros activos, no se muestra
  // y se vuelve a pedir la página actual. Devuelve si quedó a la vista, o null si la tabla no se
  // pudo cargar.
  const refreshAfterCreate = async (enrollment) => {
    await loadFilterOptions();
    const shownEnrollments = await loadEnrollments(pagination.page, enrollment.id);
    return shownEnrollments && shownEnrollments.some(({ id }) => id === enrollment.id);
  };

  // "Se registró la inscripción INS-000041 de Camila Álvarez en 1° A, Mañana, Primaria."
  const createdDescription = ({ number, student, course }, isShown) =>
    withShownNote(`Se registró la inscripción ${number} de ${student.firstName} ${student.lastName} en ${courseName(course)}.`, isShown);

  // Crea la inscripción con lo elegido; el proceso principal vuelve a validar todo antes de
  // guardarla. Si la crea, la tabla se actualiza antes de liberar el modal (refreshAfterCreate), así
  // al cerrarse ya la muestra, y un toast lo avisa. Si no, el toast dice por qué y el modal sigue
  // abierto con lo elegido.
  const saveEnrollment = async () => {
    const data = {
      studentId: Number(modalStudentSelect.getValue()),
      educationLevel: selectedLevel(),
      courseId: Number(modalCourseSelect.getValue()),
    };
    setSaving(true);
    let response;
    try {
      response = await window.api?.enrollments?.create(data);
    } catch (error) {
      console.error('Error al crear la inscripción:', error);
    }
    const isShown = response?.ok ? await refreshAfterCreate(response.enrollment) : null;
    setSaving(false);

    if (response?.ok) {
      // El alumno inscripto ya no se puede elegir: las listas se vuelven a pedir al reabrir el modal
      hasFormOptions = false;
      closeEnrollmentModal();
      showToast({
        type: 'success',
        title: 'Inscripción creada',
        description: createdDescription(response.enrollment, isShown),
      });
      return;
    }
    const error = response?.error;
    if (STALE_OPTION_CODES.includes(error?.code)) hasFormOptions = false;
    showToast({ type: 'error', title: 'No se pudo crear la inscripción', description: errorDescription(error) });
  };

  openEnrollmentModalBtn.addEventListener('click', openEnrollmentModal);
  cancelEnrollmentBtn.addEventListener('click', () => {
    if (!isSaving) closeEnrollmentModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape cierra el modal si no hay un desplegable ni un buscador abiertos
  // (dropdown.component.js resuelve antes esa pulsación). Se escucha en el documento para que
  // funcione aunque el foco haya quedado fuera de un control. Mientras se guarda, ni Escape ni
  // Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && enrollmentOverlay.classList.contains('is-open') && !isSaving) closeEnrollmentModal();
  });

  createEnrollmentBtn.addEventListener('click', () => {
    if (isSaving) return;
    saveEnrollment();
  });

  loadFormOptions();

  // ---------- Modal: Editar inscripción ----------

  const editOverlay = document.getElementById('editEnrollmentOverlay');
  const editModal = editOverlay.querySelector('.modal');
  const editModalBody = editOverlay.querySelector('.modal-body');
  const cancelEditEnrollmentBtn = document.getElementById('cancelEditEnrollmentBtn');
  const saveEnrollmentBtn = document.getElementById('saveEnrollmentBtn');

  const statusDropdown = editOverlay.querySelector('[data-filter="edit-enrollment-status"]');
  const statusToggle = statusDropdown.querySelector('.dropdown-toggle');
  const statusLabel = statusDropdown.querySelector('.dropdown-label');
  const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');

  // Texto del botón principal, en reposo y mientras se espera la respuesta
  const SAVE_TEXT = saveEnrollmentBtn.textContent;
  const SAVING_TEXT = 'Guardando…';

  // Códigos con los que el proceso principal avisa que la inscripción ya no está vigente (otra
  // sesión la dio de baja): la fila quedó vieja y la página se vuelve a pedir
  const NO_LONGER_EDITABLE_CODES = ['ENROLLMENT_NOT_FOUND', 'ENROLLMENT_DELETED'];

  // inscripcion_id de la inscripción que se edita, tomado del data-enrollment-id de su fila
  let editingEnrollmentId = null;
  let isSavingEdit = false;
  // Ícono "Editar" que abrió el modal: recupera el foco al cerrarlo, si su fila sigue en la tabla
  let editTrigger = null;
  // Posición en la página de la fila del botón que abrió el último modal (Editar o Eliminar), solo
  // para devolver el foco a la que ocupe su lugar si esa fila ya no se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit o delete) de la fila que quedó en su lugar (o de la última de la
  // página), o "Nueva inscripción" si la tabla quedó sin inscripciones
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openEnrollmentModalBtn;
  };
  // Cambia cada vez que el modal se abre o se cierra: descarta la respuesta de get que llegue tarde,
  // de una inscripción que ya no se edita
  let editRequestId = 0;

  // ACTIVE, COMPLETED o CANCELLED, el estado marcado
  const selectedStatus = () => statusDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? '';

  // Estado bloqueado, sin ninguno marcado y con `text` en su etiqueta, y Guardar deshabilitado:
  // mientras llega la inscripción
  const lockStatus = (text) => {
    statusOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    statusDropdown.classList.add('is-locked');
    statusToggle.disabled = true;
    statusLabel.textContent = text;
    statusLabel.classList.add('placeholder');
    saveEnrollmentBtn.disabled = true;
  };

  // Marca `status` como dropdown.component.js marca la opción elegida, y habilita Estado y Guardar
  const showStatus = (status) => {
    statusOptions.forEach((option) => {
      const isSelected = option.dataset.value === status;
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
      if (isSelected) statusLabel.textContent = option.textContent.trim();
    });
    statusLabel.classList.remove('placeholder');
    statusDropdown.classList.remove('is-locked');
    statusToggle.disabled = false;
    saveEnrollmentBtn.disabled = false;
  };

  // Mientras se espera la respuesta, el cuerpo del modal queda inerte, como en Nueva inscripción
  const setEditSaving = (saving) => {
    isSavingEdit = saving;
    editModalBody.inert = saving;
    editModal.setAttribute('aria-busy', String(saving));
    [cancelEditEnrollmentBtn, saveEnrollmentBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    saveEnrollmentBtn.textContent = saving ? SAVING_TEXT : SAVE_TEXT;
  };

  // Pide la inscripción que se edita y marca su estado actual: el de la base, no el de la fila, que
  // puede haber quedado viejo. Si no llega, no hay nada que editar: el modal se cierra y un toast dice
  // por qué; si ya no está vigente, antes se vuelve a pedir la página de la tabla.
  async function loadEditingEnrollment() {
    const requestId = editRequestId;
    let response;
    try {
      response = await window.api?.enrollments?.get(editingEnrollmentId);
    } catch (error) {
      console.error('Error al cargar la inscripción:', error);
    }
    // Mientras se esperaba se cerró el modal
    if (requestId !== editRequestId) return;
    if (response?.ok) {
      showStatus(response.enrollment.status);
      // Mientras Estado estaba bloqueado, el foco quedó en Cancelar: pasa al campo, salvo que se haya
      // movido
      if (document.activeElement === cancelEditEnrollmentBtn) statusToggle.focus();
      return;
    }
    if (NO_LONGER_EDITABLE_CODES.includes(response?.error?.code)) {
      await loadEnrollments(pagination.page);
      if (requestId !== editRequestId) return;
    }
    closeEditModal();
    showToast({ type: 'error', title: 'No se pudo cargar la inscripción', description: errorDescription(response?.error) });
  }

  // `trigger` es el botón Editar de `row`: la inscripción se identifica solo por el
  // data-enrollment-id de la fila (el inscripcion_id), y su estado llega del proceso principal.
  function openEditModal(row, trigger) {
    editTrigger = trigger;
    editingEnrollmentId = Number(row.dataset.enrollmentId);
    triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    editRequestId += 1;
    lockStatus('Cargando estado…');

    closeAllDropdowns();
    closeAllSearchableMenus();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    editOverlay.classList.add('is-open');
    editModal.scrollTop = 0;
    // Estado está bloqueado hasta que llegue la inscripción (loadEditingEnrollment)
    cancelEditEnrollmentBtn.focus();
    loadEditingEnrollment();
  }

  // Si la tabla se volvió a dibujar (después de guardar, o porque la inscripción ya no está vigente),
  // el foco pasa a Editar en la fila de la inscripción o, si ya no se muestra, en la que quedó en su
  // lugar (o en la última de la página); sin filas, a Nueva inscripción
  const editFocusTarget = () => {
    if (editTrigger?.isConnected) return editTrigger;
    return tbody.querySelector(`tr[data-enrollment-id="${editingEnrollmentId}"] [data-action="edit"]`) ?? focusAfterRemoval('edit');
  };

  function closeEditModal() {
    editRequestId += 1;
    editOverlay.classList.remove('is-open');
    closeAllDropdowns();
    editFocusTarget().focus();
  }

  // "La inscripción INS-000012 de Camila Álvarez ahora está cancelada." o, si ya tenía ese estado,
  // "... ya estaba cancelada."
  const updatedToast = ({ number, student, status }, changed, isShown) => {
    const statusText = (statusLabels[status] ?? status).toLowerCase();
    const subject = `La inscripción ${number} de ${student.firstName} ${student.lastName}`;
    return changed
      ? { title: 'Inscripción actualizada', description: withShownNote(`${subject} ahora está ${statusText}.`, isShown) }
      : { title: 'Inscripción sin cambios', description: withShownNote(`${subject} ya estaba ${statusText}.`, isShown) };
  };

  // Guarda el estado elegido; el proceso principal vuelve a validar todo antes de guardarlo. Si lo
  // guarda (o si ya lo tenía), la tabla vuelve a pedir la página a la vista con los filtros aplicados
  // antes de liberar el modal, así al cerrarse ya muestra el estado nuevo, y un toast lo avisa. Si no,
  // el toast dice por qué y el modal sigue abierto con el estado elegido; si la inscripción ya no está
  // vigente, antes se vuelve a pedir la página.
  const saveEditedEnrollment = async () => {
    setEditSaving(true);
    let response;
    try {
      response = await window.api?.enrollments?.update(editingEnrollmentId, { status: selectedStatus() });
    } catch (error) {
      console.error('Error al guardar la inscripción:', error);
    }
    const error = response?.error;
    let isShown = null;
    if (response?.ok) {
      const shownEnrollments = await loadEnrollments(pagination.page);
      isShown = shownEnrollments && shownEnrollments.some(({ id }) => id === response.enrollment.id);
    } else if (NO_LONGER_EDITABLE_CODES.includes(error?.code)) {
      await loadEnrollments(pagination.page);
    }
    setEditSaving(false);

    if (response?.ok) {
      closeEditModal();
      showToast({ type: 'success', ...updatedToast(response.enrollment, response.changed, isShown) });
      return;
    }
    showToast({ type: 'error', title: 'No se pudo guardar la inscripción', description: errorDescription(error) });
  };

  // Por delegación: las filas se generan con cada página que llega del proceso principal
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openEditModal(button.closest('tr'), button);
  });

  cancelEditEnrollmentBtn.addEventListener('click', () => {
    if (!isSavingEdit) closeEditModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape: mismo criterio que en Nueva inscripción. Mientras se carga la inscripción sí lo cierra.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editOverlay.classList.contains('is-open') && !isSavingEdit) closeEditModal();
  });

  saveEnrollmentBtn.addEventListener('click', () => {
    if (isSavingEdit) return;
    saveEditedEnrollment();
  });

  // ---------- Modal: Eliminar inscripción ----------

  // Códigos con los que el proceso principal avisa que la inscripción ya no está vigente (no existe u
  // otra sesión la dio de baja): la fila quedó vieja y la tabla se vuelve a pedir
  const NO_LONGER_DELETABLE_CODES = ['ENROLLMENT_NOT_FOUND', 'ENROLLMENT_ALREADY_DELETED'];

  // Después de una baja, la inscripción deja de ser opción del filtro Número de inscripción, y su
  // alumno del filtro Alumno si no le queda otra (si estaban elegidos, dejan de filtrar: fillOptions),
  // y la tabla vuelve a pedir la página a la vista con los filtros aplicados: ya sin la inscripción y
  // con el total y la paginación recalculados. Si era la única fila de la última página, esa página
  // ya no existe y el proceso principal devuelve la anterior.
  const refreshAfterDelete = async () => {
    await loadFilterOptions();
    await loadEnrollments(pagination.page);
  };

  // "Se eliminó la inscripción INS-000041 de Camila Álvarez en 1° A, Mañana, Primaria."
  const deletedDescription = ({ number, student, course }) =>
    `Se eliminó la inscripción ${number} de ${student.firstName} ${student.lastName} en ${courseName(course)}.`;

  // El id sale del data-enrollment-id de la fila del botón (el inscripcion_id), no de su posición en
  // la tabla; el proceso principal vuelve a comprobar que la inscripción exista en la institución y
  // siga vigente. Si la da de baja, o si ya no estaba vigente, la tabla se actualiza antes de liberar
  // el modal, así al cerrarse ya no la muestra. Avisa el resultado con un toast y no resuelve ningún
  // mensaje, así el modal se cierra siempre.
  const deleteEnrollment = async (trigger) => {
    const row = trigger.closest('tr');
    let response;
    try {
      response = await window.api?.enrollments?.delete(Number(row?.dataset.enrollmentId));
    } catch (error) {
      console.error('Error al eliminar la inscripción:', error);
    }
    const error = response?.error;
    if (response?.ok || NO_LONGER_DELETABLE_CODES.includes(error?.code)) {
      // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
      triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
      await refreshAfterDelete();
    }

    if (response?.ok) {
      // Si era activa, ya no cuenta para la regla de una sola activa por alumno y su alumno vuelve a
      // poder inscribirse: las listas del alta se vuelven a pedir al reabrir el modal
      hasFormOptions = false;
      showToast({ type: 'success', title: 'Inscripción eliminada', description: deletedDescription(response.enrollment) });
      return;
    }
    showToast({ type: 'error', title: 'No se pudo eliminar la inscripción', description: errorDescription(error) });
  };

  // Componente compartido confirm-modal.component.js: lo abre el ícono Eliminar de cada fila, espera
  // la respuesta abierto y después se cierra; Cancelar o Escape lo cierran sin hacer nada. Si la fila
  // ya no está, el foco pasa a Eliminar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('deleteEnrollmentOverlay'), {
    beforeOpen: () => {
      closeAllDropdowns();
      closeAllSearchableMenus();
    },
    onConfirm: deleteEnrollment,
    fallbackFocus: () => focusAfterRemoval('delete'),
  });
});
