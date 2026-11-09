// Vista Inscripciones del Secretario: la tabla muestra las inscripciones vigentes (sin baja lógica)
// de la institución, en cualquier estado, sin las de alumnos dados de baja, que llegan del proceso
// principal de a una página (window.api.enrollments.list). Los filtros de columna y la paginación se
// resuelven allá: la vista envía los filtros activos y la página, y recibe sus filas y el total que
// pasa los filtros, 10 por página, con <table-pagination>. Muestra un solo ciclo lectivo
// (shownSchoolYear, school-year.js), por el año de la fecha de inscripción, que es el ciclo del
// curso: por defecto el actual, con el año del filtro Fecha de inscripción vacío (sin aplicar), o el
// año escrito en ese filtro. Las opciones de los filtros Número de inscripción y Alumno son las
// inscripciones de ese ciclo y sus alumnos (window.api.enrollments.listFilterOptions), y se vuelven a
// pedir al cambiarlo.
// Nueva inscripción la crea (window.api.enrollments.create), siempre activa y con la fecha del día,
// con el formulario compartido <enrollment-form> (enrollment-form.component.js), que ofrece los
// alumnos vigentes y activos de la institución sin una inscripción activa y sus cursos vigentes del
// ciclo lectivo actual, los del nivel educativo elegido, y avisa el resultado con un toast
// (toast.component.js): si se creó, la tabla pasa a la página donde quedó, con el total
// recalculado; si no, el modal sigue abierto con lo elegido.
// Editar solo cambia el estado: el modal pide la inscripción al abrirse (window.api.enrollments.get)
// para marcar su estado actual y guarda el elegido (window.api.enrollments.update). También se avisa
// con un toast: si se guardó, la tabla vuelve a pedir la página a la vista, con los mismos filtros;
// si no, el modal sigue abierto con el estado elegido.
// Eliminar pide confirmación en "Eliminar inscripción" (confirm-modal.component.js) y solo al
// confirmar da de baja la inscripción (window.api.enrollments.delete), que deja de listarse: la tabla
// vuelve a pedir la página a la vista con los mismos filtros, con el total recalculado, o la anterior
// si quedó vacía. El resultado también se avisa con un toast y el modal se cierra siempre. Una
// inscripción con calificaciones no se elimina: su Eliminar está deshabilitado, con el motivo.
// Imprimir comprobante (data-action="print") le pide al proceso principal que genere el comprobante
// en PDF y lo abra con el visor de PDF predeterminado (window.api.enrollments.openReceipt), desde
// donde se imprime o se guarda. Si no se pudo, lo avisa con un toast.
// Ver promedios (data-action="averages") abre la vista Promedios de esa inscripción
// (../enrollment-averages/, con ?enrollmentId=). Está deshabilitado en una cancelada, que no tiene
// promedios.
// El ciclo lectivo actual llega con cada página, de la base (school-year.js): las inscripciones de
// un ciclo cerrado se ven en solo lectura, con Editar y Eliminar deshabilitados, y Ver promedios e
// Imprimir habilitados.

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

  // Los filtros de Número de inscripción / Alumno / Curso / Fecha de inscripción / Estado viven en
  // los encabezados de la tabla y los gestiona el componente compartido column-filter.js; Curso
  // incrusta <course-filter>, el mismo filtro compuesto de Docencia, y Fecha de inscripción tiene un
  // campo para el día, otro para el mes y otro para el año, cada uno opcional.
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
  // De la fecha de inscripción, el día, el mes y el año escritos, cada uno por separado: null si su
  // campo está vacío o incompleto. El año null no deja de filtrar: muestra el ciclo actual
  // (listFilters).
  const NO_DATE = { day: null, month: null, year: null };
  const activeFilters = {
    enrollmentIds: [],
    studentIds: [],
    grades: [],
    divisions: [],
    shifts: [],
    statuses: [],
    enrollmentDate: NO_DATE,
  };

  // Parte de la fecha que filtra: el número escrito ('05' → 5) o null si el campo no filtra
  const toDatePart = (text) => (text ? Number(text) : null);

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
    date: ({ texts }) => ({
      enrollmentDate: { day: toDatePart(texts.day), month: toDatePart(texts.month), year: toDatePart(texts.year) },
    }),
  };

  const hasActiveFilters = () =>
    Object.entries(activeFilters).some(([filter, value]) =>
      (filter === 'enrollmentDate' ? Object.values(value).some((part) => part !== null) : value.length > 0));

  // Los filtros que se envían al proceso principal: los activos, con el año del ciclo que se muestra
  // (el escrito o, sin él, el de `schoolYear`, el ciclo actual)
  const listFilters = (schoolYear) => ({
    ...activeFilters,
    enrollmentDate: { ...activeFilters.enrollmentDate, year: shownSchoolYear(activeFilters.enrollmentDate.year, schoolYear) },
  });

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

  // El ciclo lectivo actual ({ year, today }), que llega con cada página: null hasta la primera
  let currentSchoolYear = null;

  // Motivo de Eliminar deshabilitado en una inscripción con calificaciones vigentes (hasScores)
  const HAS_SCORES_TITLE = 'No se puede eliminar: la inscripción tiene calificaciones.';
  // Motivo de Ver promedios deshabilitado en una inscripción cancelada
  const CANCELLED_AVERAGES_TITLE = 'La inscripción está cancelada: no tiene promedios.';

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // inscripcion_id en data-enrollment-id; el número de inscripción llega ya armado. La de una
  // inscripción de un ciclo cerrado lleva Editar y Eliminar deshabilitados, y la de una con
  // calificaciones, solo Eliminar; la de una cancelada, además, Ver promedios. Todos con el motivo
  // como title; <row-actions> lo lee al conectarse.
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
    const { schoolYear } = enrollment.course;
    const rowActions = row.querySelector('row-actions');
    if (schoolYear < currentSchoolYear.year) {
      rowActions.setAttribute('read-only-title', closedSchoolYearTitle(schoolYear));
    } else if (enrollment.hasScores) {
      rowActions.setAttribute('delete-disabled-title', HAS_SCORES_TITLE);
    }
    if (enrollment.status === 'CANCELLED') {
      rowActions.setAttribute('averages-disabled-title', CANCELLED_AVERAGES_TITLE);
    }
    return row;
  };

  const createOption = (value, name, detail) => {
    const option = optionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(value);
    option.querySelector('.option-name').textContent = name;
    option.querySelector('.option-detail').textContent = detail;
    return option;
  };

  // Opciones del filtro de `header`, antes de .dropdown-empty (replaceColumnFilterOptions,
  // column-filter.js). `filter` es lo que filtra esa columna en activeFilters: al volver a llenarlas
  // (al cambiar de ciclo, o después de un alta o una baja), las elegidas siguen marcadas y, si alguna
  // ya no llega (es de otro ciclo, se dio de baja la inscripción u otra sesión dio de baja al
  // alumno), deja de filtrar. El embudo se actualiza.
  const fillOptions = (header, filter, options) => {
    header.querySelector('.dropdown-empty').textContent = NO_RESULTS_TEXT;
    activeFilters[filter] = replaceColumnFilterOptions(header, options, activeFilters[filter].map(String)).map(Number);
  };

  // El año del ciclo cuyas opciones muestran los filtros Número de inscripción y Alumno: null si
  // todavía no llegaron o si no llegaron las del último ciclo pedido
  let optionsYear = null;
  // Cambia con cada pedido de opciones: descarta la respuesta de uno anterior que llegue tarde, con
  // otro ciclo
  let optionsRequestId = 0;

  // Pide las opciones de Número de inscripción (el número, con el alumno debajo) y de Alumno (el
  // alumno, con su email debajo): las inscripciones del ciclo que muestra la tabla (sin los demás
  // filtros) y sus alumnos, no solo los de la página a la vista. Se vuelven a pedir al cambiar de
  // ciclo, después de un alta, para sumar la inscripción nueva y su alumno, y después de una baja,
  // para quitarlos. Si no llegan, se conservan las que había si son de ese mismo ciclo; si no, las
  // dos listas quedan vacías con el motivo y lo elegido en ellas deja de filtrar, para que la tabla
  // no quede filtrada por inscripciones o alumnos de otro ciclo.
  async function loadFilterOptions() {
    optionsRequestId += 1;
    const requestId = optionsRequestId;
    let response;
    let year = null;
    try {
      const schoolYear = await loadCurrentSchoolYear();
      if (schoolYear) {
        year = shownSchoolYear(activeFilters.enrollmentDate.year, schoolYear);
        response = await window.api?.enrollments?.listFilterOptions(year);
      }
    } catch (error) {
      console.error('Error al cargar las opciones de los filtros:', error);
    }
    if (requestId !== optionsRequestId) return;
    if (!response?.ok) {
      if (optionsYear !== null && optionsYear === year) return;
      optionsYear = null;
      fillOptions(numberHeader, 'enrollmentIds', []);
      fillOptions(studentHeader, 'studentIds', []);
      [numberHeader, studentHeader].forEach((header) => {
        header.querySelector('.dropdown-empty').textContent = OPTIONS_LOAD_ERROR;
      });
      return;
    }
    optionsYear = year;
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
  // página donde quedó, si pasa los filtros. Antes de la página se pide el ciclo lectivo actual, el
  // que se muestra sin un año escrito y el que dice qué inscripciones son de solo lectura: si no
  // llega alguno de los dos, la tabla muestra el error. Devuelve las inscripciones que quedaron en la
  // tabla, o null si no llegaron o si un pedido posterior reemplazó a este.
  async function loadEnrollments(page, enrollmentId = null) {
    listRequestId += 1;
    const requestId = listRequestId;
    table.setAttribute('aria-busy', 'true');
    if (!tbody.querySelector('tr[data-enrollment-id]')) showMessage('Cargando inscripciones…');
    let response;
    let schoolYear = null;
    try {
      schoolYear = await loadCurrentSchoolYear();
      if (schoolYear) {
        response = await window.api?.enrollments?.list(listFilters(schoolYear), page, pagination.pageSize, enrollmentId);
      }
    } catch (error) {
      console.error('Error al cargar las inscripciones:', error);
    }
    if (requestId !== listRequestId) return null;
    table.setAttribute('aria-busy', 'false');
    if (!response?.ok || !schoolYear) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return null;
    }
    currentSchoolYear = schoolYear;
    pagination.update({ total: response.total, page: response.page });
    if (response.enrollments.length) tbody.replaceChildren(...response.enrollments.map(createRow));
    else showMessage(hasActiveFilters() ? 'Ninguna inscripción coincide con los filtros.' : `No hay inscripciones del ciclo lectivo ${schoolYear.year}.`);
    return response.enrollments;
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Si lo que filtra no cambió (Curso
  // avisa cada clic dentro de su panel, y Fecha de inscripción, cada tecla, aunque un día, un mes o
  // un año incompleto todavía no filtre), la tabla y la página quedan como están; si cambió, se
  // vuelven a pedir las inscripciones desde la página 1. Si cambió el ciclo (otro año escrito, o el
  // actual al borrarlo o con "Limpiar filtro"), antes se piden sus opciones de Número de inscripción
  // y Alumno: así lo elegido que no es de ese ciclo deja de filtrar antes de pedir la página.
  table.tHead.addEventListener('column-filter-change', async (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([filter, value]) => JSON.stringify(value) !== JSON.stringify(activeFilters[filter]));
    if (!hasChanged) return;
    const previousYear = activeFilters.enrollmentDate.year;
    Object.assign(activeFilters, values);
    if (activeFilters.enrollmentDate.year !== previousYear) await loadFilterOptions();
    loadEnrollments(1);
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', (event) => loadEnrollments(event.detail.page));

  loadFilterOptions();
  loadEnrollments(1);

  // ---------- Modal: Nueva inscripción ----------

  // El formulario es el componente compartido enrollment-form.component.js; la vista abre y cierra
  // el modal, lleva el foco y actualiza la tabla con la inscripción creada
  const enrollmentOverlay = document.getElementById('newEnrollmentOverlay');
  const form = enrollmentOverlay.querySelector('enrollment-form');
  const openEnrollmentModalBtn = document.getElementById('openNewEnrollmentModalBtn');

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const { errorDescription } = form;

  // Aclaración de un toast de éxito del alta o de la edición. `isShown` dice si la inscripción quedó
  // a la vista después de volver a pedir la tabla: si no (false), porque no coincide con los filtros
  // activos, se aclara; si la tabla no llegó (null), no.
  const NOT_SHOWN_NOTE = 'No se muestra en la tabla porque no coincide con los filtros aplicados.';
  const withShownNote = (description, isShown) => (isShown === false ? `${description} ${NOT_SHOWN_NOTE}` : description);

  function openEnrollmentModal() {
    form.open();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    enrollmentOverlay.classList.add('is-open');
    enrollmentOverlay.querySelector('.modal').scrollTop = 0;
    form.focusFirst();
  }

  function closeEnrollmentModal() {
    enrollmentOverlay.classList.remove('is-open');
    form.closeMenus();
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

  // Al crear la inscripción, la tabla se actualiza antes de liberar el modal (refreshAfterCreate),
  // así al cerrarse ya la muestra; el toast lo muestra el formulario, con la aclaración si la
  // inscripción no quedó a la vista. Si no se crea, el formulario sigue abierto con lo elegido.
  form.setup({
    closeAllDropdowns,
    onSaved: async (enrollment) => {
      const isShown = await refreshAfterCreate(enrollment);
      closeEnrollmentModal();
      return isShown === false ? NOT_SHOWN_NOTE : '';
    },
    onCancel: closeEnrollmentModal,
  });

  openEnrollmentModalBtn.addEventListener('click', openEnrollmentModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape cierra el modal si no hay un desplegable ni un buscador abiertos
  // (dropdown.component.js resuelve antes esa pulsación). Se escucha en el documento para que
  // funcione aunque el foco haya quedado fuera de un control. Mientras se guarda, ni Escape ni
  // Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && enrollmentOverlay.classList.contains('is-open') && !form.isSaving) closeEnrollmentModal();
  });

  // Los alumnos que se pueden inscribir y los cursos del ciclo lectivo actual que ofrece el
  // formulario
  form.reloadOptions();

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
  // Posición en la página de la fila del botón que abrió el último modal (Editar o Eliminar) o del
  // último Imprimir que falló, solo para devolver el foco a la que ocupe su lugar si esa fila ya no
  // se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit, delete o print) de la fila que quedó en su lugar (o de la última de la
  // página), o "Nueva inscripción" si la tabla quedó sin inscripciones. Saltea los deshabilitados
  // (Editar y Eliminar de un ciclo cerrado, y Eliminar de una con calificaciones), que no toman el
  // foco.
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]:not(:disabled)`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openEnrollmentModalBtn;
  };
  // Cambia cada vez que el modal se abre o se cierra: descarta la respuesta de get que llegue tarde,
  // de una inscripción que ya no se edita
  let editRequestId = 0;

  // ACTIVE o CANCELLED, el estado marcado: Editar no ofrece Finalizada, porque una inscripción pasa a
  // finalizada solo con el cierre del ciclo lectivo, y la de un ciclo cerrado no se edita
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

  // Si la tabla se volvió a dibujar (después de guardar, o porque la inscripción quedó vieja), el foco
  // pasa a Editar en la fila de la inscripción o, si ya no se muestra o quedó en solo lectura, en la
  // que quedó en su lugar (o en la última de la página); sin filas, a Nueva inscripción
  const editFocusTarget = () => {
    if (editTrigger?.isConnected) return editTrigger;
    return tbody.querySelector(`tr[data-enrollment-id="${editingEnrollmentId}"] [data-action="edit"]:not(:disabled)`) ?? focusAfterRemoval('edit');
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
  // vigente, si su ciclo lectivo se cerró con la vista abierta desde antes del cambio de año o si otra
  // sesión dio de baja a su alumno (STUDENT_DELETED: sus inscripciones ya no se listan), antes se
  // vuelve a pedir la página.
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
    } else if (NO_LONGER_EDITABLE_CODES.includes(error?.code) || ['SCHOOL_YEAR_CLOSED', 'STUDENT_DELETED'].includes(error?.code)) {
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
  // el modal, así al cerrarse ya no la muestra; si su ciclo lectivo se cerró con la vista abierta
  // desde antes del cambio de año, la tabla vuelve a pedir la página, que la muestra en solo lectura,
  // y lo mismo si tiene calificaciones (otra sesión le cargó una después de pedir la página): vuelve
  // con Eliminar deshabilitado.
  // Avisa el resultado con un toast y no resuelve ningún mensaje, así el modal se cierra siempre.
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
    } else if (['SCHOOL_YEAR_CLOSED', 'ENROLLMENT_HAS_SCORES'].includes(error?.code)) {
      // La fila va a quedar con Eliminar deshabilitado, que no toma el foco
      triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
      await loadEnrollments(pagination.page);
    }

    if (response?.ok) {
      // Si era activa, ya no cuenta para la regla de una sola activa por alumno y su alumno vuelve a
      // poder inscribirse: las listas del alta se vuelven a pedir al reabrir el modal
      form.invalidateOptions();
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

  // ---------- Imprimir comprobante ----------

  // Inscripciones (inscripcion_id) cuyo comprobante se está generando: otro clic en Imprimir de la
  // misma fila mientras tanto no lo vuelve a pedir, así no se abre dos veces
  const printingEnrollmentIds = new Set();

  // El id sale del data-enrollment-id de la fila del botón (el inscripcion_id); el proceso principal
  // vuelve a comprobar que la inscripción exista en la institución y siga vigente. Si el comprobante
  // se abre, el visor de PDF ya es el aviso y la vista no muestra nada. Si no, un toast dice por qué;
  // si la inscripción ya no está vigente (los mismos códigos que en Editar), antes se vuelve a pedir
  // la página de la tabla y, si el foco estaba en el botón, pasa a Imprimir en la fila que quedó en
  // su lugar.
  const openReceipt = async (trigger) => {
    const row = trigger.closest('tr');
    const enrollmentId = Number(row.dataset.enrollmentId);
    if (printingEnrollmentIds.has(enrollmentId)) return;
    printingEnrollmentIds.add(enrollmentId);
    let response;
    try {
      response = await window.api?.enrollments?.openReceipt(enrollmentId);
    } catch (error) {
      console.error('Error al abrir el comprobante:', error);
    }
    printingEnrollmentIds.delete(enrollmentId);
    if (response?.ok) return;

    const error = response?.error;
    if (NO_LONGER_EDITABLE_CODES.includes(error?.code)) {
      const hadFocus = document.activeElement === trigger;
      // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
      triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
      await loadEnrollments(pagination.page);
      if (hadFocus && !trigger.isConnected) focusAfterRemoval('print').focus();
    }
    showToast({ type: 'error', title: 'No se pudo abrir el comprobante', description: errorDescription(error) });
  };

  // Por delegación, como Editar
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="print"]');
    if (button) openReceipt(button);
  });

  // ---------- Ver promedios ----------

  // Abre la vista Promedios con el id del data-enrollment-id de la fila (el inscripcion_id); esa
  // vista vuelve a comprobar que la inscripción siga vigente en la institución y no esté cancelada.
  // Por delegación, como Imprimir
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="averages"]');
    if (!button) return;
    const query = new URLSearchParams({ enrollmentId: button.closest('tr').dataset.enrollmentId });
    window.location.href = `../enrollment-averages/index.html?${query}`;
  });
});
