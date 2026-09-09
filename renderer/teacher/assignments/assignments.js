// Vista Asignaciones del Profesor — interacción puramente visual, sin lógica de negocio

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

  // ---------- Filtro: Curso ----------

  // Campo con búsqueda integrada: un único componente que combina un input de filtro
  // y una lista desplegable (mismo patrón usado en Inscripciones y en Docencia).
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

    let groupFilter = '';

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

        const nameEl = option.querySelector('.option-name');
        valueBox.textContent = nameEl ? nameEl.textContent.trim() : option.textContent.trim();
        bar.classList.add('has-value');

        closeMenu();
      });
    });

    return {
      root,
      close: closeMenu,
      reset() {
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
    };
  }

  const courseSelect = setupSearchableSelect(document.querySelector('[data-role="course-select"]'));
  searchableSelects = [courseSelect];

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
});
