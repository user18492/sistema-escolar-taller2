// Vista Alumnos del Secretario: la tabla muestra los alumnos de la institución, que llegan del
// proceso principal (window.api.students.list), y los filtros de columna los filtran en memoria.
// La lista filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// Las pestañas (tab-list.component.js) separan a los vigentes de los dados de baja, que llegan en la
// misma lista con su deletedAt, y cada una muestra cuántos tiene. Las dos comparten las columnas; en
// Eliminados, la única acción de la fila es Restaurar.
// Nuevo alumno lo registra, siempre activo (window.api.students.create), Editar alumno guarda los
// cambios, entre ellos el estado (window.api.students.update), Eliminar alumno lo da de baja (baja
// lógica, window.api.students.delete) y lo pasa a Eliminados, junto con su inscripción activa, que
// pasa a cancelada, y Restaurar alumno lo devuelve a Vigentes con el estado que tenía
// (window.api.students.restore), sin reactivar sus inscripciones. Las dos últimas se confirman antes
// en un modal (confirm-modal.component.js). El resultado de las cuatro se avisa con un toast
// (toast.component.js), salvo los errores de un campo, que se marcan en el formulario. Editar
// completa el formulario con los datos del alumno cargado.

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  const { closeAllDropdowns } = setupDropdowns();

  // Los textos truncados (Nombre / Email / Dirección) muestran su tooltip con el
  // componente compartido text-truncate.component.js.

  // ---------- Tabla: alumnos de la institución ----------

  // Los filtros de Nombre / Email / Teléfono / DNI / Estado viven en los encabezados de la tabla y
  // los gestiona el componente compartido column-filter.js.
  const tabList = document.querySelector('.students-card .tab-list');
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

  // Vigentes y dados de baja juntos, en el orden en que llegan del proceso principal: por apellido y
  // nombre
  let students = [];
  let isLoaded = false;
  // Pestaña elegida, por su data-tab: 'current' (Vigentes) o 'deleted' (Eliminados)
  let activeTab = tabList.querySelector('[aria-selected="true"]').dataset.tab;
  // Valores elegidos en cada filtro de columna, por su data-filter
  const activeFilters = {};

  // Los dados de baja traen el instante de su baja (deletedAt); los vigentes, null
  const tabOf = (student) => (student.deletedAt ? 'deleted' : 'current');
  // Alumnos de la pestaña `tab` (por defecto, la elegida), en el orden de la lista
  const studentsOfTab = (tab = activeTab) => students.filter((student) => tabOf(student) === tab);

  // Tabla vacía porque la pestaña elegida no tiene alumnos
  const EMPTY_TAB_MESSAGES = {
    current: 'No hay alumnos registrados.',
    deleted: 'No hay alumnos eliminados.',
  };

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

  // Cantidad de alumnos de cada pestaña, sin contar los filtros de columna. Mientras no hay lista
  // cargada queda vacía, y tab-list.css la oculta.
  const renderTabCounts = () => {
    tabList.querySelectorAll('[role="tab"]').forEach((tab) => {
      tab.querySelector('.tab-count').textContent = isLoaded ? String(studentsOfTab(tab.dataset.tab).length) : '';
    });
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML
  const fillOption = (option, [name, detail]) => {
    option.querySelector('.option-name').textContent = name ?? '';
    option.querySelector('.option-detail').textContent = detail ?? '';
  };

  const createOption = (student, texts) => {
    const option = optionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(student.id);
    fillOption(option, texts);
    return option;
  };

  // Opciones de Nombre, Email, Teléfono y DNI: una por alumno de la pestaña elegida, en el orden de
  // la tabla y antes de .dropdown-empty; column-filter.js las lee al usarlas. Llegan sin marcar, así
  // que esos filtros dejan de aplicarse y sus embudos se actualizan.
  const fillFilterOptions = () => {
    const tabStudents = studentsOfTab();
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const header = table.querySelector(`th[data-filter="${filter}"]`);
      const list = header.querySelector('[role="listbox"]');
      const emptyState = list.querySelector('.dropdown-empty');
      list.replaceChildren(...tabStudents.map((student) => createOption(student, textsOf(student))), emptyState);
      delete activeFilters[filter];
      header.dispatchEvent(new Event('column-filter-refresh'));
    });
  };

  // Al cambiar de pestaña, ningún filtro de columna queda con algo elegido. column-filter-reset no
  // emite column-filter-change: la tabla se vuelve a dibujar después, una sola vez.
  const clearAllFilters = () => {
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    table.querySelectorAll('th.column-filter').forEach((header) => {
      delete activeFilters[header.dataset.filter];
      header.dispatchEvent(new Event('column-filter-reset'));
    });
  };

  // La fila lleva el alumno_id en data-student-id
  const createRow = (student) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.studentId = String(student.id);
    // <row-actions> genera sus botones al conectarse, y con restore-label genera solo Restaurar: se
    // le quita antes de insertar la fila de un vigente, que lleva Editar y Eliminar
    if (tabOf(student) === 'current') row.querySelector('row-actions').removeAttribute('restore-label');
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

  // Muestra la página `page` (por defecto, la actual) de los alumnos de la pestaña elegida que pasan
  // los filtros (10 por página, en memoria): el total y los números de página salen de esa lista
  // filtrada. Al cambiar un filtro o de pestaña se vuelve a la página 1; al recargar se conserva, y
  // el componente la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const tabStudents = studentsOfTab();
    const visibleStudents = tabStudents.filter(matchesFilters);
    const pageStudents = pagination.slice(visibleStudents, { page });
    if (pageStudents.length) tbody.replaceChildren(...pageStudents.map(createRow));
    else showMessage(tabStudents.length ? 'Ningún alumno coincide con los filtros.' : EMPTY_TAB_MESSAGES[activeTab]);
  };

  // Punto de entrada también para volver a pedir la lista cuando la que está en memoria quedó
  // vieja. Conserva la pestaña, la página y el filtro de Estado.
  async function loadStudents() {
    isLoaded = false;
    renderTabCounts();
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
    renderTabCounts();
    renderRows();
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Mientras carga o si la carga
  // falló, se guardan los valores sin reemplazar el mensaje de la tabla.
  table.tHead.addEventListener('column-filter-change', (event) => {
    activeFilters[event.target.dataset.filter] = event.detail.values;
    if (isLoaded) renderRows({ page: 1 });
  });

  // Otra pestaña: sus alumnos, con las mismas columnas, sin filtros de columna y desde la página 1.
  // Los contadores no cambian. Mientras carga o si la carga falló, la tabla sigue con su mensaje.
  tabList.addEventListener('tab-change', (event) => {
    activeTab = event.detail.tab;
    clearAllFilters();
    if (!isLoaded) return;
    fillFilterOptions();
    renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadStudents();

  // ---------- Tabla: alumno nuevo, editado, eliminado o restaurado ----------

  // Sin recargar la lista: se conservan los filtros.

  // Orden aproximado al de la base (apellido, nombre, id): el exacto depende de su intercalación y
  // se aplica en la próxima carga.
  const nameCollator = new Intl.Collator('es');
  const compareStudents = (a, b) =>
    nameCollator.compare(a.lastName ?? '', b.lastName ?? '') ||
    nameCollator.compare(a.firstName ?? '', b.firstName ?? '') ||
    a.id - b.id;

  // Opción del alumno con ese id (string) en `list` (una lista de opciones o el encabezado de su
  // filtro), o undefined
  const findOption = (list, id) =>
    Array.from(list.querySelectorAll('.dropdown-option')).find((candidate) => candidate.dataset.value === id);

  // Agrega al alumno creado a la lista en memoria, en su lugar alfabético, y lo suma a Vigentes. Si
  // es la pestaña elegida, lo agrega también a las opciones de Nombre, Email, Teléfono y DNI, sin
  // tocar los filtros: si coincide con los activos, la tabla pasa a la página donde quedó; si no, no
  // se muestra. Con Eliminados elegida, solo cambia el contador. Si la lista no se había podido
  // cargar, se vuelve a pedir: mostrar solo al alumno nuevo taparía el error.
  const insertStudent = (newStudent) => {
    if (!isLoaded) {
      loadStudents();
      return;
    }
    const index = students.findIndex((student) => compareStudents(newStudent, student) < 0);
    const position = index === -1 ? students.length : index;
    students = students.toSpliced(position, 0, newStudent);
    renderTabCounts();
    if (tabOf(newStudent) !== activeTab) return;
    // Su opción va antes de la del alumno que lo sigue en la pestaña
    const nextStudent = students.slice(position + 1).find((student) => tabOf(student) === activeTab);
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const list = table.querySelector(`th[data-filter="${filter}"] [role="listbox"]`);
      const reference = (nextStudent && findOption(list, String(nextStudent.id))) ?? list.querySelector('.dropdown-empty');
      list.insertBefore(createOption(newStudent, textsOf(newStudent)), reference);
    });
    const visibleIndex = studentsOfTab().filter(matchesFilters).indexOf(newStudent);
    renderRows(visibleIndex === -1 ? {} : { page: Math.floor(visibleIndex / pagination.pageSize) + 1 });
  };

  // Reemplaza al alumno en la lista en memoria y en las opciones de Nombre, Email, Teléfono y DNI.
  // Conserva su lugar en la lista aunque cambie su apellido: el orden se actualiza en la próxima
  // carga. Si ya no coincide con los filtros activos (p. ej., cambió su estado), su fila deja de
  // mostrarse.
  const replaceStudent = (updatedStudent) => {
    const id = String(updatedStudent.id);
    students = students.map((student) => (String(student.id) === id ? updatedStudent : student));
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const header = table.querySelector(`th[data-filter="${filter}"]`);
      const option = findOption(header, id);
      if (!option) return;
      fillOption(option, textsOf(updatedStudent));
      // La etiqueta del embudo nombra a las opciones marcadas
      if (option.classList.contains('selected')) header.dispatchEvent(new Event('column-filter-refresh'));
    });
    renderRows();
  };

  // Pasa a la otra pestaña al alumno dado de baja o restaurado (`movedStudent`, como quedó), sin
  // recargar la lista: lo reemplaza en la lista en memoria, donde conserva su lugar, y los contadores
  // se actualizan. Como las bajas se hacen desde Vigentes y las restauraciones desde Eliminados, sale
  // de la pestaña elegida y de las opciones de Nombre, Email, Teléfono y DNI: si su opción estaba
  // marcada, deja de filtrar y el embudo se actualiza. La página se conserva; si era la última y
  // quedó vacía, el componente pasa a la anterior.
  const moveToOtherTab = (movedStudent) => {
    const id = String(movedStudent.id);
    students = students.map((student) => (String(student.id) === id ? movedStudent : student));
    if (tabOf(movedStudent) === activeTab) {
      // Se cambió de pestaña mientras se esperaba la respuesta: llega a la elegida, y las opciones
      // se vuelven a armar con él
      fillFilterOptions();
    } else {
      Object.keys(FILTER_OPTION_TEXTS).forEach((filter) => {
        const header = table.querySelector(`th[data-filter="${filter}"]`);
        const option = findOption(header, id);
        if (!option) return;
        const wasSelected = option.classList.contains('selected');
        option.remove();
        if (!wasSelected) return;
        activeFilters[filter] = (activeFilters[filter] ?? []).filter((value) => value !== id);
        header.dispatchEvent(new Event('column-filter-refresh'));
      });
    }
    renderTabCounts();
    renderRows();
  };

  // Posición en la página de la fila del botón que abrió el último modal, solo para devolver el
  // foco a la que ocupe su lugar si esa fila ya no se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit, delete o restore) de la fila que quedó en su lugar (o de la última
  // de la página), o "Nuevo alumno" si la tabla quedó sin alumnos
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openModalBtn;
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

  // Texto del botón principal, en reposo y mientras se espera la respuesta, y de los toasts de
  // éxito y de error, según el modo del modal
  const MODAL_TEXTS = {
    create: {
      submit: 'Crear alumno',
      saving: 'Creando…',
      successTitle: 'Alumno creado',
      successDescription: (student) => `Se registró a ${displayName(student)}.`,
      errorTitle: 'No se pudo crear el alumno',
    },
    edit: {
      submit: 'Guardar cambios',
      saving: 'Guardando…',
      successTitle: 'Alumno actualizado',
      successDescription: (student) => `Se guardaron los cambios de ${displayName(student)}.`,
      errorTitle: 'No se pudieron guardar los cambios',
    },
  };

  let modalTrigger = openModalBtn;
  let isEditing = false;
  // alumno_id del alumno que se edita, fijado al abrir el modal desde su fila: es el único que se
  // envía al guardar
  let editingStudentId = null;
  let isSaving = false;

  const modalTexts = () => MODAL_TEXTS[isEditing ? 'edit' : 'create'];

  // Máscaras, formato y errores de los campos de texto: componente compartido
  // field-validation.component.js, según el data-validate de cada campo.

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => input.value.trim().length > 0);
    // Al editar llega elegido el estado actual del alumno; en el alta no se elige
    const hasStatus = !isEditing || Boolean(statusDropdown.querySelector('.dropdown-option.selected'));
    createBtn.disabled = !(hasAllTextInputs && hasStatus);
  }

  // Mientras se espera la respuesta, el cuerpo del modal queda inerte, así lo enviado coincide con
  // lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled: conservan el foco,
  // como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    modalBody.inert = saving;
    overlay.querySelector('.modal').setAttribute('aria-busy', String(saving));
    [cancelBtn, createBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    createBtn.textContent = saving ? modalTexts().saving : modalTexts().submit;
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
    editingStudentId = student?.id ?? null;
    modalTrigger = trigger;
    triggerRowIndex = row ? Math.max(0, Array.from(tbody.rows).indexOf(row)) : 0;
    resetForm();

    modalTitle.textContent = isEditing ? 'Editar alumno' : 'Nuevo alumno';
    modalDescription.textContent = isEditing
      ? 'Modifica los datos del alumno.'
      : 'Completa los datos para registrar un nuevo alumno.';
    createBtn.textContent = modalTexts().submit;
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
    // Después de guardar los cambios, o si el alumno ya no existe, la tabla se volvió a dibujar: el
    // foco pasa a Editar en la fila del alumno o, si ya no se muestra, en la que quedó en su lugar
    const focusTarget = modalTrigger.isConnected
      ? modalTrigger
      : tbody.querySelector(`tr[data-student-id="${editingStudentId}"] [data-action="edit"]`) ?? focusAfterRemoval('edit');
    focusTarget.focus();
    closeAllDropdowns();
  }

  // Solo los datos del formulario: el id va aparte, tomado al abrir el modal. El estado va solo al
  // editar: un alta no lo envía. El DNI se envía solo con dígitos, como se guarda.
  const readFormData = () => ({
    firstName: firstNameInput.value,
    lastName: lastNameInput.value,
    dni: dniInput.value.replace(/\D/g, ''),
    email: emailInput.value,
    phone: phoneInput.value,
    street: streetInput.value,
    streetNumber: streetNumberInput.value,
    birthDate: toIsoDate(birthdateInput.value),
    ...(isEditing ? { status: statusDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? '' } : {}),
  });

  // Marca los campos que rechazó el proceso principal (DNI o email de otro alumno, datos inválidos)
  // y enfoca el primero. Devuelve false si no había ninguno para marcar.
  const showFieldErrors = (fieldErrors = {}) => {
    const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
    invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
    invalidFields[0]?.[1].focus();
    return invalidFields.length > 0;
  };

  // Registra o guarda según el modo; al terminar cierra el modal y lo avisa con un toast. Los errores
  // de un campo se marcan en el formulario y los demás salen en un toast: en ambos casos el modal
  // sigue abierto con lo que se escribió. Solo se cierra si el alumno que se editaba ya no existe.
  const saveStudent = async () => {
    const studentId = editingStudentId;
    setSaving(true);
    let response;
    try {
      const data = readFormData();
      response = await (isEditing
        ? window.api?.students?.update(studentId, data)
        : window.api?.students?.create(data));
    } catch (error) {
      console.error('Error al guardar el alumno:', error);
    }
    // El alumno que se editaba ya no está vigente: la lista se vuelve a pedir antes de liberar el
    // modal, que se cierra más abajo
    const isGone = isEditing && response?.error?.code === 'STUDENT_NOT_FOUND';
    if (isGone) await loadStudents();
    setSaving(false);

    if (response?.ok) {
      if (isEditing) replaceStudent(response.student);
      else insertStudent(response.student);
      closeModal();
      showToast({
        type: 'success',
        title: modalTexts().successTitle,
        description: modalTexts().successDescription(response.student),
      });
      return;
    }
    const error = response?.error;
    if (showFieldErrors(error?.fieldErrors)) return;
    if (isGone) closeModal();
    showToast({ type: 'error', title: modalTexts().errorTitle, description: errorDescription(error) });
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
  // quedado fuera de un control. Mientras se guarda el alumno, ni Escape ni Cancelar lo cierran.
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
    saveStudent();
  });

  // ---------- Modal: Eliminar alumno ----------

  // El alumno ya no está vigente: la lista en memoria quedó vieja y se vuelve a pedir
  const NO_LONGER_ACTIVE_CODES = ['STUDENT_NOT_FOUND', 'STUDENT_ALREADY_DELETED'];

  // El id sale del data-student-id de la fila del botón (el alumno_id, fijado al crearla), no de su
  // posición en la tabla, y el nombre del toast, del alumno cargado. Avisa el resultado con un toast
  // y no resuelve ningún mensaje, así el modal se cierra siempre.
  const deleteStudent = async (trigger) => {
    const row = trigger.closest('tr');
    const student = students.find((candidate) => String(candidate.id) === row?.dataset.studentId);
    let response;
    try {
      response = await window.api?.students?.delete(Number(row?.dataset.studentId));
    } catch (error) {
      console.error('Error al eliminar el alumno:', error);
    }
    const isGone = NO_LONGER_ACTIVE_CODES.includes(response?.error?.code);
    // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
    if (response?.ok || isGone) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      // La respuesta no trae al alumno: su deletedAt es el instante actual (la tabla no lo muestra;
      // el de la base llega en la próxima carga)
      moveToOtherTab({ ...student, deletedAt: new Date().toISOString() });
      // La base admite una sola inscripción activa por alumno
      const cancelledText = response.cancelledEnrollmentCount > 0 ? ' y se canceló su inscripción activa' : '';
      showToast({
        type: 'success',
        title: 'Alumno eliminado',
        description: `Se eliminó a ${displayName(student)}${cancelledText}.`,
      });
      return;
    }
    if (isGone) await loadStudents();
    showToast({ type: 'error', title: 'No se pudo eliminar el alumno', description: errorDescription(response?.error) });
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y después se
  // cierra. Si la fila ya no está, el foco pasa a Eliminar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('deleteStudentOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: deleteStudent,
    fallbackFocus: () => focusAfterRemoval('delete'),
  });

  // ---------- Modal: Restaurar alumno ----------

  // El alumno ya no está dado de baja: la lista en memoria quedó vieja y se vuelve a pedir
  const NO_LONGER_DELETED_CODES = ['STUDENT_NOT_FOUND', 'STUDENT_NOT_DELETED'];

  // Como en la baja: el id sale del data-student-id de la fila del botón, el resultado se avisa con
  // un toast y no se resuelve ningún mensaje, así el modal se cierra siempre. Si otro alumno vigente
  // ya tiene su DNI o su email (DUPLICATE_VALUE), sigue en Eliminados y el toast dice cuál.
  const restoreStudent = async (trigger) => {
    const row = trigger.closest('tr');
    let response;
    try {
      response = await window.api?.students?.restore(Number(row?.dataset.studentId));
    } catch (error) {
      console.error('Error al restaurar el alumno:', error);
    }
    const isStale = NO_LONGER_DELETED_CODES.includes(response?.error?.code);
    // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
    if (response?.ok || isStale) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      moveToOtherTab(response.student);
      showToast({
        type: 'success',
        title: 'Alumno restaurado',
        description: `Se restauró a ${displayName(response.student)}.`,
      });
      return;
    }
    if (isStale) await loadStudents();
    showToast({ type: 'error', title: 'No se pudo restaurar el alumno', description: errorDescription(response?.error) });
  };

  // El mismo componente que Eliminar, con action="restore" en su marcado: lo abre Restaurar. Si la
  // fila ya no está, el foco pasa a Restaurar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('restoreStudentOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: restoreStudent,
    fallbackFocus: () => focusAfterRemoval('restore'),
  });
});

