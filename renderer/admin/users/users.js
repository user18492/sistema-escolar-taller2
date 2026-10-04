// Vista Usuarios del Administrador: la tabla muestra los demás usuarios de la institución, que
// llegan del proceso principal (window.api.users.list), y los filtros de columna los filtran en
// memoria. La lista filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// Las pestañas (tab-list.component.js) eligen qué usuarios se listan: los vigentes o los dados de
// baja, que llegan en la misma lista con su deletedAt. Los eliminados muestran la fecha de baja en
// lugar del estado y su única acción es Restaurar.
// Nuevo usuario lo crea, siempre activo (window.api.users.create), Editar guarda los cambios, entre
// ellos el estado (window.api.users.update), Eliminar da de baja al usuario (baja lógica,
// window.api.users.delete) y Restaurar devuelve a los vigentes, activo, a uno dado de baja
// (window.api.users.restore). Las dos últimas se confirman antes en un modal
// (confirm-modal.component.js).
// El resultado de las cuatro operaciones se avisa con un toast (toast.component.js), salvo los
// errores de un campo, que se marcan en el formulario.
// La foto de perfil viaja con los datos del modal (el recorte, no el archivo original) y las filas y
// los filtros la muestran con fillAvatar (user-avatar.component.js).

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  const { closeAllDropdowns } = setupDropdowns();

  // Los textos truncados (Usuario / Email) muestran su tooltip con el componente
  // compartido text-truncate.component.js.

  // ---------- Tabla: usuarios de la institución ----------

  const tabList = document.querySelector('.users-card .tab-list');
  const table = document.querySelector('.users-card .data-table');
  const tbody = table.tBodies[0];
  const headerCells = Array.from(table.tHead.rows[0].cells);
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

  // Vigentes y dados de baja juntos, en el orden de la base
  let users = [];
  let isLoaded = false;
  // Pestaña elegida, por su data-tab: 'current' (Vigentes) o 'deleted' (Eliminados)
  let activeTab = tabList.querySelector('[aria-selected="true"]').dataset.tab;
  // Valores elegidos en cada filtro de columna, por su data-filter
  const activeFilters = {};

  // Pestaña donde se lista cada usuario: los dados de baja traen el instante de su baja (deletedAt)
  const tabOf = (user) => (user.deletedAt ? 'deleted' : 'current');
  const tabUsers = (tab = activeTab) => users.filter((user) => tabOf(user) === tab);
  // deletedAt llega en ISO 8601 y se muestra el día, en la hora local, como DD/MM/AAAA
  const deletedDateFormat = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const statusCode = (user) => (user.isActive ? 'ACTIVE' : 'SUSPENDED');
  // "Apellido, Nombre"
  const fullName = (user) => `${user.lastName ?? ''}, ${user.firstName ?? ''}`;
  // "Nombre Apellido", como lo nombran los toasts
  const displayName = (user) => `${user.firstName} ${user.lastName}`;
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

  // Los encabezados con data-tab son de una sola pestaña: Estado de Vigentes, Fecha de baja de
  // Eliminados
  const showTabColumns = () => {
    headerCells.forEach((header) => {
      if (header.dataset.tab) header.hidden = header.dataset.tab !== activeTab;
    });
  };

  const visibleColumnCount = () => headerCells.filter((header) => !header.hidden).length;

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = visibleColumnCount();
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Contador de cada pestaña: el total de sus usuarios, sin contar los filtros de columna. Sin la
  // lista cargada queda vacío y no se muestra (tab-list.css).
  const renderTabCounts = () => {
    tabList.querySelectorAll('[role="tab"]').forEach((tab) => {
      tab.querySelector('.tab-count').textContent = isLoaded ? String(tabUsers(tab.dataset.tab).length) : '';
    });
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML
  const fillOption = (option, user, [name, detail]) => {
    fillAvatar(option.querySelector('.avatar-circle'), user);
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

  // Opciones de Usuario, DNI y Email con los usuarios de la pestaña elegida. Van antes de
  // .dropdown-empty; column-filter.js las lee al usarlas. Llegan sin marcar, así que esos filtros
  // dejan de aplicarse y sus embudos se actualizan.
  const fillFilterOptions = () => {
    const listedUsers = tabUsers();
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const header = table.querySelector(`th[data-filter="${filter}"]`);
      const list = header.querySelector('[role="listbox"]');
      const emptyState = list.querySelector('.dropdown-empty');
      list.replaceChildren(...listedUsers.map((user) => createOption(user, textsOf(user))), emptyState);
      delete activeFilters[filter];
      header.dispatchEvent(new Event('column-filter-refresh'));
    });
  };

  // Deja todos los filtros de columna sin nada elegido (column-filter-reset), sin volver a dibujar
  // la tabla
  const resetFilters = () => {
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    table.querySelectorAll('th.column-filter').forEach((header) => {
      delete activeFilters[header.dataset.filter];
      header.dispatchEvent(new Event('column-filter-reset'));
    });
  };

  const createRow = (user) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.userId = String(user.id);
    // Las acciones de la otra pestaña (data-tab) se quitan antes de insertar la fila: <row-actions>
    // genera sus botones al conectarse
    row.querySelector(`row-actions:not([data-tab="${tabOf(user)}"])`).remove();
    fillAvatar(row.querySelector('.avatar-circle'), user);
    row.querySelector('.user-cell .text-truncate').textContent = fullName(user);
    row.cells[1].textContent = formatDni(user.dni ?? '');
    row.cells[2].querySelector('.text-truncate').textContent = user.email ?? '';
    row.cells[4].textContent = roleLabels[user.role] ?? user.role ?? '';
    if (user.deletedAt) {
      // Eliminados: la fecha de baja ocupa el lugar del estado
      row.cells[3].textContent = deletedDateFormat.format(new Date(user.deletedAt));
      return row;
    }
    // <status-badge> lee sus atributos al conectarse: se fijan antes de insertar la fila
    const status = statusCode(user);
    const badge = row.querySelector('status-badge');
    badge.setAttribute('status', status.toLowerCase());
    badge.setAttribute('label', statusLabels[status]);
    return row;
  };

  // Sin usuarios en la pestaña elegida
  const EMPTY_TAB_MESSAGES = {
    current: 'No hay otros usuarios registrados.',
    deleted: 'No hay usuarios eliminados.',
  };

  // Muestra la página `page` (por defecto, la actual) de los usuarios de la pestaña elegida que
  // pasan los filtros (10 por página, en memoria). Al cambiar un filtro o de pestaña se vuelve a la
  // página 1; al recargar se conserva, y el componente la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const listedUsers = tabUsers();
    const visibleUsers = listedUsers.filter(matchesFilters);
    const pageUsers = pagination.slice(visibleUsers, { page });
    if (pageUsers.length) tbody.replaceChildren(...pageUsers.map(createRow));
    else showMessage(listedUsers.length ? 'Ningún usuario coincide con los filtros.' : EMPTY_TAB_MESSAGES[activeTab]);
  };

  // Punto de entrada también para volver a pedir la lista cuando la que está en memoria quedó
  // vieja. Conserva la pestaña, la página y los filtros de Estado y Rol.
  async function loadUsers() {
    isLoaded = false;
    renderTabCounts();
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
    renderTabCounts();
    renderRows();
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Mientras carga o si la carga
  // falló, se guardan los valores sin reemplazar el mensaje de la tabla.
  table.tHead.addEventListener('column-filter-change', (event) => {
    activeFilters[event.target.dataset.filter] = event.detail.values;
    if (isLoaded) renderRows({ page: 1 });
  });

  // Otra pestaña: sus columnas y sus usuarios, sin filtros de columna y desde la página 1. Los
  // contadores no cambian: salen de la misma lista en memoria. Mientras carga o si la carga falló,
  // el mensaje de la tabla sigue, ajustado a las columnas de la pestaña.
  tabList.addEventListener('tab-change', (event) => {
    activeTab = event.detail.tab;
    showTabColumns();
    resetFilters();
    if (isLoaded) {
      fillFilterOptions();
      renderRows({ page: 1 });
    } else {
      tbody.querySelector('.table-message').colSpan = visibleColumnCount();
    }
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadUsers();

  // ---------- Tabla: cambios después de crear, editar, eliminar o restaurar ----------

  // Sin recargar la lista: se conservan los filtros y, salvo al crear, la página (el componente la
  // acota si la última quedó vacía). Los contadores de las pestañas se actualizan con cada cambio.
  // Solo se vuelve a pedir la lista (loadUsers) si el proceso principal avisa que el usuario ya no
  // está en la pestaña donde se lo ve: otra sesión lo dio de baja o lo restauró y la lista en
  // memoria quedó vieja.

  // Orden aproximado al de la base (apellido, nombre, id): el exacto depende de su intercalación y
  // se aplica en la próxima carga.
  const nameCollator = new Intl.Collator('es');
  const compareUsers = (a, b) =>
    nameCollator.compare(a.lastName ?? '', b.lastName ?? '') ||
    nameCollator.compare(a.firstName ?? '', b.firstName ?? '') ||
    a.id - b.id;

  // Agrega al usuario creado a la lista en memoria, en su lugar alfabético, y lo cuenta en su
  // pestaña (Vigentes). Si es la elegida, lo agrega también a las opciones de Usuario, DNI y Email,
  // sin tocar los filtros: si coincide con los activos, la tabla pasa a la página donde quedó; si
  // no, no se muestra. En Eliminados solo cambia el contador de Vigentes. Si la lista no se había
  // podido cargar, se vuelve a pedir: mostrar solo al usuario nuevo taparía el error.
  const insertUser = (newUser) => {
    if (!isLoaded) {
      loadUsers();
      return;
    }
    const index = users.findIndex((user) => compareUsers(newUser, user) < 0);
    const position = index === -1 ? users.length : index;
    users = users.toSpliced(position, 0, newUser);
    renderTabCounts();
    if (tabOf(newUser) !== activeTab) return;
    // Su opción va antes de la del usuario que lo sigue en la pestaña
    const nextUser = users.slice(position + 1).find((user) => tabOf(user) === activeTab);
    Object.entries(FILTER_OPTION_TEXTS).forEach(([filter, textsOf]) => {
      const list = table.querySelector(`th[data-filter="${filter}"] [role="listbox"]`);
      const reference = (nextUser && findOption(list, String(nextUser.id))) ?? list.querySelector('.dropdown-empty');
      list.insertBefore(createOption(newUser, textsOf(newUser)), reference);
    });
    const visibleIndex = tabUsers().filter(matchesFilters).indexOf(newUser);
    renderRows(visibleIndex === -1 ? {} : { page: Math.floor(visibleIndex / pagination.pageSize) + 1 });
  };

  // Pasa a la otra pestaña al usuario dado de baja o restaurado (`movedUser`, como quedó): lo
  // reemplaza en la lista en memoria, donde conserva su lugar, y actualiza los contadores. Sale de
  // la pestaña elegida (las bajas se hacen desde Vigentes y las restauraciones desde Eliminados),
  // así que también lo quita de las opciones de Usuario, DNI y Email, sin tocar a los demás ni los
  // otros filtros, y su fila deja de mostrarse.
  const moveToOtherTab = (movedUser) => {
    const id = String(movedUser.id);
    users = users.map((user) => (String(user.id) === id ? movedUser : user));
    if (tabOf(movedUser) === activeTab) {
      // Se cambió de pestaña mientras se esperaba la restauración: el usuario llega a la elegida y
      // las opciones de Usuario, DNI y Email se vuelven a armar con él
      fillFilterOptions();
    } else {
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
    }
    renderTabCounts();
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

  // El botón de `action` (edit, delete o restore) de la fila que quedó en su lugar (o de la
  // última de la página), o "Nuevo usuario" si la tabla quedó sin usuarios
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openModalBtn;
  };

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // ---------- Modal: Nuevo usuario / Editar usuario ----------

  const overlay = document.getElementById('newUserOverlay');
  const modalBody = overlay.querySelector('.modal-body');
  const cancelBtn = document.getElementById('cancelNewUserBtn');
  const createBtn = document.getElementById('createUserBtn');

  const textInputs = overlay.querySelectorAll('.modal-body input[type="text"], .modal-body input[type="email"]');
  const roleDropdown = overlay.querySelector('[data-filter="new-user-role"]');
  const roleLabel = roleDropdown.querySelector('.dropdown-label');
  const roleOptions = roleDropdown.querySelectorAll('.dropdown-option');
  // Estado: el campo solo se muestra al editar; un alta crea siempre un usuario activo. Sus opciones
  // usan los mismos valores que el filtro de la columna (statusCode).
  const statusField = document.getElementById('editUserStatusField');
  const statusDropdown = statusField.querySelector('.dropdown');

  const selectedValue = (dropdown) => dropdown.querySelector('.dropdown-option.selected')?.dataset.value;

  // Marca en `dropdown` la opción con ese data-value y la muestra en su etiqueta. Sin una opción con
  // ese valor (null lo restablece) queda sin selección y con el texto inicial de la etiqueta, que
  // dropdown.component.js guarda en data-placeholder.
  const selectDropdownValue = (dropdown, value) => {
    const label = dropdown.querySelector('.dropdown-label');
    let selectedOption = null;
    dropdown.querySelectorAll('.dropdown-option').forEach((option) => {
      const selected = option.dataset.value === value;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) selectedOption = option;
    });
    label.textContent = selectedOption ? selectedOption.textContent.trim() : label.dataset.placeholder;
    label.classList.toggle('placeholder', !selectedOption);
  };

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

  // Texto del botón principal, en reposo y mientras se espera la respuesta, y de los toasts de
  // éxito y de error, según el modo del modal
  const MODAL_TEXTS = {
    create: {
      submit: 'Crear usuario',
      saving: 'Creando…',
      successTitle: 'Usuario creado',
      successDescription: (user) => `Se registró la cuenta de ${displayName(user)}.`,
      errorTitle: 'No se pudo crear el usuario',
    },
    edit: {
      submit: 'Guardar cambios',
      saving: 'Guardando…',
      successTitle: 'Usuario actualizado',
      successDescription: (user) => `Se guardaron los cambios de ${displayName(user)}.`,
      errorTitle: 'No se pudieron guardar los cambios',
    },
  };

  // Mismos tipos que admite el atributo accept del selector de archivos.
  const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  // Tamaño máximo del archivo elegido. Solo se envía el recorte, que es más liviano.
  const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024;

  const avatarInput = document.getElementById('avatarFileInput');
  const avatarPreview = document.getElementById('newUserAvatarPreview');
  const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
  const editAvatarBtn = document.getElementById('editAvatarBtn');
  const removeAvatarBtn = document.getElementById('removeAvatarBtn');
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
  // Foto guardada del usuario que se edita (su imageUrl al abrir el modal), o null
  let currentImageUrl = null;
  // Recorte confirmado con "Usar encuadre", que se envía al guardar: promesa del PNG (Uint8Array), o null
  let pendingImage = null;
  // Se pulsó "Quitar foto" sobre la foto guardada: al guardar se pide quitarla
  let isImageRemoved = false;

  // Vista previa del modal: la foto de `url` o, con null, el ícono
  const setAvatarPreview = (url) => {
    avatarPreview.style.backgroundImage = url ? `url("${url}")` : '';
    avatarPreview.classList.toggle('has-image', Boolean(url));
  };

  const showAvatarError = (message) => {
    avatarError.textContent = message;
    avatarError.hidden = false;
  };

  // Vista previa de la foto guardada del usuario que se edita. Si no carga (p. ej., se subió desde
  // otra PC), queda el ícono.
  async function showCurrentImage() {
    const loadId = ++avatarLoadId;
    const image = new Image();
    image.src = currentImageUrl;
    try {
      await image.decode();
    } catch {
      return;
    }
    if (loadId === avatarLoadId) setAvatarPreview(currentImageUrl);
  }

  // PNG del recorte, del tamaño de #avatarCropCanvas: su width y su height deben coincidir con
  // PROFILE_IMAGE_SIZE (profile-image.service.js), que rechaza otro tamaño. El proceso principal lo
  // guarda como JPEG, sin transparencia: el fondo blanco evita que lo transparente quede negro.
  const exportCrop = () => {
    const canvas = document.createElement('canvas');
    canvas.width = cropCanvas.width;
    canvas.height = cropCanvas.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(cropCanvas, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo exportar el recorte.'))), 'image/png');
    }).then(async (blob) => new Uint8Array(await blob.arrayBuffer()));
  };

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
    pendingImage = exportCrop();
    isImageRemoved = false;
    setAvatarPreview(cropCanvas.toDataURL('image/png'));
    editAvatarBtn.hidden = false;
    removeAvatarBtn.hidden = false;
    cropDialog.close();
  });
  editAvatarBtn.addEventListener('click', () => openCrop(savedCrop));

  // Vuelve al ícono: descarta el recorte elegido y, si el usuario tenía una foto guardada, la quita
  // al guardar. El foco pasa a "Subir imagen", porque este botón se oculta.
  removeAvatarBtn.addEventListener('click', () => {
    avatarLoadId += 1;
    pendingImage = null;
    savedCrop = null;
    isImageRemoved = Boolean(currentImageUrl);
    setAvatarPreview(null);
    avatarError.hidden = true;
    uploadAvatarBtn.focus();
    editAvatarBtn.hidden = true;
    removeAvatarBtn.hidden = true;
  });

  // Generación, Mostrar/Ocultar, Copiar y Descartar: componente compartido password-generator.component.js.
  const passwordGenerator = overlay.querySelector('password-generator');

  let isEditing = false;
  let modalTrigger = openModalBtn;
  // usuario_id del usuario que se edita, fijado al abrir el modal desde su fila: es el único que se
  // envía al guardar
  let editingUserId = null;
  let isSaving = false;

  const modalTexts = () => MODAL_TEXTS[isEditing ? 'edit' : 'create'];

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => !input.required || input.value.trim().length > 0);
    const hasRole = Boolean(selectedValue(roleDropdown));
    // Al editar llega elegido el estado actual del usuario; en el alta no se elige
    const hasStatus = !isEditing || Boolean(selectedValue(statusDropdown));
    createBtn.disabled = !(hasAllTextInputs && hasRole && hasStatus);
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

  function resetForm() {
    textInputs.forEach((input) => (input.value = ''));
    clearFieldErrors(overlay);
    selectDropdownValue(roleDropdown, null);
    selectDropdownValue(statusDropdown, null);

    setAvatarPreview(null);
    avatarInput.value = '';
    avatarLoadId += 1;
    savedCrop = null;
    currentImageUrl = null;
    pendingImage = null;
    isImageRemoved = false;
    editAvatarBtn.hidden = true;
    removeAvatarBtn.hidden = true;
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
    statusField.hidden = !isEditing;
    if (user) {
      firstNameInput.value = user.firstName ?? '';
      lastNameInput.value = user.lastName ?? '';
      dniInput.value = formatDni(user.dni ?? '');
      emailInput.value = user.email ?? '';
      birthdateInput.value = toDisplayDate(user.birthDate);
      if (user.imageUrl) {
        // Sin el archivo original no se puede reencuadrar (sin lápiz), pero sí quitar o reemplazar.
        // "Quitar foto" se ofrece aunque no cargue la vista previa: la base la tiene registrada.
        currentImageUrl = user.imageUrl;
        removeAvatarBtn.hidden = false;
        showCurrentImage();
      }
      selectDropdownValue(roleDropdown, user.role);
      selectDropdownValue(statusDropdown, statusCode(user));
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
  // con dígitos, como se guarda. El estado (isActive) va solo al editar.
  const readFormData = () => ({
    firstName: firstNameInput.value,
    lastName: lastNameInput.value,
    dni: dniInput.value.replace(/\D/g, ''),
    email: emailInput.value,
    birthDate: toIsoDate(birthdateInput.value),
    role: selectedValue(roleDropdown) ?? '',
    password: passwordGenerator.value,
    ...(isEditing && { isActive: selectedValue(statusDropdown) === 'ACTIVE' }),
  });

  // Marca los campos que rechazó el proceso principal (DNI o email de otro usuario, datos
  // inválidos) y enfoca el primero. Devuelve false si no había ninguno para marcar.
  const showFieldErrors = (fieldErrors = {}) => {
    const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
    invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
    invalidFields[0]?.[1].focus();
    return invalidFields.length > 0;
  };

  // Crea o guarda según el modo; al terminar cierra el modal y lo avisa con un toast. Los errores de
  // un campo se marcan en el formulario y los demás salen en un toast: en ambos casos el modal sigue
  // abierto con lo que se escribió, la foto elegida y, en el alta, la misma contraseña. Solo se
  // cierra si el usuario que se editaba ya no existe.
  const saveUser = async () => {
    const userId = editingUserId;
    setSaving(true);
    let response;
    try {
      // image null no cambia la foto (en el alta, crea al usuario sin foto)
      const image = pendingImage ? await pendingImage : null;
      const data = { ...readFormData(), image, removeImage: isImageRemoved };
      response = await (isEditing
        ? window.api?.users?.update(userId, data)
        : window.api?.users?.create(data));
    } catch (error) {
      console.error('Error al guardar el usuario:', error);
    }
    // El usuario que se editaba ya no está vigente: la lista se vuelve a pedir antes de liberar el
    // modal, que se cierra más abajo
    const isGone = isEditing && response?.error?.code === 'USER_NOT_FOUND';
    if (isGone) await loadUsers();
    setSaving(false);

    if (response?.ok) {
      if (isEditing) replaceUser(response.user);
      else insertUser(response.user);
      closeModal();
      showToast({
        type: 'success',
        title: modalTexts().successTitle,
        description: modalTexts().successDescription(response.user),
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
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(overlay)) return;
    // Envía password: passwordGenerator.value, en texto plano (al editar, null conserva la
    // contraseña actual); el proceso principal vuelve a validar todo y guarda solo su hash
    // (password.service.js).
    saveUser();
  });

  // ---------- Modal: Eliminar usuario ----------

  // El usuario ya no está vigente: la lista en memoria quedó vieja y se vuelve a pedir
  const NO_LONGER_ACTIVE_CODES = ['USER_NOT_FOUND', 'USER_ALREADY_DELETED'];

  // El id sale del data-user-id de la fila del botón (el usuario_id, fijado al crearla), no de su
  // posición en la tabla. Avisa el resultado con un toast y no resuelve ningún mensaje, así el
  // modal se cierra siempre.
  const deleteUser = async (trigger) => {
    const row = trigger.closest('tr');
    const userId = Number(row?.dataset.userId);
    let response;
    try {
      response = await window.api?.users?.delete(userId);
    } catch (error) {
      console.error('Error al eliminar el usuario:', error);
    }
    const isGone = NO_LONGER_ACTIVE_CODES.includes(response?.error?.code);
    // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
    if (response?.ok || isGone) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      moveToOtherTab(response.user);
      showToast({
        type: 'success',
        title: 'Usuario eliminado',
        description: `La cuenta de ${displayName(response.user)} pasó a Eliminados.`,
      });
      return;
    }
    if (isGone) await loadUsers();
    showToast({ type: 'error', title: 'No se pudo eliminar el usuario', description: errorDescription(response?.error) });
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y después se
  // cierra. Si la fila ya no está, el foco pasa a Eliminar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('deleteUserOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: deleteUser,
    fallbackFocus: () => focusAfterRemoval('delete'),
  });

  // ---------- Modal: Restaurar usuario ----------

  // El usuario ya no está dado de baja: la lista en memoria quedó vieja y se vuelve a pedir
  const NO_LONGER_DELETED_CODES = ['USER_NOT_FOUND', 'USER_NOT_DELETED'];

  // Como en la baja: el id sale del data-user-id de la fila del botón, el resultado se avisa con un
  // toast y no se resuelve ningún mensaje, así el modal se cierra siempre.
  const restoreUser = async (trigger) => {
    const row = trigger.closest('tr');
    const userId = Number(row?.dataset.userId);
    let response;
    try {
      response = await window.api?.users?.restore(userId);
    } catch (error) {
      console.error('Error al restaurar el usuario:', error);
    }
    const isStale = NO_LONGER_DELETED_CODES.includes(response?.error?.code);
    // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
    if (response?.ok || isStale) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      moveToOtherTab(response.user);
      showToast({
        type: 'success',
        title: 'Usuario restaurado',
        description: `La cuenta de ${displayName(response.user)} volvió a Vigentes como activa.`,
      });
      return;
    }
    if (isStale) await loadUsers();
    showToast({ type: 'error', title: 'No se pudo restaurar el usuario', description: errorDescription(response?.error) });
  };

  // El mismo componente que Eliminar, con action="restore" en su marcado: lo abre Restaurar. Si
  // la fila ya no está, el foco pasa a Restaurar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('restoreUserOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: restoreUser,
    fallbackFocus: () => focusAfterRemoval('restore'),
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
    if (file.size > AVATAR_MAX_FILE_BYTES) {
      showAvatarError('La imagen supera los 5 MB. Selecciona una más liviana.');
      return;
    }
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
      showAvatarError('No se pudo abrir la imagen. Selecciona un archivo JPG, PNG o WebP válido.');
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});
