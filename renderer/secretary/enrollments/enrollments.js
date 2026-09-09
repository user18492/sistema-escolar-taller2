// Vista Inscripciones del Secretario — interacción puramente visual, sin lógica de negocio

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

  // ---------- Filtros: Número de inscripción / Alumno / Curso ----------

  // Campo con búsqueda integrada: un único componente que combina un input de filtro
  // y una lista desplegable (mismo patrón usado en Alumnos y en Docencia).
  // `setGroupFilter` restringe las opciones visibles a un nivel educativo y
  // `lock`/`unlock` deshabilitan el campo mientras ese nivel no esté elegido.
  function setupSearchableSelect(root) {
    const bar = root.querySelector('.searchable-bar');
    const input = bar.querySelector('.searchable-input');
    const valueBox = bar.querySelector('.searchable-value');
    const chevronBtn = bar.querySelector('.searchable-chevron');
    const menu = root.querySelector('.dropdown-menu');
    const options = Array.from(menu.querySelectorAll('.dropdown-option'));
    const emptyState = menu.querySelector('.dropdown-empty');
    const defaultPlaceholder = input.placeholder;

    let selectedOption = null;
    let groupFilter = '';
    let onSelectCallback = null;

    const applyFilter = () => {
      const query = input.value.trim().toLowerCase();
      let visibleCount = 0;
      options.forEach((option) => {
        const matchesGroup = !groupFilter || option.dataset.level === groupFilter;
        const matchesQuery = !query || option.textContent.toLowerCase().includes(query);
        const visible = matchesGroup && matchesQuery;
        option.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      if (emptyState) emptyState.hidden = visibleCount > 0;
    };

    const openMenu = () => {
      if (root.classList.contains('is-locked')) return;
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
        if (typeof onSelectCallback === 'function') onSelectCallback(option);
      });
    });

    return {
      root,
      close: closeMenu,
      onSelect(callback) {
        onSelectCallback = callback;
      },
      reset() {
        selectedOption = null;
        options.forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        if (emptyState) emptyState.hidden = true;
        bar.classList.remove('has-value');
        valueBox.textContent = '';
        closeMenu();
      },
      lock(placeholder) {
        root.classList.add('is-locked');
        input.disabled = true;
        chevronBtn.disabled = true;
        input.placeholder = placeholder ?? defaultPlaceholder;
      },
      unlock(placeholder) {
        root.classList.remove('is-locked');
        input.disabled = false;
        chevronBtn.disabled = false;
        input.placeholder = placeholder ?? defaultPlaceholder;
      },
      setGroupFilter(value) {
        groupFilter = value ?? '';
        applyFilter();
      },
      getValue() {
        return selectedOption ? selectedOption.dataset.value : '';
      },
    };
  }

  const numberSelect = setupSearchableSelect(document.querySelector('[data-role="number-select"]'));
  const studentSelect = setupSearchableSelect(document.querySelector('[data-role="student-select"]'));
  const courseSelect = setupSearchableSelect(document.querySelector('[data-role="course-select"]'));
  searchableSelects = [numberSelect, studentSelect, courseSelect];

  // ---------- Filtro Curso dependiente del Nivel educativo ----------

  const COURSE_LOCKED_PLACEHOLDER = 'Selecciona un nivel';
  const COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';

  courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);

  const levelDropdown = document.querySelector('[data-filter="level"]');
  levelDropdown.querySelectorAll('.dropdown-option').forEach((option) => {
    option.addEventListener('click', () => {
      const level = option.dataset.value;
      courseSelect.reset();
      courseSelect.setGroupFilter(level);
      // "Todos" no acota ningún nivel: el curso vuelve a quedar bloqueado.
      if (level) {
        courseSelect.unlock(COURSE_UNLOCKED_PLACEHOLDER);
      } else {
        courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);
      }
    });
  });

  // ---------- Modal: Nueva inscripción ----------

  const enrollmentOverlay = document.getElementById('newEnrollmentOverlay');
  const openEnrollmentModalBtn = document.getElementById('openNewEnrollmentModalBtn');
  const cancelEnrollmentBtn = document.getElementById('cancelNewEnrollmentBtn');
  const createEnrollmentBtn = document.getElementById('createEnrollmentBtn');

  const MODAL_LEVEL_PLACEHOLDER = 'Seleccionar nivel educativo';
  const MODAL_COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';

  const modalStudentSelect = setupSearchableSelect(
    enrollmentOverlay.querySelector('[data-role="new-enrollment-student-select"]')
  );
  const modalCourseSelect = setupSearchableSelect(
    enrollmentOverlay.querySelector('[data-role="new-enrollment-course-select"]')
  );
  searchableSelects.push(modalStudentSelect, modalCourseSelect);

  const modalLevelDropdown = enrollmentOverlay.querySelector('[data-filter="new-enrollment-level"]');
  const modalLevelLabel = modalLevelDropdown.querySelector('.dropdown-label');
  const modalLevelOptions = modalLevelDropdown.querySelectorAll('.dropdown-option');

  function updateCreateButtonState() {
    const hasStudent = Boolean(modalStudentSelect.getValue());
    const hasLevel = Boolean(modalLevelDropdown.querySelector('.dropdown-option.selected'));
    const hasCourse = Boolean(modalCourseSelect.getValue());
    createEnrollmentBtn.disabled = !(hasStudent && hasLevel && hasCourse);
  }

  modalStudentSelect.onSelect(updateCreateButtonState);
  modalCourseSelect.onSelect(updateCreateButtonState);

  modalCourseSelect.lock(MODAL_COURSE_LOCKED_PLACEHOLDER);

  // Curso depende del nivel: cambiar de nivel descarta el curso ya elegido.
  modalLevelOptions.forEach((option) => {
    option.addEventListener('click', () => {
      modalLevelLabel.classList.remove('placeholder');
      modalCourseSelect.reset();
      modalCourseSelect.setGroupFilter(option.dataset.value);
      modalCourseSelect.unlock(COURSE_UNLOCKED_PLACEHOLDER);
      updateCreateButtonState();
    });
  });

  function resetEnrollmentForm() {
    modalStudentSelect.reset();

    modalLevelOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    modalLevelLabel.textContent = MODAL_LEVEL_PLACEHOLDER;
    modalLevelLabel.classList.add('placeholder');

    modalCourseSelect.reset();
    modalCourseSelect.setGroupFilter('');
    modalCourseSelect.lock(MODAL_COURSE_LOCKED_PLACEHOLDER);

    updateCreateButtonState();
  }

  function openEnrollmentModal() {
    resetEnrollmentForm();
    closeAllDropdowns();
    closeAllSearchableMenus();
    enrollmentOverlay.classList.add('is-open');
    enrollmentOverlay.querySelector('.modal').scrollTop = 0;
    modalStudentSelect.root.querySelector('.searchable-chevron').focus();
  }

  function closeEnrollmentModal() {
    enrollmentOverlay.classList.remove('is-open');
    closeAllDropdowns();
    closeAllSearchableMenus();
    openEnrollmentModalBtn.focus();
  }

  openEnrollmentModalBtn.addEventListener('click', openEnrollmentModal);
  cancelEnrollmentBtn.addEventListener('click', closeEnrollmentModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  enrollmentOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEnrollmentModal();
    if (event.key !== 'Tab') return;
    const controls = Array.from(enrollmentOverlay.querySelectorAll('button:not(:disabled), input:not(:disabled)'))
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

  createEnrollmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeEnrollmentModal();
  });

  // ---------- Modal: Editar inscripción ----------

  const editOverlay = document.getElementById('editEnrollmentOverlay');
  const cancelEditEnrollmentBtn = document.getElementById('cancelEditEnrollmentBtn');
  const saveEnrollmentBtn = document.getElementById('saveEnrollmentBtn');
  const deleteEnrollmentBtn = document.getElementById('deleteEnrollmentBtn');

  const statusDropdown = editOverlay.querySelector('[data-filter="edit-enrollment-status"]');
  const statusLabel = statusDropdown.querySelector('.dropdown-label');
  const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');

  // Botón "Editar" que abrió el modal: recupera el foco al cerrarlo.
  let editTrigger = null;

  // Marca la opción de estado cuyo texto coincide con el de la fila, replicando lo
  // que hace el listener del dropdown al elegirla con el ratón.
  function selectStatus(optionLabel) {
    statusOptions.forEach((option) => {
      const selected = option.textContent.trim() === optionLabel;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) statusLabel.textContent = option.textContent.trim();
    });
    statusLabel.classList.remove('placeholder');
  }

  statusOptions.forEach((option) => {
    option.addEventListener('click', () => {
      statusLabel.classList.remove('placeholder');
    });
  });

  function openEditModal(row, trigger) {
    editTrigger = trigger;
    selectStatus(row.cells[5].textContent.trim());

    closeAllDropdowns();
    closeAllSearchableMenus();
    editOverlay.classList.add('is-open');
    editOverlay.querySelector('.modal').scrollTop = 0;
    statusDropdown.querySelector('.dropdown-toggle').focus();
  }

  function closeEditModal() {
    editOverlay.classList.remove('is-open');
    closeAllDropdowns();
    editTrigger.focus();
  }

  document.querySelectorAll('.data-table tbody .btn').forEach((button) => {
    button.addEventListener('click', () => openEditModal(button.closest('tr'), button));
  });

  cancelEditEnrollmentBtn.addEventListener('click', closeEditModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  editOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEditModal();
    if (event.key !== 'Tab') return;
    const controls = Array.from(editOverlay.querySelectorAll('button:not(:disabled), input:not(:disabled)'))
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

  saveEnrollmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeEditModal();
  });

  deleteEnrollmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el borrado real se conecta cuando exista la capa de servicios/IPC.
    closeEditModal();
  });
});
