// Componente global: campo con búsqueda integrada (.dropdown-searchable), un único control que
// combina un input de filtro (.searchable-bar) y una lista desplegable de .dropdown-option.
// Uso: const select = setupSearchableSelect(root, opciones) por cada campo. Todos los campos
// quedan registrados: la vista los cierra con closeAllSearchableMenus() y le pasa
// closeAllSearchableMenus y dismissSearchableMenus a setupDropdowns() como onToggle y onDismiss,
// para que abrir un dropdown, hacer clic fuera de los buscadores o pulsar Escape los cierre.
// Escape cierra la lista abierta antes que el modal (dropdown.component.js consume esa pulsación)
// y deja el foco en el chevron: el input se oculta si el campo tiene valor, y enfocarlo
// reabriría la lista.
// Opciones (cada vista declara las tres últimas de forma explícita):
//   - onOpen(): se llama al abrir la lista, antes de cerrar los demás buscadores (la vista
//     cierra ahí sus dropdowns).
//   - valueContent: 'markup' copia en el valor el marcado completo de la opción elegida (avatar,
//     nombre y email); 'name' muestra solo el texto de su .option-name, o el de la opción.
//   - resetClearsGroupFilter: reset() también quita el filtro por nivel y vuelve a mostrar
//     todas las opciones.
//   - filterOnGroupChange: setGroupFilter() vuelve a filtrar la lista en el momento.
// API de cada campo: `root`, `close()`, `onSelect(callback)`, `reset()`, `getValue()`;
// `setGroupFilter(nivel)` restringe las opciones visibles a un nivel educativo (data-level) y
// `lock(placeholder)`/`unlock(placeholder)` deshabilitan el campo mientras ese nivel no esté elegido.

(() => {
  const searchableSelects = [];

  const closeAllSearchableMenus = (except) => {
    searchableSelects.forEach((select) => {
      if (select.root !== except) select.close();
    });
  };

  // Un clic dentro de un buscador no los cierra; uno fuera de ellos o Escape, sí. Devuelve si
  // había uno abierto, para que setupDropdowns consuma esa pulsación de Escape.
  const dismissSearchableMenus = (event) => {
    if (event.type === 'click' && event.target.closest('.dropdown-searchable')) return false;
    const openSelect = searchableSelects.find((select) => select.root.classList.contains('open'));
    closeAllSearchableMenus();
    if (openSelect && event.key === 'Escape') openSelect.root.querySelector('.searchable-chevron').focus();
    return Boolean(openSelect);
  };

  function setupSearchableSelect(
    root,
    { onOpen, valueContent = 'name', resetClearsGroupFilter = false, filterOnGroupChange = false } = {}
  ) {
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

    const showValue = (option) => {
      if (valueContent === 'markup') {
        valueBox.innerHTML = option.innerHTML;
        return;
      }
      const nameEl = option.querySelector('.option-name');
      valueBox.textContent = nameEl ? nameEl.textContent.trim() : option.textContent.trim();
    };

    const openMenu = () => {
      if (root.classList.contains('is-locked')) return;
      onOpen?.();
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

        showValue(option);
        bar.classList.add('has-value');

        closeMenu();
        if (typeof onSelectCallback === 'function') onSelectCallback(option);
      });
    });

    const select = {
      root,
      close: closeMenu,
      onSelect(callback) {
        onSelectCallback = callback;
      },
      reset() {
        selectedOption = null;
        if (resetClearsGroupFilter) groupFilter = '';
        options.forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
          if (resetClearsGroupFilter) o.hidden = false;
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
        if (filterOnGroupChange) applyFilter();
      },
      getValue() {
        return selectedOption ? selectedOption.dataset.value : '';
      },
    };

    searchableSelects.push(select);
    return select;
  }

  window.setupSearchableSelect = setupSearchableSelect;
  window.closeAllSearchableMenus = closeAllSearchableMenus;
  window.dismissSearchableMenus = dismissSearchableMenus;
})();
