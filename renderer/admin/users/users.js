// Vista Usuarios del Administrador — interacción puramente visual, sin lógica de negocio
const ROLE_LABELS = { ADMIN: 'Administrador', SECRETARY: 'Secretario', TEACHER: 'Profesor' };

const ESTADO_INFO = {
  ACTIVE: {
    label: 'Activo',
    badgeClass: 'badge-active',
    icon: '<path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
  },
  SUSPENDED: {
    label: 'Suspendido',
    badgeClass: 'badge-suspended',
    icon: '<path d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />',
  },
};

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function formatDniDisplay(dni) {
  const digits = (dni || '').replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function renderUsersTable(tbody, usuarios) {
  tbody.innerHTML = usuarios.map((usuario) => {
    const iniciales = `${(usuario.nombre || '').charAt(0)}${(usuario.apellido || '').charAt(0)}`.toUpperCase();
    const rolLabel = ROLE_LABELS[usuario.rol] || usuario.rol;
    const estado = ESTADO_INFO[usuario.estado] || { label: usuario.estado, badgeClass: 'badge-active', icon: '' };

    return `
      <tr data-usuario-id="${usuario.usuario_id}">
        <td>
          <div class="user-cell">
            <span class="avatar-circle">${iniciales}</span>
            <span>${escapeHtml(usuario.apellido)}, ${escapeHtml(usuario.nombre)}</span>
          </div>
        </td>
        <td>${formatDniDisplay(usuario.dni)}</td>
        <td>${escapeHtml(usuario.email)}</td>
        <td>
          <span class="badge ${estado.badgeClass}">
            <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${estado.icon}</svg>
            ${estado.label}
          </span>
        </td>
        <td>${rolLabel}</td>
        <td>
          <div class="user-actions">
            <button class="user-action" type="button" data-action="edit" aria-label="Editar usuario" title="Editar usuario">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
            </button>
            <button class="user-action" type="button" data-action="delete" aria-label="Borrar usuario" title="Borrar usuario">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {

  const dropdowns = document.querySelectorAll('.dropdown');

  const closeDropdown = (dropdown) => {
    dropdown.classList.remove('open');
    dropdown.querySelector('.dropdown-toggle').setAttribute('aria-expanded', 'false');
    dropdown.querySelector('.dropdown-menu').hidden = true;
  };

  const closeAllDropdowns = (except) => {
    dropdowns.forEach((dropdown) => {
      if (dropdown !== except) closeDropdown(dropdown);
    });
  };

  dropdowns.forEach((dropdown) => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const label = dropdown.querySelector('.dropdown-label');
    const menu = dropdown.querySelector('.dropdown-menu');
    const options = dropdown.querySelectorAll('.dropdown-option');

    toggle.addEventListener('click', () => {
      const isOpen = dropdown.classList.contains('open');
      closeAllDropdowns(dropdown);

      if (isOpen) {
        closeDropdown(dropdown);
        return;
      }

      dropdown.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
    });

    options.forEach((option) => {
      option.addEventListener('click', () => {
        options.forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        option.classList.add('selected');
        option.setAttribute('aria-selected', 'true');
        label.textContent = option.textContent.trim();
        closeDropdown(dropdown);
      });
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllDropdowns();
    }
  });

  // ---------- Modal: Nuevo usuario ----------

  const overlay = document.getElementById('newUserOverlay');
  const openModalBtn = document.getElementById('openNewUserModalBtn');
  const cancelBtn = document.getElementById('cancelNewUserBtn');
  const createBtn = document.getElementById('createUserBtn');

  const textInputs = overlay.querySelectorAll('.modal-body input[type="text"], .modal-body input[type="email"]');
  const roleDropdown = overlay.querySelector('.dropdown');
  const roleLabel = roleDropdown.querySelector('.dropdown-label');
  const roleOptions = roleDropdown.querySelectorAll('.dropdown-option');

  const dniInput = document.getElementById('newUserDni');

  function formatDniInput() {
    const digitsBeforeCursor = dniInput.value.slice(0, dniInput.selectionStart).replace(/\D/g, '').length;
    const digits = dniInput.value.replace(/\D/g, '').slice(0, 8);
    const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    let cursor = 0;
    let digitCount = 0;

    // Mantener el cursor junto al mismo dígito al insertar o quitar los puntos.
    while (cursor < formatted.length && digitCount < digitsBeforeCursor) {
      if (formatted[cursor] !== '.') digitCount += 1;
      cursor += 1;
    }

    dniInput.value = formatted;
    dniInput.setSelectionRange(cursor, cursor);
  }

  dniInput.addEventListener('input', formatDniInput);

  const birthdateInput = document.getElementById('newUserBirthdate');

  function formatBirthdateInput() {
    const digits = birthdateInput.value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits.slice(0, 2);
    if (digits.length > 2) formatted += '/' + digits.slice(2, 4);
    if (digits.length > 4) formatted += '/' + digits.slice(4, 8);
    birthdateInput.value = formatted;
  }

  birthdateInput.addEventListener('input', formatBirthdateInput);

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
  let avatarDataUrl = null;
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
    avatarDataUrl = cropCanvas.toDataURL('image/png');
    avatarPreview.style.backgroundImage = `url(${avatarDataUrl})`;
    avatarPreview.classList.add('has-image');
    editAvatarBtn.hidden = false;
    cropDialog.close();
  });
  editAvatarBtn.addEventListener('click', () => openCrop(savedCrop));

  const generatePasswordBtn = document.getElementById('generatePasswordBtn');
  const passwordValueEl = document.getElementById('generatedPasswordValue');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const copyPasswordBtn = document.getElementById('copyPasswordBtn');

  let currentPassword = '';
  let isEditing = false;
  let modalTrigger = openModalBtn;
  const passwordDisplay = overlay.querySelector('.password-display');
  const passwordHelp = overlay.querySelector('.password-heading p');

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => (isEditing && input === birthdateInput) || input.value.trim().length > 0);
    const hasRole = Boolean(roleDropdown.querySelector('.dropdown-option.selected'));
    createBtn.disabled = !(hasAllTextInputs && hasRole);
  }

  function generatePassword(length = 14) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    const values = new Uint32Array(length);
    crypto.getRandomValues(values);
    return Array.from(values, (n) => chars[n % chars.length]).join('');
  }

  function renderPassword() {
    const isVisible = passwordValueEl.dataset.visible === 'true';
    passwordValueEl.textContent = isVisible ? currentPassword : '•'.repeat(currentPassword.length);
    togglePasswordBtn.querySelector('span').textContent = isVisible ? 'Ocultar' : 'Mostrar';
  }

  function resetForm() {
    textInputs.forEach((input) => (input.value = ''));
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
    avatarDataUrl = null; //para que no arrastre la imagen de un alta anterior
    editAvatarBtn.hidden = true;
    avatarError.hidden = true;

    passwordValueEl.dataset.visible = 'false';
    currentPassword = generatePassword();
    renderPassword();

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
    passwordDisplay.hidden = isEditing;
    passwordHelp.textContent = isEditing
      ? 'Genera una nueva contraseña solo si necesitas reemplazar la actual.'
      : 'Se generará automáticamente una contraseña segura.';
    if (row) {
      const [lastName, firstName] = row.querySelector('.user-cell > span:last-child').textContent.trim().split(', ');
      document.getElementById('newUserFirstName').value = firstName;
      document.getElementById('newUserLastName').value = lastName;
      dniInput.value = row.cells[1].textContent.trim();
      document.getElementById('newUserEmail').value = row.cells[2].textContent.trim();
      // La maqueta de la tabla no contiene fecha de nacimiento ni foto de perfil.
      roleOptions.forEach((option) => {
        const selected = option.textContent.trim() === row.cells[4].textContent.trim();
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-selected', String(selected));
        if (selected) roleLabel.textContent = option.textContent.trim();
      });
      roleLabel.classList.remove('placeholder');
      currentPassword = '';
      renderPassword();
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
    overlay.classList.remove('is-open');
    modalTrigger.focus();
    closeAllDropdowns();
  }

  textInputs.forEach((input) => {
    input.addEventListener('input', updateCreateButtonState);
  });

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.

  openModalBtn.addEventListener('click', () => openModal());
  const usersTbody = document.querySelector('.data-table tbody');

  usersTbody.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-action="edit"]');
    if (editButton) {
      openModal(editButton.closest('tr'), editButton);
      return;
    }
    const deleteButton = event.target.closest('[data-action="delete"]');
    if (deleteButton) {
      openDeleteModal(deleteButton);
    }
  });

  async function cargarUsuarios() {
    try {
      const usuarios = await window.api.usuarios.listar();
      renderUsersTable(usersTbody, usuarios);
    } catch (error) {
      console.error('No se pudo cargar la lista de usuarios:', error);
    }
  }

  cargarUsuarios();

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !cropDialog.open) closeModal();
  });
  cancelBtn.addEventListener('click', closeModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', async () => {
  if (isEditing) {
    // TODO: conectar la edición real cuando exista el UPDATE correspondiente.
    closeModal();
    return;
  }

  const [day, month, year] = birthdateInput.value.split('/');
  const fechaNacimiento = day && month && year ? `${year}-${month}-${day}` : null;
  const rolSeleccionado = roleDropdown.querySelector('.dropdown-option.selected');

  const datos = {
    nombre: document.getElementById('newUserFirstName').value.trim(),
    apellido: document.getElementById('newUserLastName').value.trim(),
    dni: dniInput.value.replace(/\D/g, ''),
    email: document.getElementById('newUserEmail').value.trim(),
    fechaNacimiento,
    rol: rolSeleccionado.dataset.value,
    passwordPlano: currentPassword,
    imagenUrl: avatarDataUrl,
  };

  createBtn.disabled = true;
  try {
    await window.api.usuarios.crear(datos);
    closeModal();
    cargarUsuarios() //agregada la carga de users
    
  } catch (error) {
    console.error('No se pudo crear el usuario:', error);
    alert('No se pudo crear el usuario. Revisá los datos e intentá de nuevo.');
  } finally {
    createBtn.disabled = false;
  }
});

  // ---------- Modal: Eliminar usuario ----------

  const deleteOverlay = document.getElementById('deleteUserOverlay');
  const cancelDeleteBtn = document.getElementById('cancelDeleteUserBtn');
  let deleteTrigger = null;

  function openDeleteModal(trigger) {
    deleteTrigger = trigger;
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    deleteOverlay.classList.add('is-open');
    // "Cancelar" recibe el foco para evitar eliminaciones accidentales con Enter.
    cancelDeleteBtn.focus();
  }

  function closeDeleteModal() {
    deleteOverlay.classList.remove('is-open');
    deleteTrigger?.focus();
  }

  
  deleteOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDeleteModal();
  });
  cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDeleteUserBtn').addEventListener('click', () => {
    // Vista puramente visual: la eliminación real se conecta cuando exista la capa de servicios/IPC.
    closeDeleteModal();
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
      if (!file.type.startsWith('image/')) throw new Error('Formato inválido');
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

  generatePasswordBtn.addEventListener('click', () => {
    passwordDisplay.hidden = false;
    currentPassword = generatePassword();
    passwordValueEl.dataset.visible = 'false';
    renderPassword();
  });

  togglePasswordBtn.addEventListener('click', () => {
    const isVisible = passwordValueEl.dataset.visible === 'true';
    passwordValueEl.dataset.visible = String(!isVisible);
    renderPassword();
  });

  copyPasswordBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentPassword);
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = currentPassword;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    const label = copyPasswordBtn.querySelector('span');
    const originalLabel = label.textContent;
    copyPasswordBtn.classList.add('copied');
    label.textContent = 'Copiado';

    setTimeout(() => {
      copyPasswordBtn.classList.remove('copied');
      label.textContent = originalLabel;
    }, 1500);
  });
});
