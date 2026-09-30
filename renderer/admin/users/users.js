// Vista Usuarios del Administrador: la tabla muestra los demás usuarios de la institución, que
// llegan del proceso principal (window.api.users.list), y los filtros de columna los filtran en
// memoria. La lista filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// Nuevo usuario lo crea (window.api.users.create), Editar guarda los cambios
// (window.api.users.update) y Eliminar da de baja al usuario (baja lógica, window.api.users.delete).

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  const { closeAllDropdowns } = setupDropdowns();

  // Los textos truncados (Usuario / Email) muestran su tooltip con el componente
  // compartido text-truncate.component.js.

  // ---------- Tabla: usuarios de la institución ----------

  const table = document.querySelector('.users-card .data-table');
  const tbody = table.tBodies[0];
  const columnCount = table.tHead.rows[0].cells.length;
  const rowTemplate = document.getElementById('userRowTemplate');
  const optionTemplate = document.getElementById('userOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.users-card table-pagination');
  // "Nuevo usuario": abre el alta y recibe el foco si la tabla queda sin filas después de editar o
  // eliminar
  const openModalBtn = document.getElementById('openNewUserModalBtn');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar los usuarios. Intentá nuevamente.';

  // Textos de Rol y Estado tomados de las opciones de sus filtros, para que la celda y el filtro
  // digan lo mismo. Los roles llegan como en la base (ADMIN, SECRETARIO, PROFESOR).
  const labelsOf = (panelId) => Object.fromEntries(
    Array.from(document.querySelectorAll(`#${panelId} .dropdown-option`), (option) => [option.dataset.value, option.textContent.trim()])
  );
  const roleLabels = labelsOf('roleFilter');
  const statusLabels = labelsOf('statusFilter');

  let users = [];
  let isLoaded = false;
  // Valores elegidos en cada filtro de columna, por su data-filter
  const activeFilters = {};

  const statusCode = (user) => (user.isActive ? 'ACTIVE' : 'SUSPENDED');
  // "Apellido, Nombre"
  const fullName = (user) => `${user.lastName ?? ''}, ${user.firstName ?? ''}`;
  const initialsOf = (user) =>
    [user.firstName, user.lastName].map((name) => name?.trim().charAt(0) ?? '').join('').toUpperCase();
  // La fecha llega como 'AAAA-MM-DD' (o null) y el campo del modal usa DD/MM/AAAA
  const toDisplayDate = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('/') : '');
  // El campo ya validado (DD/MM/AAAA) se envía como 'AAAA-MM-DD'
  const toIsoDate = (displayDate) => displayDate.split('/').reverse().join('-');

  // Lo que compara cada filtro: Usuario, DNI y Email eligen un usuario por su id
  const FILTER_KEYS = {
    name: (user) => String(user.id),
    dni: (user) => String(user.id),
    email: (user) => String(user.id),
    status: statusCode,
    role: (user) => user.role,
  };

  // Texto principal y secundario de las opciones de Usuario, DNI y Email
  const FILTER_OPTION_TEXTS = {
    name: (user) => [fullName(user), user.email],
    dni: (user) => [formatDni(user.dni ?? ''), fullName(user)],
    email: (user) => [user.email, fullName(user)],
  };

  // Entre columnas se combinan con Y; un filtro sin valores no descarta nada
  const matchesFilters = (user) =>
    Object.entries(activeFilters).every(([filter, values]) => values.length === 0 || values.includes(FILTER_KEYS[filter](user)));

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = columnCount;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML
  const fillOption = (option, user, [name, detail]) => {
    option.querySelector('.avatar-circle').textContent = initialsOf(user);
    option.querySelector('.option-name').textContent = name ?? '';
    option.querySelector('.option-email').textContent = detail ?? '';
  };

  const createOption = (user, texts) => {
    const option = optionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(user.id);
    fillOption(option, user, texts);
    return option;
  };

  // Opción del usuario con ese id (string) en el filtro de columna de `header`, o undefined
  const findOption = (header, id) =>
    Array.from(header.querySelectorAll('.dropdown-option')).find((candidate) => candidate.dataset.value === id);

  // Las opciones van antes de .dropdown-empty; column-filter.js las lee al usarlas
  const fillFilterOptions = () => {
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const list = table.querySelector(`th[data-filter="${filter}"] [role="listbox"]`);
      const emptyState = list.querySelector('.dropdown-empty');
      list.replaceChildren(...users.map((user) => createOption(user, textsOf(user))), emptyState);
    });
  };

  const createRow = (user) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.userId = String(user.id);
    row.querySelector('.avatar-circle').textContent = initialsOf(user);
    row.querySelector('.user-cell .text-truncate').textContent = fullName(user);
    row.cells[1].textContent = formatDni(user.dni ?? '');
    row.cells[2].querySelector('.text-truncate').textContent = user.email ?? '';
    // <status-badge> lee sus atributos al conectarse: se fijan antes de insertar la fila
    const status = statusCode(user);
    const badge = row.querySelector('status-badge');
    badge.setAttribute('status', status.toLowerCase());
    badge.setAttribute('label', statusLabels[status]);
    row.cells[4].textContent = roleLabels[user.role] ?? user.role ?? '';
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de los usuarios filtrados (10 por página, en
  // memoria). Al cambiar un filtro se vuelve a la página 1; al recargar se conserva, y el componente
  // la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const visibleUsers = users.filter(matchesFilters);
    const pageUsers = pagination.slice(visibleUsers, { page });
    if (pageUsers.length) tbody.replaceChildren(...pageUsers.map(createRow));
    else showMessage(users.length ? 'Ningún usuario coincide con los filtros.' : 'No hay otros usuarios registrados.');
  };

  // Punto de entrada también para recargar la lista después de crear, editar o eliminar.
  async function loadUsers() {
    showMessage('Cargando usuarios…');
    let response;
    try {
      response = await window.api?.users?.list();
    } catch (error) {
      console.error('Error al cargar los usuarios:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    users = response.users;
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
  pagination.addEventListener('page-change', () => renderRows());

  loadUsers();

  // ---------- Tabla: cambios después de crear, editar o eliminar ----------

  // Sin recargar la lista: se conservan los filtros y, salvo al crear, la página (el componente la
  // acota si la última quedó vacía).

  // Orden aproximado al de la base (apellido, nombre, id): el exacto depende de su intercalación y
  // se aplica en la próxima carga.
  const nameCollator = new Intl.Collator('es');
  const compareUsers = (a, b) =>
    nameCollator.compare(a.lastName ?? '', b.lastName ?? '') ||
    nameCollator.compare(a.firstName ?? '', b.firstName ?? '') ||
    a.id - b.id;

  // Agrega al usuario creado a la lista en memoria y a las opciones de Usuario, DNI y Email, en su
  // lugar alfabético, sin tocar los filtros. Si coincide con los filtros activos, la tabla pasa a la
  // página donde quedó; si no, no se muestra. Si la lista no se había podido cargar, se vuelve a
  // pedir: mostrar solo al usuario nuevo taparía el error.
  const insertUser = (newUser) => {
    if (!isLoaded) {
      loadUsers();
      return;
    }
    const index = users.findIndex((user) => compareUsers(newUser, user) < 0);
    const position = index === -1 ? users.length : index;
    const nextUser = users[position];
    users = users.toSpliced(position, 0, newUser);
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const list = table.querySelector(`th[data-filter="${filter}"] [role="listbox"]`);
      const reference = (nextUser && findOption(list, String(nextUser.id))) ?? list.querySelector('.dropdown-empty');
      list.insertBefore(createOption(newUser, textsOf(newUser)), reference);
    });
    const visibleIndex = users.filter(matchesFilters).indexOf(newUser);
    renderRows(visibleIndex === -1 ? {} : { page: Math.floor(visibleIndex / pagination.pageSize) + 1 });
  };

  // Quita al usuario de la lista en memoria y de las opciones de Usuario, DNI y Email, sin tocar a
  // los demás ni los otros filtros.
  const removeUser = (userId) => {
    const id = String(userId);
    users = users.filter((user) => String(user.id) !== id);
    Object.keys(FILTER_OPTION_TEXTS).forEach((filter) => {
      const header = table.querySelector(`th[data-filter="${filter}"]`);
      const option = findOption(header, id);
      if (!option) return;
      const wasSelected = option.classList.contains('selected');
      option.remove();
      if (!wasSelected) return;
      // El filtro estaba en este usuario: deja de filtrar por él y el embudo se actualiza
      activeFilters[filter] = (activeFilters[filter] ?? []).filter((value) => value !== id);
      header.dispatchEvent(new Event('column-filter-refresh'));
    });
    renderRows();
  };

  // Reemplaza al usuario en la lista en memoria y en las opciones de Usuario, DNI y Email. Conserva
  // su lugar en la lista aunque cambie su apellido: el orden se actualiza en la próxima carga. Si ya
  // no coincide con los filtros activos (p. ej., cambió su rol), su fila deja de mostrarse.
  const replaceUser = (updatedUser) => {
    const id = String(updatedUser.id);
    users = users.map((user) => (String(user.id) === id ? updatedUser : user));
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const header = table.querySelector(`th[data-filter="${filter}"]`);
      const option = findOption(header, id);
      if (!option) return;
      fillOption(option, updatedUser, textsOf(updatedUser));
      // La etiqueta del embudo nombra a las opciones marcadas
      if (option.classList.contains('selected')) header.dispatchEvent(new Event('column-filter-refresh'));
    });
    renderRows();
  };

  // Posición en la página de la fila del botón que abrió el último modal, solo para devolver el
  // foco a la que ocupe su lugar si esa fila ya no se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit o delete) de la fila que quedó en su lugar (o de la última de la
  // página), o "Nuevo usuario" si la tabla quedó sin usuarios
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openModalBtn;
  };

  // ---------- Modal: Nuevo usuario / Editar usuario ----------

  const overlay = document.getElementById('newUserOverlay');
  const modalBody = overlay.querySelector('.modal-body');
  const cancelBtn = document.getElementById('cancelNewUserBtn');
  const createBtn = document.getElementById('createUserBtn');
  const formError = document.getElementById('newUserFormError');

  const textInputs = overlay.querySelectorAll('.modal-body input[type="text"], .modal-body input[type="email"]');
  const roleDropdown = overlay.querySelector('.dropdown');
  const roleLabel = roleDropdown.querySelector('.dropdown-label');
  const roleOptions = roleDropdown.querySelectorAll('.dropdown-option');

  // Máscaras, formato y errores de los campos de texto: componente compartido
  // field-validation.component.js, según el data-validate de cada campo.
  const firstNameInput = document.getElementById('newUserFirstName');
  const lastNameInput = document.getElementById('newUserLastName');
  const dniInput = document.getElementById('newUserDni');
  const emailInput = document.getElementById('newUserEmail');
  const birthdateInput = document.getElementById('newUserBirthdate');

  // Campos que el proceso principal puede marcar (error.fieldErrors), en el orden del formulario
  const FIELD_INPUTS = {
    firstName: firstNameInput,
    lastName: lastNameInput,
    dni: dniInput,
    email: emailInput,
    birthDate: birthdateInput,
  };

  // Error sin mensaje del proceso principal (o sin respuesta) y texto del botón principal, en reposo
  // y mientras se espera la respuesta, según el modo del modal
  const MODAL_TEXTS = {
    create: { genericError: 'No se pudo crear el usuario. Intentá nuevamente.', submit: 'Crear usuario', saving: 'Creando…' },
    edit: { genericError: 'No se pudieron guardar los cambios. Intentá nuevamente.', submit: 'Guardar cambios', saving: 'Guardando…' },
  };

  // Mismos tipos que admite el atributo accept del selector de archivos.
  const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const avatarInput = document.getElementById('avatarFileInput');
  const avatarPreview = document.getElementById('newUserAvatarPreview');
  const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
  const editAvatarBtn = document.getElementById('editAvatarBtn');
  const avatarError = document.getElementById('avatarError');
  const cropDialog = document.getElementById('avatarCropDialog');
  const cropCanvas = document.getElementById('avatarCropCanvas');
  const cropContext = cropCanvas.getContext('2d');
  const avatarZoom = document.getElementById('avatarZoom');
  const avatarZoomValue = document.getElementById('avatarZoomValue');
  let savedCrop = null;
  let draftCrop = null;
  let avatarLoadId = 0;
  let drag = null;

  function renderCrop() {
    if (!draftCrop) return;
    const { image, zoom } = draftCrop;
    const size = cropCanvas.width;
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    // Limitar el movimiento para que nunca queden espacios vacíos en el avatar.
    draftCrop.x = Math.max((size - width) / 2, Math.min((width - size) / 2, draftCrop.x));
    draftCrop.y = Math.max((size - height) / 2, Math.min((height - size) / 2, draftCrop.y));
    cropContext.clearRect(0, 0, size, size);
    cropContext.drawImage(image, (size - width) / 2 + draftCrop.x, (size - height) / 2 + draftCrop.y, width, height);
    avatarZoom.value = String(zoom);
    avatarZoomValue.value = `${Math.round(zoom * 100)}%`;
  }

  function openCrop(crop) {
    draftCrop = { ...crop };
    renderCrop();
    cropDialog.showModal();
    cropCanvas.focus();
  }

  avatarZoom.addEventListener('input', () => {
    if (!draftCrop) return;
    const zoom = Number(avatarZoom.value);
    const ratio = zoom / draftCrop.zoom;
    draftCrop.x *= ratio;
    draftCrop.y *= ratio;
    draftCrop.zoom = zoom;
    renderCrop();
  });

  cropCanvas.addEventListener('pointerdown', (event) => {
    if (!draftCrop || !event.isPrimary || event.button !== 0) return;
    cropCanvas.focus();
    cropCanvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  cropCanvas.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id || !draftCrop) return;
    const ratio = cropCanvas.width / cropCanvas.getBoundingClientRect().width;
    draftCrop.x += (event.clientX - drag.x) * ratio;
    draftCrop.y += (event.clientY - drag.y) * ratio;
    drag.x = event.clientX;
    drag.y = event.clientY;
    renderCrop();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
    cropCanvas.addEventListener(type, () => { drag = null; });
  });
  cropCanvas.addEventListener('keydown', (event) => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction || !draftCrop) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 6;
    draftCrop.x += direction[0] * step;
    draftCrop.y += direction[1] * step;
    renderCrop();
  });
  document.getElementById('resetAvatarCropBtn').addEventListener('click', () => {
    Object.assign(draftCrop, { zoom: 1, x: 0, y: 0 });
    renderCrop();
  });
  document.getElementById('cancelAvatarCropBtn').addEventListener('click', () => cropDialog.close());
  cropDialog.addEventListener('close', () => {
    if (cropDialog.open) return;
    draftCrop = null;
    drag = null;
  });
  document.getElementById('saveAvatarCropBtn').addEventListener('click', () => {
    savedCrop = { ...draftCrop };
    avatarPreview.style.backgroundImage = `url(${cropCanvas.toDataURL('image/png')})`;
    avatarPreview.classList.add('has-image');
    editAvatarBtn.hidden = false;
    cropDialog.close();
  });
  editAvatarBtn.addEventListener('click', () => openCrop(savedCrop));

  // Generación, Mostrar/Ocultar, Copiar y Descartar: componente compartido password-generator.component.js.
  const passwordGenerator = overlay.querySelector('password-generator');

  let isEditing = false;
  let modalTrigger = openModalBtn;
  // usuario_id del usuario que se edita, fijado al abrir el modal desde su fila: es el único que se
  // envía al guardar
  let editingUserId = null;
  let isSaving = false;
  // El usuario que se editaba ya no existe: "Guardar cambios" queda deshabilitado hasta cerrar
  let isUserGone = false;

  const modalTexts = () => MODAL_TEXTS[isEditing ? 'edit' : 'create'];

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => !input.required || input.value.trim().length > 0);
    const hasRole = Boolean(roleDropdown.querySelector('.dropdown-option.selected'));
    createBtn.disabled = isUserGone || !(hasAllTextInputs && hasRole);
  }

  const setFormError = (message) => {
    formError.textContent = message;
    formError.hidden = !message;
  };

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

  function resetForm() {
    textInputs.forEach((input) => (input.value = ''));
    clearFieldErrors(overlay);
    setFormError('');
    isUserGone = false;
    roleOptions.forEach((o) => {
      o.classList.remove('selected');
      o.setAttribute('aria-selected', 'false');
    });
    roleLabel.textContent = 'Seleccionar rol';
    roleLabel.classList.add('placeholder');

    avatarPreview.style.backgroundImage = '';
    avatarPreview.classList.remove('has-image');
    avatarInput.value = '';
    avatarLoadId += 1;
    savedCrop = null;
    editAvatarBtn.hidden = true;
    avatarError.hidden = true;

    passwordGenerator.reset(isEditing ? 'edit' : 'create');

    updateCreateButtonState();
  }

  function openModal(row = null, trigger = openModalBtn) {
    // La fila identifica al usuario solo por su data-user-id (el usuario_id). Los datos del
    // formulario salen del usuario cargado de la base, no del texto de las celdas.
    const user = row ? users.find((candidate) => String(candidate.id) === row.dataset.userId) : null;
    if (row && !user) return;
    isEditing = Boolean(user);
    editingUserId = user?.id ?? null;
    modalTrigger = trigger;
    triggerRowIndex = row ? Math.max(0, Array.from(tbody.rows).indexOf(row)) : 0;
    resetForm();
    document.getElementById('newUserTitle').textContent = isEditing ? 'Editar usuario' : 'Nuevo usuario';
    overlay.querySelector('.modal-header p').textContent = isEditing
      ? 'Modifica los datos del usuario.'
      : 'Completa los datos para crear una nueva cuenta de usuario.';
    createBtn.textContent = modalTexts().submit;
    if (user) {
      firstNameInput.value = user.firstName ?? '';
      lastNameInput.value = user.lastName ?? '';
      dniInput.value = formatDni(user.dni ?? '');
      emailInput.value = user.email ?? '';
      birthdateInput.value = toDisplayDate(user.birthDate);
      // La foto de perfil todavía no se carga ni se guarda.
      roleOptions.forEach((option) => {
        const selected = option.dataset.value === user.role;
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-selected', String(selected));
        if (selected) {
          roleLabel.textContent = option.textContent.trim();
          roleLabel.classList.remove('placeholder');
        }
      });
    }
    updateCreateButtonState();
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    overlay.classList.add('is-open');
    overlay.querySelector('.modal').scrollTop = 0;
    firstNameInput.focus();
  }

  function closeModal() {
    avatarLoadId += 1;
    if (cropDialog.open) cropDialog.close();
    passwordGenerator.clear();
    overlay.classList.remove('is-open');
    // Después de guardar, o si el usuario ya no existe, la tabla se volvió a dibujar: el foco pasa
    // a Editar en la fila del usuario o, si ya no se muestra, en la que quedó en su lugar
    const focusTarget = modalTrigger.isConnected
      ? modalTrigger
      : tbody.querySelector(`tr[data-user-id="${editingUserId}"] [data-action="edit"]`) ?? focusAfterRemoval('edit');
    focusTarget.focus();
    closeAllDropdowns();
  }

  // Solo los datos del formulario: el id va aparte, tomado al abrir el modal. El DNI se envía solo
  // con dígitos, como se guarda.
  const readFormData = () => ({
    firstName: firstNameInput.value,
    lastName: lastNameInput.value,
    dni: dniInput.value.replace(/\D/g, ''),
    email: emailInput.value,
    birthDate: toIsoDate(birthdateInput.value),
    role: roleDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? '',
    password: passwordGenerator.value,
  });

  // Marca los campos que rechazó el proceso principal (DNI o email de otro usuario, datos
  // inválidos) y enfoca el primero. Devuelve false si no había ninguno para marcar.
  const showFieldErrors = (fieldErrors = {}) => {
    const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
    invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
    invalidFields[0]?.[1].focus();
    return invalidFields.length > 0;
  };

  // Crea o guarda según el modo. Con cualquier error, el modal sigue abierto con lo que se escribió
  // y, en el alta, con la misma contraseña.
  const saveUser = async () => {
    const userId = editingUserId;
    setSaving(true);
    let response;
    try {
      response = await (isEditing
        ? window.api?.users?.update(userId, readFormData())
        : window.api?.users?.create(readFormData()));
    } catch (error) {
      console.error('Error al guardar el usuario:', error);
    }
    setSaving(false);

    if (response?.ok) {
      if (isEditing) replaceUser(response.user);
      else insertUser(response.user);
      closeModal();
      return;
    }
    const error = response?.error;
    if (showFieldErrors(error?.fieldErrors)) return;
    setFormError(error?.message || modalTexts().genericError);
    if (isEditing && error?.code === 'USER_NOT_FOUND') {
      // Ya no está vigente: se quita de la tabla, como al eliminarlo, y no se puede reintentar
      isUserGone = true;
      updateCreateButtonState();
      removeUser(userId);
      cancelBtn.focus();
    }
  };

  textInputs.forEach((input) => {
    input.addEventListener('input', updateCreateButtonState);
  });

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.

  openModalBtn.addEventListener('click', () => openModal());
  // Por delegación: las filas se generan al cargar los usuarios, al filtrar y al cambiar de página
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openModal(button.closest('tr'), button);
  });
  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control; el diálogo de recorte cierra solo con su propio Escape. Mientras
  // se guarda, ni Escape ni Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open') && !cropDialog.open && !isSaving) closeModal();
  });
  cancelBtn.addEventListener('click', () => {
    if (!isSaving) closeModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', () => {
    if (isSaving) return;
    setFormError('');
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(overlay)) return;
    // Envía password: passwordGenerator.value, en texto plano (al editar, null conserva la
    // contraseña actual); el proceso principal vuelve a validar todo y guarda solo su hash
    // (password.service.js).
    saveUser();
  });

  // ---------- Modal: Eliminar usuario ----------

  const GENERIC_DELETE_ERROR = 'No se pudo eliminar el usuario. Intentá nuevamente.';
  // El usuario ya no está vigente: se quita de la tabla igual que después de darlo de baja
  const NO_LONGER_ACTIVE_CODES = ['USER_NOT_FOUND', 'USER_ALREADY_DELETED'];

  // El id sale del data-user-id de la fila del botón (el usuario_id, fijado al crearla), no de su
  // posición en la tabla. Resuelve { message } para que el modal lo muestre sin cerrarse.
  const deleteUser = async (trigger) => {
    const row = trigger.closest('tr');
    const userId = Number(row?.dataset.userId);
    let response;
    try {
      response = await window.api?.users?.delete(userId);
    } catch (error) {
      console.error('Error al eliminar el usuario:', error);
    }
    const isNoLongerActive = NO_LONGER_ACTIVE_CODES.includes(response?.error?.code);
    if (response?.ok || isNoLongerActive) {
      triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
      removeUser(userId);
    }
    if (response?.ok) return undefined;
    return { message: response?.error?.message || GENERIC_DELETE_ERROR, canRetry: !isNoLongerActive };
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y muestra el
  // error, o que el usuario ya no está vigente, sin cerrarse. Si la fila ya no está, el foco pasa a
  // Eliminar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('deleteUserOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: deleteUser,
    fallbackFocus: () => focusAfterRemoval('delete'),
  });

  roleOptions.forEach((option) => {
    option.addEventListener('click', () => {
      roleLabel.classList.remove('placeholder');
      updateCreateButtonState();
    });
  });

  uploadAvatarBtn.addEventListener('click', () => avatarInput.click());

  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    const loadId = ++avatarLoadId;
    avatarError.hidden = true;
    const url = URL.createObjectURL(file);
    try {
      if (!AVATAR_TYPES.includes(file.type)) throw new Error('Formato inválido');
      const image = new Image();
      image.src = url;
      await image.decode();
      if (loadId !== avatarLoadId || !overlay.classList.contains('is-open')) return;
      openCrop({ image, zoom: 1, x: 0, y: 0 });
    } catch (error) {
      if (loadId !== avatarLoadId) return;
      avatarError.textContent = 'No se pudo abrir la imagen. Selecciona un archivo JPG, PNG o WebP válido.';
      avatarError.hidden = false;
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});
