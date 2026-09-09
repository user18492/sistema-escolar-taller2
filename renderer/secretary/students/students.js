// Vista Alumnos del Secretario — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

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

  // ---------- Filtros: Nombre / Email / Teléfono / DNI ----------

  // Campo con búsqueda integrada: un único componente que combina un input de filtro
  // y una lista desplegable (mismo patrón usado en Usuarios y en Docencia).
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
    '[data-role="name-select"], [data-role="email-select"], [data-role="phone-select"], [data-role="dni-select"]'
  );
  searchableSelects = Array.from(searchableSelectRoots, setupSearchableSelect);
  // ---------- Modal: Nuevo alumno / Editar alumno ----------

  const overlay = document.getElementById('newStudentOverlay');
  const openModalBtn = document.getElementById('openNewStudentModalBtn');
  const cancelBtn = document.getElementById('cancelNewStudentBtn');
  const createBtn = document.getElementById('createStudentBtn');
  const modalTitle = document.getElementById('newStudentTitle');
  const modalDescription = overlay.querySelector('.modal-header p');

  const textInputs = overlay.querySelectorAll(
    '.modal-body input[type="text"], .modal-body input[type="email"], .modal-body input[type="tel"]'
  );
  const statusDropdown = overlay.querySelector('.dropdown');
  const statusLabel = statusDropdown.querySelector('.dropdown-label');
  const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');

  const firstNameInput = document.getElementById('newStudentFirstName');
  const lastNameInput = document.getElementById('newStudentLastName');
  const dniInput = document.getElementById('newStudentDni');
  const birthdateInput = document.getElementById('newStudentBirthdate');
  const emailInput = document.getElementById('newStudentEmail');
  const phoneInput = document.getElementById('newStudentPhone');
  const addressInput = document.getElementById('newStudentAddress');

  const dangerZone = document.getElementById('studentDangerZone');

  let modalTrigger = openModalBtn;

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

  function formatBirthdateInput() {
    const digits = birthdateInput.value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits.slice(0, 2);
    if (digits.length > 2) formatted += '/' + digits.slice(2, 4);
    if (digits.length > 4) formatted += '/' + digits.slice(4, 8);
    birthdateInput.value = formatted;
  }

  birthdateInput.addEventListener('input', formatBirthdateInput);

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => input.value.trim().length > 0);
    const hasStatus = Boolean(statusDropdown.querySelector('.dropdown-option.selected'));
    createBtn.disabled = !(hasAllTextInputs && hasStatus);
  }

  // Marca la opción de estado cuyo texto coincide, replicando lo que hace el
  // listener del dropdown al elegirla con el ratón.
  function selectStatus(optionLabel) {
    statusOptions.forEach((option) => {
      const selected = option.textContent.trim() === optionLabel;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) statusLabel.textContent = option.textContent.trim();
    });
    statusLabel.classList.remove('placeholder');
  }

  function resetForm() {
    textInputs.forEach((input) => (input.value = ''));
    statusOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    statusLabel.textContent = 'Seleccionar estado';
    statusLabel.classList.add('placeholder');
    updateCreateButtonState();
  }

  function openModal(row = null, trigger = openModalBtn) {
    const isEditing = Boolean(row);
    modalTrigger = trigger;
    resetForm();

    modalTitle.textContent = isEditing ? 'Editar alumno' : 'Nuevo alumno';
    modalDescription.textContent = isEditing
      ? 'Modifica los datos del alumno.'
      : 'Completa los datos para registrar un nuevo alumno.';
    createBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear alumno';
    dangerZone.hidden = !isEditing;

    if (row) {
      const [lastName, firstName] = row.querySelector('.student-name').textContent.trim().split(', ');
      firstNameInput.value = firstName;
      lastNameInput.value = lastName;
      emailInput.value = row.cells[1].textContent.trim();
      phoneInput.value = row.cells[2].textContent.trim();
      addressInput.value = row.cells[3].textContent.trim();
      dniInput.value = row.cells[4].textContent.trim();
      birthdateInput.value = row.cells[5].textContent.trim();
      selectStatus(row.cells[6].textContent.trim());
    }

    updateCreateButtonState();
    closeAllDropdowns();
    closeAllSearchableMenus();
    overlay.classList.add('is-open');
    overlay.querySelector('.modal').scrollTop = 0;
    firstNameInput.focus();
  }

  function closeModal() {
    overlay.classList.remove('is-open');
    modalTrigger.focus();
    closeAllDropdowns();
  }

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
  document.querySelectorAll('.data-table tbody .btn').forEach((button) => {
    button.addEventListener('click', () => openModal(button.closest('tr'), button));
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
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
});

