// Vista Usuarios del Administrador: la tabla muestra los demás usuarios de la institución, que
// llegan del proceso principal (window.api.users.list), y los filtros de columna los filtran en
// memoria. La lista filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// Eliminar da de baja al usuario (baja lógica, window.api.users.delete); alta y edición siguen
// siendo solo visuales.

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
  // "Apellido, Nombre": el modal de edición separa los dos por ", "
  const fullName = (user) => `${user.lastName ?? ''}, ${user.firstName ?? ''}`;
  const initialsOf = (user) =>
    [user.firstName, user.lastName].map((name) => name?.trim().charAt(0) ?? '').join('').toUpperCase();
  // La fecha llega como 'AAAA-MM-DD' (o null) y el campo del modal usa DD/MM/AAAA
  const toDisplayDate = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('/') : '');

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
  const createOption = (user, [name, detail]) => {
    const option = optionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(user.id);
    option.querySelector('.avatar-circle').textContent = initialsOf(user);
    option.querySelector('.option-name').textContent = name ?? '';
    option.querySelector('.option-email').textContent = detail ?? '';
    return option;
  };

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

  // Muestra la página actual de los usuarios filtrados (10 por página, en memoria). Al cambiar un
  // filtro se vuelve a la página 1; al recargar se conserva, y el componente la acota a la última
  // que quede.
  const renderRows = ({ resetPage = false } = {}) => {
    const visibleUsers = users.filter(matchesFilters);
    const pageUsers = pagination.slice(visibleUsers, resetPage ? { page: 1 } : {});
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
    if (isLoaded) renderRows({ resetPage: true });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => renderRows());

  loadUsers();

  // ---------- Modal: Nuevo usuario ----------

  const overlay = document.getElementById('newUserOverlay');
  const openModalBtn = document.getElementById('openNewUserModalBtn');
  const cancelBtn = document.getElementById('cancelNewUserBtn');
  const createBtn = document.getElementById('createUserBtn');

  const textInputs = overlay.querySelectorAll('.modal-body input[type="text"], .modal-body input[type="email"]');
  const roleDropdown = overlay.querySelector('.dropdown');
  const roleLabel = roleDropdown.querySelector('.dropdown-label');
  const roleOptions = roleDropdown.querySelectorAll('.dropdown-option');

  // Máscaras, formato y errores de los campos de texto: componente compartido
  // field-validation.component.js, según el data-validate de cada campo.
  const dniInput = document.getElementById('newUserDni');
  const birthdateInput = document.getElementById('newUserBirthdate');

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

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => !input.required || input.value.trim().length > 0);
    const hasRole = Boolean(roleDropdown.querySelector('.dropdown-option.selected'));
    createBtn.disabled = !(hasAllTextInputs && hasRole);
  }

  function resetForm() {
    textInputs.forEach((input) => (input.value = ''));
    clearFieldErrors(overlay);
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
    isEditing = Boolean(row);
    modalTrigger = trigger;
    resetForm();
    document.getElementById('newUserTitle').textContent = isEditing ? 'Editar usuario' : 'Nuevo usuario';
    overlay.querySelector('.modal-header p').textContent = isEditing
      ? 'Modifica los datos del usuario.'
      : 'Completa los datos para crear una nueva cuenta de usuario.';
    createBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear usuario';
    if (row) {
      const [lastName, firstName] = row.querySelector('.user-cell > span:last-child').textContent.trim().split(', ');
      document.getElementById('newUserFirstName').value = firstName;
      document.getElementById('newUserLastName').value = lastName;
      dniInput.value = row.cells[1].textContent.trim();
      document.getElementById('newUserEmail').value = row.cells[2].textContent.trim();
      // La fecha de nacimiento no se muestra en la tabla: sale del usuario cargado de la base.
      // La foto de perfil todavía no se carga.
      const user = users.find((candidate) => String(candidate.id) === row.dataset.userId);
      birthdateInput.value = toDisplayDate(user?.birthDate);
      roleOptions.forEach((option) => {
        const selected = option.textContent.trim() === row.cells[4].textContent.trim();
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-selected', String(selected));
        if (selected) roleLabel.textContent = option.textContent.trim();
      });
      roleLabel.classList.remove('placeholder');
    }
    updateCreateButtonState();
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    overlay.classList.add('is-open');
    overlay.querySelector('.modal').scrollTop = 0;
    document.getElementById('newUserFirstName').focus();
  }

  function closeModal() {
    avatarLoadId += 1;
    if (cropDialog.open) cropDialog.close();
    passwordGenerator.clear();
    overlay.classList.remove('is-open');
    modalTrigger.focus();
    closeAllDropdowns();
  }

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
  // quedado fuera de un control; el diálogo de recorte cierra solo con su propio Escape.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open') && !cropDialog.open) closeModal();
  });
  cancelBtn.addEventListener('click', closeModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', () => {
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(overlay)) return;
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    // Enviará password: passwordGenerator.value, que en la edición es null para conservar la
    // contraseña actual; el proceso principal la valida y la hashea (password.service.js).
    closeModal();
  });

  // ---------- Modal: Eliminar usuario ----------

  const GENERIC_DELETE_ERROR = 'No se pudo eliminar el usuario. Intentá nuevamente.';
  // El usuario ya no está vigente: se quita de la tabla igual que después de darlo de baja
  const NO_LONGER_ACTIVE_CODES = ['USER_NOT_FOUND', 'USER_ALREADY_DELETED'];
  // Posición de la fila quitada, solo para devolver el foco a la que ocupe su lugar
  let removedRowIndex = 0;

  // Quita al usuario de la lista en memoria y de las opciones de Usuario, DNI y Email, sin tocar a
  // los demás, los otros filtros ni la página (el componente la acota si la última quedó vacía).
  const removeUser = (userId) => {
    const id = String(userId);
    users = users.filter((user) => String(user.id) !== id);
    Object.keys(FILTER_OPTION_TEXTS).forEach((filter) => {
      const header = table.querySelector(`th[data-filter="${filter}"]`);
      const option = Array.from(header.querySelectorAll('.dropdown-option')).find((candidate) => candidate.dataset.value === id);
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
      removedRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
      removeUser(userId);
    }
    if (response?.ok) return undefined;
    return { message: response?.error?.message || GENERIC_DELETE_ERROR, canRetry: !isNoLongerActive };
  };

  // Su fila ya no está: el foco pasa a Eliminar en la fila que quedó en su lugar (o en la última de
  // la página), o a "Nuevo usuario" si la tabla quedó sin usuarios
  const focusAfterRemoval = () => {
    const deleteButtons = tbody.querySelectorAll('[data-action="delete"]');
    return deleteButtons[Math.min(removedRowIndex, deleteButtons.length - 1)] ?? openModalBtn;
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y muestra el
  // error, o que el usuario ya no está vigente, sin cerrarse.
  setupConfirmModal(document.getElementById('deleteUserOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: deleteUser,
    fallbackFocus: focusAfterRemoval,
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
