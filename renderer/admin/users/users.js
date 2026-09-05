// Vista Usuarios del Administrador — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  sidebarToggle.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  });

  const dropdowns = document.querySelectorAll('.dropdown');

  let searchableSelects = [];
  const closeAllSearchableMenus = (except) => {
    searchableSelects.forEach((select) => {
      if (select.root !== except) select.close();
    });
  };

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
      closeAllSearchableMenus();

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
    if (!event.target.closest('.dropdown-searchable')) {
      closeAllSearchableMenus();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllDropdowns();
      closeAllSearchableMenus();
    }
  });

  // ---------- Filtro: Buscar por nombre (dropdown con búsqueda integrada) ----------

  // Campo con búsqueda integrada: un único componente que combina un input de filtro
  // y una lista desplegable (mismo patrón usado en Docencia > Nueva asignación > Profesor).
  function setupSearchableSelect(root) {
    const bar = root.querySelector('.searchable-bar');
    const input = bar.querySelector('.searchable-input');
    const valueBox = bar.querySelector('.searchable-value');
    const chevronBtn = bar.querySelector('.searchable-chevron');
    const menu = root.querySelector('.dropdown-menu');
    const options = Array.from(menu.querySelectorAll('.dropdown-option'));
    const emptyState = menu.querySelector('.dropdown-empty');

    let selectedOption = null;

    const applyFilter = () => {
      const query = input.value.trim().toLowerCase();
      let visibleCount = 0;
      options.forEach((option) => {
        const visible = !query || option.textContent.toLowerCase().includes(query);
        option.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      if (emptyState) emptyState.hidden = visibleCount > 0;
    };

    const openMenu = () => {
      closeAllDropdowns();
      closeAllSearchableMenus(root);
      root.classList.add('open');
      chevronBtn.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
      bar.classList.add('is-editing');
      input.value = '';
      applyFilter();
      input.focus();
    };

    const closeMenu = () => {
      root.classList.remove('open');
      chevronBtn.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
      bar.classList.remove('is-editing');
      input.value = '';
    };

    chevronBtn.addEventListener('click', () => {
      if (root.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    input.addEventListener('focus', () => {
      if (!root.classList.contains('open')) openMenu();
    });

    input.addEventListener('input', applyFilter);

    valueBox.addEventListener('click', openMenu);

    options.forEach((option) => {
      option.addEventListener('click', () => {
        options.forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        option.classList.add('selected');
        option.setAttribute('aria-selected', 'true');
        selectedOption = option;

        const nameEl = option.querySelector('.option-name');
        valueBox.textContent = nameEl ? nameEl.textContent.trim() : option.textContent.trim();
        bar.classList.add('has-value');

        closeMenu();
      });
    });

    return {
      root,
      close: closeMenu,
      getValue() {
        return selectedOption ? selectedOption.dataset.value : '';
      },
    };
  }

  const searchableSelectRoots = document.querySelectorAll(
    '[data-role="name-select"], [data-role="dni-select"], [data-role="email-select"]'
  );
  searchableSelects = Array.from(searchableSelectRoots, setupSearchableSelect);

  // ---------- Modal: Nuevo usuario ----------

  const overlay = document.getElementById('newUserOverlay');
  const openModalBtn = document.getElementById('openNewUserModalBtn');
  const cancelBtn = document.getElementById('cancelNewUserBtn');
  const createBtn = document.getElementById('createUserBtn');

  const textInputs = overlay.querySelectorAll('.modal-body input[type="text"], .modal-body input[type="email"]');
  const roleDropdown = overlay.querySelector('.dropdown');
  const roleLabel = roleDropdown.querySelector('.dropdown-label');
  const roleOptions = roleDropdown.querySelectorAll('.dropdown-option');

  const avatarInput = document.getElementById('avatarFileInput');
  const avatarPreview = document.getElementById('newUserAvatarPreview');
  const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');

  const generatePasswordBtn = document.getElementById('generatePasswordBtn');
  const passwordValueEl = document.getElementById('generatedPasswordValue');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const copyPasswordBtn = document.getElementById('copyPasswordBtn');

  let currentPassword = '';

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

    passwordValueEl.dataset.visible = 'false';
    currentPassword = generatePassword();
    renderPassword();
  }

  function openModal() {
    resetForm();
    overlay.classList.add('is-open');
  }

  function closeModal() {
    overlay.classList.remove('is-open');
    closeAllDropdowns();
  }

  openModalBtn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', () => {
    // Vista puramente visual: el alta real se conecta cuando exista la capa de servicios/IPC.
    closeModal();
  });

  roleOptions.forEach((option) => {
    option.addEventListener('click', () => {
      roleLabel.classList.remove('placeholder');
    });
  });

  uploadAvatarBtn.addEventListener('click', () => avatarInput.click());

  avatarInput.addEventListener('change', () => {
    const file = avatarInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      avatarPreview.style.backgroundImage = `url(${reader.result})`;
      avatarPreview.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  });

  generatePasswordBtn.addEventListener('click', () => {
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
