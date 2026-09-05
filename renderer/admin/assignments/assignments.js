// Vista Docencia del Administrador — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  sidebarToggle.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  });

  const dropdowns = document.querySelectorAll('.dropdown');

  document.querySelectorAll('.dropdown-label.placeholder').forEach((label) => {
    label.dataset.placeholder = label.textContent.trim();
  });

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
        label.textContent = option.dataset.label ?? option.textContent.trim();
        label.classList.remove('placeholder');
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

  // ---------- Modal: Nueva asignación ----------

  const assignmentOverlay = document.getElementById('newAssignmentOverlay');
  const openAssignmentModalBtn = document.getElementById('openNewAssignmentModalBtn');
  const cancelAssignmentBtn = document.getElementById('cancelNewAssignmentBtn');
  const createAssignmentBtn = document.getElementById('createAssignmentBtn');

  const assignmentYearBadge = document.getElementById('newAssignmentYearBadge');
  assignmentYearBadge.textContent = String(new Date().getFullYear());

  // Campo con búsqueda integrada: un único componente que combina un input de filtro
  // y una lista desplegable (usado por Profesor y Curso).
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

        valueBox.innerHTML = option.innerHTML;
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
        groupFilter = '';
        options.forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
          o.hidden = false;
        });
        if (emptyState) emptyState.hidden = true;
        bar.classList.remove('has-value');
        valueBox.innerHTML = '';
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
      },
      getValue() {
        return selectedOption ? selectedOption.dataset.value : '';
      },
    };
  }

  const teacherRoot = assignmentOverlay.querySelector('[data-role="teacher-select"]');
  const courseRoot = assignmentOverlay.querySelector('[data-role="course-select"]');
  const levelDropdown = assignmentOverlay.querySelector('[data-filter="new-assignment-level"]');
  const levelLabel = levelDropdown.querySelector('.dropdown-label');
  const levelOptions = levelDropdown.querySelectorAll('.dropdown-option');
  const subjectDropdown = assignmentOverlay.querySelector('[data-filter="new-assignment-subject"]');
  const subjectToggle = subjectDropdown.querySelector('.dropdown-toggle');
  const subjectLabel = subjectDropdown.querySelector('.dropdown-label');
  const subjectOptions = subjectDropdown.querySelectorAll('.dropdown-option:not(.disabled)');

  const COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';
  const SUBJECT_LOCKED_PLACEHOLDER = 'Selecciona primero un curso';
  const SUBJECT_UNLOCKED_PLACEHOLDER = 'Seleccionar materia';

  const teacherSelect = setupSearchableSelect(teacherRoot);
  const courseSelect = setupSearchableSelect(courseRoot);

  // ---------- Filtro: profesor (dropdown con búsqueda integrada) ----------

  const teacherFilterRoot = document.querySelector('[data-role="teacher-filter-select"]');
  const teacherFilterSelect = setupSearchableSelect(teacherFilterRoot);

  searchableSelects = [teacherSelect, courseSelect, teacherFilterSelect];

  function updateCreateButtonState() {
    const hasTeacher = Boolean(teacherSelect.getValue());
    const hasLevel = Boolean(levelDropdown.querySelector('.dropdown-option.selected'));
    const hasCourse = Boolean(courseSelect.getValue());
    const hasSubject = Boolean(subjectDropdown.querySelector('.dropdown-option.selected'));
    createAssignmentBtn.disabled = !(hasTeacher && hasLevel && hasCourse && hasSubject);
  }

  function lockSubject() {
    subjectDropdown.classList.add('is-locked');
    subjectToggle.disabled = true;
    subjectOptions.forEach((o) => {
      o.classList.remove('selected');
      o.setAttribute('aria-selected', 'false');
    });
    subjectLabel.textContent = SUBJECT_LOCKED_PLACEHOLDER;
    subjectLabel.classList.add('placeholder');
  }

  function unlockSubject() {
    subjectDropdown.classList.remove('is-locked');
    subjectToggle.disabled = false;
    subjectLabel.textContent = SUBJECT_UNLOCKED_PLACEHOLDER;
    subjectLabel.classList.add('placeholder');
  }

  teacherSelect.onSelect(updateCreateButtonState);

  courseSelect.onSelect(() => {
    unlockSubject();
    updateCreateButtonState();
  });

  courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);

  levelOptions.forEach((option) => {
    option.addEventListener('click', () => {
      courseSelect.reset();
      courseSelect.setGroupFilter(option.dataset.value);
      courseSelect.unlock(COURSE_UNLOCKED_PLACEHOLDER);
      lockSubject();
      updateCreateButtonState();
    });
  });

  subjectOptions.forEach((option) => {
    option.addEventListener('click', updateCreateButtonState);
  });

  function resetAssignmentForm() {
    teacherSelect.reset();

    levelOptions.forEach((o) => {
      o.classList.remove('selected');
      o.setAttribute('aria-selected', 'false');
    });
    levelLabel.textContent = levelLabel.dataset.placeholder;
    levelLabel.classList.add('placeholder');

    courseSelect.reset();
    courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);

    lockSubject();

    updateCreateButtonState();
  }

  function openAssignmentModal() {
    resetAssignmentForm();
    assignmentOverlay.classList.add('is-open');
  }

  function closeAssignmentModal() {
    assignmentOverlay.classList.remove('is-open');
    closeAllDropdowns();
    closeAllSearchableMenus();
  }

  openAssignmentModalBtn.addEventListener('click', openAssignmentModal);
  cancelAssignmentBtn.addEventListener('click', closeAssignmentModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createAssignmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el alta real se conecta cuando exista la capa de servicios/IPC.
    closeAssignmentModal();
  });
});
