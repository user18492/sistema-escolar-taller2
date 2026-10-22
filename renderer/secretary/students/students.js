// Vista Alumnos del Secretario: la tabla muestra los alumnos de la institución, que llegan del
// proceso principal (window.api.students.list), y los filtros de columna los filtran en memoria.
// La lista filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// Nuevo alumno lo registra, siempre activo (window.api.students.create), y avisa el resultado con
// un toast (toast.component.js), salvo los errores de un campo, que se marcan en el formulario.
// Editar alumno y Eliminar alumno siguen siendo puramente visuales: no guardan ni eliminan nada.
// Editar completa el formulario con los datos del alumno cargado.

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  const { closeAllDropdowns } = setupDropdowns();

  // Los textos truncados (Nombre / Email / Dirección) muestran su tooltip con el
  // componente compartido text-truncate.component.js.

  // ---------- Tabla: alumnos de la institución ----------

  // Los filtros de Nombre / Email / Teléfono / DNI / Estado viven en los encabezados de la tabla y
  // los gestiona el componente compartido column-filter.js.
  const table = document.querySelector('.students-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('studentRowTemplate');
  const optionTemplate = document.getElementById('studentOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.students-card table-pagination');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar los alumnos. Intentá nuevamente.';

  // Textos de Estado tomados de las opciones de su filtro, para que la celda y el filtro digan lo
  // mismo. Los estados llegan como ACTIVE o GRADUATED.
  const statusLabels = Object.fromEntries(
    Array.from(document.querySelectorAll('#statusFilter .dropdown-option'), (option) => [option.dataset.value, option.textContent.trim()])
  );

  // En el orden en que llegan del proceso principal: por apellido y nombre
  let students = [];
  let isLoaded = false;
  // Valores elegidos en cada filtro de columna, por su data-filter
  const activeFilters = {};

  // "Apellido, Nombre"
  const fullName = (student) => `${student.lastName ?? ''}, ${student.firstName ?? ''}`;
  // "Nombre Apellido", como lo nombran los toasts
  const displayName = (student) => `${student.firstName} ${student.lastName}`;
  // Calle y altura, como una sola dirección
  const address = (student) => [student.street, student.streetNumber].filter(Boolean).join(' ');
  // La fecha llega como 'AAAA-MM-DD' (o null) y se muestra como DD/MM/AAAA
  const toDisplayDate = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('/') : '');
  // El campo ya validado (DD/MM/AAAA) se envía como 'AAAA-MM-DD'
  const toIsoDate = (displayDate) => displayDate.split('/').reverse().join('-');

  // Lo que compara cada filtro: Nombre, Email, Teléfono y DNI eligen un alumno por su id
  const FILTER_KEYS = {
    name: (student) => String(student.id),
    email: (student) => String(student.id),
    phone: (student) => String(student.id),
    dni: (student) => String(student.id),
    status: (student) => student.status,
  };

  // Texto principal y secundario de las opciones de Nombre, Email, Teléfono y DNI
  const FILTER_OPTION_TEXTS = {
    name: (student) => [fullName(student), student.email],
    email: (student) => [student.email, fullName(student)],
    phone: (student) => [student.phone, fullName(student)],
    dni: (student) => [formatDni(student.dni ?? ''), fullName(student)],
  };

  // Entre columnas se combinan con Y; un filtro sin valores no descarta nada
  const matchesFilters = (student) =>
    Object.entries(activeFilters).every(([filter, values]) => values.length === 0 || values.includes(FILTER_KEYS[filter](student)));

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML
  const createOption = (student, [name, detail]) => {
    const option = optionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(student.id);
    option.querySelector('.option-name').textContent = name ?? '';
    option.querySelector('.option-detail').textContent = detail ?? '';
    return option;
  };

  // Opciones de Nombre, Email, Teléfono y DNI: una por alumno, en el orden de la tabla y antes de
  // .dropdown-empty; column-filter.js las lee al usarlas. Llegan sin marcar, así que esos filtros
  // dejan de aplicarse y sus embudos se actualizan.
  const fillFilterOptions = () => {
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const header = table.querySelector(`th[data-filter="${filter}"]`);
      const list = header.querySelector('[role="listbox"]');
      const emptyState = list.querySelector('.dropdown-empty');
      list.replaceChildren(...students.map((student) => createOption(student, textsOf(student))), emptyState);
      delete activeFilters[filter];
      header.dispatchEvent(new Event('column-filter-refresh'));
    });
  };

  // La fila lleva el alumno_id en data-student-id
  const createRow = (student) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.studentId = String(student.id);
    row.cells[0].querySelector('.text-truncate').textContent = fullName(student);
    row.cells[1].querySelector('.text-truncate').textContent = student.email ?? '';
    row.cells[2].textContent = student.phone ?? '';
    row.cells[3].querySelector('.text-truncate').textContent = address(student);
    row.cells[4].textContent = formatDni(student.dni ?? '');
    row.cells[5].textContent = toDisplayDate(student.birthDate);
    // <status-badge> lee sus atributos al conectarse: se fijan antes de insertar la fila
    const badge = row.querySelector('status-badge');
    badge.setAttribute('status', (student.status ?? '').toLowerCase());
    badge.setAttribute('label', statusLabels[student.status] ?? student.status ?? '');
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de los alumnos que pasan los filtros (10 por
  // página, en memoria): el total y los números de página salen de esa lista filtrada. Al cambiar
  // un filtro se vuelve a la página 1; al recargar se conserva, y el componente la acota a la
  // última que quede.
  const renderRows = ({ page } = {}) => {
    const visibleStudents = students.filter(matchesFilters);
    const pageStudents = pagination.slice(visibleStudents, { page });
    if (pageStudents.length) tbody.replaceChildren(...pageStudents.map(createRow));
    else showMessage(students.length ? 'Ningún alumno coincide con los filtros.' : 'No hay alumnos registrados.');
  };

  // Punto de entrada también para volver a pedir la lista cuando la que está en memoria quedó
  // vieja. Conserva la página y el filtro de Estado.
  async function loadStudents() {
    isLoaded = false;
    showMessage('Cargando alumnos…');
    let response;
    try {
      response = await window.api?.students?.list();
    } catch (error) {
      console.error('Error al cargar los alumnos:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    students = response.students;
    isLoaded = true;
    fillFilterOptions();
    renderRows();
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Mientras carga o si la carga
  // falló, se guardan los valores sin reemplazar el mensaje de la tabla.
  table.tHead.addEventListener('column-filter-change', (event) => {
    activeFilters[event.target.dataset.filter] = event.detail.values;
    if (isLoaded) renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadStudents();

  // ---------- Tabla: alumno nuevo ----------

  // Sin recargar la lista: se conservan los filtros.

  // Orden aproximado al de la base (apellido, nombre, id): el exacto depende de su intercalación y
  // se aplica en la próxima carga.
  const nameCollator = new Intl.Collator('es');
  const compareStudents = (a, b) =>
    nameCollator.compare(a.lastName ?? '', b.lastName ?? '') ||
    nameCollator.compare(a.firstName ?? '', b.firstName ?? '') ||
    a.id - b.id;

  // Opción del alumno con ese id (string) en la lista de opciones `list`, o undefined
  const findOption = (list, id) =>
    Array.from(list.querySelectorAll('.dropdown-option')).find((candidate) => candidate.dataset.value === id);

  // Agrega al alumno creado a la lista en memoria, en su lugar alfabético, y a las opciones de
  // Nombre, Email, Teléfono y DNI, sin tocar los filtros: si coincide con los activos, la tabla pasa
  // a la página donde quedó; si no, no se muestra. Si la lista no se había podido cargar, se vuelve
  // a pedir: mostrar solo al alumno nuevo taparía el error.
  const insertStudent = (newStudent) => {
    if (!isLoaded) {
      loadStudents();
      return;
    }
    const index = students.findIndex((student) => compareStudents(newStudent, student) < 0);
    const position = index === -1 ? students.length : index;
    students = students.toSpliced(position, 0, newStudent);
    // Su opción va antes de la del alumno que lo sigue en la lista
    const nextStudent = students[position + 1];
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const list = table.querySelector(`th[data-filter="${filter}"] [role="listbox"]`);
      const reference = (nextStudent && findOption(list, String(nextStudent.id))) ?? list.querySelector('.dropdown-empty');
      list.insertBefore(createOption(newStudent, textsOf(newStudent)), reference);
    });
    const visibleIndex = students.filter(matchesFilters).indexOf(newStudent);
    renderRows(visibleIndex === -1 ? {} : { page: Math.floor(visibleIndex / pagination.pageSize) + 1 });
  };

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // ---------- Modal: Nuevo alumno / Editar alumno ----------

  const overlay = document.getElementById('newStudentOverlay');
  const modalBody = overlay.querySelector('.modal-body');
  const openModalBtn = document.getElementById('openNewStudentModalBtn');
  const cancelBtn = document.getElementById('cancelNewStudentBtn');
  const createBtn = document.getElementById('createStudentBtn');
  const modalTitle = document.getElementById('newStudentTitle');
  const modalDescription = overlay.querySelector('.modal-header p');

  const textInputs = overlay.querySelectorAll(
    '.modal-body input[type="text"], .modal-body input[type="email"], .modal-body input[type="tel"]'
  );
  // Estado: el campo solo se muestra al editar; un alta registra siempre un alumno activo.
  const statusField = document.getElementById('editStudentStatusField');
  const statusDropdown = statusField.querySelector('.dropdown');
  const statusLabel = statusDropdown.querySelector('.dropdown-label');
  const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');

  const firstNameInput = document.getElementById('newStudentFirstName');
  const lastNameInput = document.getElementById('newStudentLastName');
  const dniInput = document.getElementById('newStudentDni');
  const birthdateInput = document.getElementById('newStudentBirthdate');
  const emailInput = document.getElementById('newStudentEmail');
  const phoneInput = document.getElementById('newStudentPhone');
  const streetInput = document.getElementById('newStudentStreet');
  const streetNumberInput = document.getElementById('newStudentStreetNumber');

  // Campos que el proceso principal puede marcar (error.fieldErrors), en el orden del formulario
  const FIELD_INPUTS = {
    firstName: firstNameInput,
    lastName: lastNameInput,
    dni: dniInput,
    birthDate: birthdateInput,
    email: emailInput,
    phone: phoneInput,
    street: streetInput,
    streetNumber: streetNumberInput,
  };

  let modalTrigger = openModalBtn;
  let isEditing = false;
  let isSaving = false;

  // Máscaras, formato y errores de los campos de texto: componente compartido
  // field-validation.component.js, según el data-validate de cada campo.

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => input.value.trim().length > 0);
    // Al editar llega elegido el estado actual del alumno; en el alta no se elige
    const hasStatus = !isEditing || Boolean(statusDropdown.querySelector('.dropdown-option.selected'));
    createBtn.disabled = !(hasAllTextInputs && hasStatus);
  }

  // Mientras se espera la respuesta del alta, el cuerpo del modal queda inerte, así lo enviado
  // coincide con lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled:
  // conservan el foco, como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    modalBody.inert = saving;
    overlay.querySelector('.modal').setAttribute('aria-busy', String(saving));
    [cancelBtn, createBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    createBtn.textContent = saving ? 'Creando…' : 'Crear alumno';
  };

  // Marca la opción de estado con ese data-value (ACTIVE o GRADUATED, los mismos que el filtro de la
  // columna), replicando lo que hace el listener del dropdown al elegirla con el ratón.
  function selectStatus(status) {
    statusOptions.forEach((option) => {
      const selected = option.dataset.value === status;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) statusLabel.textContent = option.textContent.trim();
    });
    statusLabel.classList.remove('placeholder');
  }

  function resetForm() {
    textInputs.forEach((input) => (input.value = ''));
    clearFieldErrors(overlay);
    statusOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    statusLabel.textContent = 'Seleccionar estado';
    statusLabel.classList.add('placeholder');
    updateCreateButtonState();
  }

  function openModal(row = null, trigger = openModalBtn) {
    // La fila identifica al alumno solo por su data-student-id (el alumno_id). Los datos del
    // formulario salen del alumno cargado de la base, no del texto de las celdas.
    const student = row ? students.find((candidate) => String(candidate.id) === row.dataset.studentId) : null;
    if (row && !student) return;
    isEditing = Boolean(student);
    modalTrigger = trigger;
    resetForm();

    modalTitle.textContent = isEditing ? 'Editar alumno' : 'Nuevo alumno';
    modalDescription.textContent = isEditing
      ? 'Modifica los datos del alumno.'
      : 'Completa los datos para registrar un nuevo alumno.';
    createBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear alumno';
    statusField.hidden = !isEditing;

    if (student) {
      firstNameInput.value = student.firstName ?? '';
      lastNameInput.value = student.lastName ?? '';
      emailInput.value = student.email ?? '';
      phoneInput.value = student.phone ?? '';
      streetInput.value = student.street ?? '';
      streetNumberInput.value = student.streetNumber ?? '';
      dniInput.value = formatDni(student.dni ?? '');
      birthdateInput.value = toDisplayDate(student.birthDate);
      selectStatus(student.status);
    }

    updateCreateButtonState();
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    overlay.classList.add('is-open');
    overlay.querySelector('.modal').scrollTop = 0;
    firstNameInput.focus();
  }

  function closeModal() {
    overlay.classList.remove('is-open');
    modalTrigger.focus();
    closeAllDropdowns();
  }

  // Solo los datos que se guardan: un alta no envía el estado. El DNI se envía solo con dígitos,
  // como se guarda.
  const readFormData = () => ({
    firstName: firstNameInput.value,
    lastName: lastNameInput.value,
    dni: dniInput.value.replace(/\D/g, ''),
    email: emailInput.value,
    phone: phoneInput.value,
    street: streetInput.value,
    streetNumber: streetNumberInput.value,
    birthDate: toIsoDate(birthdateInput.value),
  });

  // Marca los campos que rechazó el proceso principal (DNI o email de otro alumno, datos inválidos)
  // y enfoca el primero. Devuelve false si no había ninguno para marcar.
  const showFieldErrors = (fieldErrors = {}) => {
    const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
    invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
    invalidFields[0]?.[1].focus();
    return invalidFields.length > 0;
  };

  // Registra al alumno; al terminar cierra el modal y lo avisa con un toast. Los errores de un campo
  // se marcan en el formulario y los demás salen en un toast: en ambos casos el modal sigue abierto
  // con lo que se escribió.
  const createStudent = async () => {
    setSaving(true);
    let response;
    try {
      response = await window.api?.students?.create(readFormData());
    } catch (error) {
      console.error('Error al crear el alumno:', error);
    }
    setSaving(false);

    if (response?.ok) {
      insertStudent(response.student);
      closeModal();
      showToast({
        type: 'success',
        title: 'Alumno creado',
        description: `Se registró a ${displayName(response.student)}.`,
      });
      return;
    }
    const error = response?.error;
    if (showFieldErrors(error?.fieldErrors)) return;
    showToast({ type: 'error', title: 'No se pudo crear el alumno', description: errorDescription(error) });
  };

  textInputs.forEach((input) => {
    input.addEventListener('input', updateCreateButtonState);
  });

  statusOptions.forEach((option) => {
    option.addEventListener('click', () => {
      statusLabel.classList.remove('placeholder');
      updateCreateButtonState();
    });
  });

  openModalBtn.addEventListener('click', () => openModal());
  // Por delegación: las filas se generan al cargar los alumnos, al filtrar y al cambiar de página
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openModal(button.closest('tr'), button);
  });

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control. Mientras se crea el alumno, ni Escape ni Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open') && !isSaving) closeModal();
  });

  cancelBtn.addEventListener('click', () => {
    if (!isSaving) closeModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', () => {
    if (isSaving) return;
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(overlay)) return;
    // El proceso principal vuelve a validar todo.
    if (!isEditing) {
      createStudent();
      return;
    }
    // Editar sigue siendo puramente visual: el guardado real se conecta cuando exista la capa de
    // servicios/IPC.
    closeModal();
  });

  // ---------- Modal: Eliminar alumno ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteStudentOverlay'), { beforeOpen: closeAllDropdowns });
});

