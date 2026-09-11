// Vista Usuarios del Administrador — interacción puramente visual, sin lógica de negocio

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

  // Los encabezados conservan las listas y la selección visual de los filtros.
  document.querySelectorAll('.column-filter').forEach((root) => {
    const toggle = root.querySelector('.column-filter-toggle');
    const panel = root.querySelector('.column-filter-panel');
    const input = panel.querySelector('.searchable-input');
    const options = Array.from(panel.querySelectorAll('.dropdown-option'));
    const emptyState = panel.querySelector('.dropdown-empty');
    const clearButton = panel.querySelector('.column-filter-clear');
    const filterLabel = toggle.getAttribute('aria-label');

    const filterOptions = () => {
      const query = input ? input.value.trim().toLocaleLowerCase('es') : '';
      options.forEach((option) => {
        option.hidden = !option.textContent.toLocaleLowerCase('es').includes(query);
      });
      if (emptyState) emptyState.hidden = options.some((option) => !option.hidden);
    };

    const positionPanel = () => {
      const anchor = toggle.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const availableBelow = window.innerHeight - anchor.bottom - gap - margin;
      const availableAbove = anchor.top - gap - margin;
      const openAbove = availableBelow < panel.scrollHeight && availableAbove > availableBelow;
      panel.style.maxHeight = `${Math.max(0, openAbove ? availableAbove : availableBelow)}px`;
      panel.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - margin))}px`;
      panel.style.top = `${openAbove ? anchor.top - panel.offsetHeight - gap : anchor.bottom + gap}px`;
    };

    const closePanel = () => {
      panel.hidePopover();
      toggle.focus({ preventScroll: true });
    };

    const selectOption = (selectedOption) => {
      const hasSelection = Boolean(selectedOption && selectedOption.dataset.value);
      options.forEach((option) => {
        const selected = option === selectedOption;
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-selected', String(selected));
      });
      toggle.classList.toggle('has-selection', hasSelection);
      toggle.setAttribute('aria-label', hasSelection
        ? `${filterLabel}: ${(selectedOption.querySelector('.option-name') || selectedOption).textContent.trim()}`
        : filterLabel);
      closePanel();
    };

    panel.addEventListener('beforetoggle', (event) => {
      const isOpen = event.newState === 'open';
      toggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        closeAllDropdowns();
        if (input) input.value = '';
        filterOptions();
      }
    });

    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) return;
      positionPanel();
      (input || options.find((option) => option.classList.contains('selected')) || options[0]).focus({ preventScroll: true });
    });

    options.forEach((option) => {
      option.tabIndex = 0;
      option.addEventListener('click', () => selectOption(option));
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectOption(option);
        }
      });
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const visibleOptions = options.filter((option) => !option.hidden);
      if (!visibleOptions.length) return;
      const current = visibleOptions.indexOf(document.activeElement);
      const next = current < 0
        ? (event.key === 'ArrowDown' ? 0 : visibleOptions.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + visibleOptions.length) % visibleOptions.length;
      visibleOptions[next].focus();
    });

    if (input) input.addEventListener('input', filterOptions);
    clearButton.addEventListener('click', () => selectOption(null));
    window.addEventListener('resize', () => {
      if (panel.matches(':popover-open')) positionPanel();
    });
    document.addEventListener('scroll', (event) => {
      if (panel.matches(':popover-open') && !panel.contains(event.target)) panel.hidePopover();
    }, true);
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

  const generatePasswordBtn = document.getElementById('generatePasswordBtn');
  const passwordValueEl = document.getElementById('generatedPasswordValue');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const copyPasswordBtn = document.getElementById('copyPasswordBtn');

  let currentPassword = '';
  let isEditing = false;
  let modalTrigger = openModalBtn;
  const dangerZone = document.getElementById('userDangerZone');
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
    dangerZone.hidden = !isEditing;
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

  openModalBtn.addEventListener('click', () => openModal());
  document.querySelectorAll('.data-table tbody [data-action="edit"]').forEach((button) => {
    button.addEventListener('click', () => openModal(button.closest('tr'), button));
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !cropDialog.open) closeModal();
    if (event.key !== 'Tab') return;
    const controls = Array.from(overlay.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]'))
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  cancelBtn.addEventListener('click', closeModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeModal();
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
