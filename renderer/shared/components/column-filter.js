// Componente global: filtros desplegables en los encabezados de las tablas.
// Uso: <th class="column-filter"> con un botón .column-filter-toggle (con popovertarget)
// y un panel .column-filter-panel[popover="auto"] que contiene el filtro; la vista no
// necesita registrar nada.
// Las opciones se leen cada vez que se usan: la vista puede agregarlas o reemplazarlas después
// de cargar (p. ej. con los datos de la base) y funcionan igual que las escritas en el marcado.
// Después de cada cambio del usuario (elegir, marcar o desmarcar, "Limpiar filtro", escribir en
// el campo de texto o usar un componente interno), el <th class="column-filter"> emite el evento
// column-filter-change (burbujea) con detail { values, text }: los data-value no vacíos de las
// opciones marcadas y el valor que filtra el campo de texto ('' si no hay o si el año está
// incompleto). La vista lo escucha para filtrar sus filas; la inicialización no lo emite.
// Si la vista quita una opción marcada (p. ej., la de un registro que se eliminó), emite
// column-filter-refresh sobre el <th class="column-filter"> para que el embudo refleje las
// marcadas que quedan; no emite column-filter-change, así que la vista actualiza su propio filtro.
// El panel se promueve al top layer del navegador con la API de popover, así que la lista
// deja de estar recortada por el desplazamiento de la tabla; su posición y su alto máximo
// se calculan sobre el botón del encabezado, y se abre hacia arriba si abajo no cabe.
// Contenidos admitidos dentro del panel, todos opcionales:
//   - lista de .dropdown-option (selección única: elegir una cierra el panel)
//   - lista de selección múltiple (listbox con aria-multiselectable="true"): cada opción se
//     marca o desmarca sin cerrar el panel y el filtro abarca todas las marcadas; "Todos"
//     (valor vacío) desmarca las demás y cierra el panel, como en la selección única
//   - buscador .searchable-input, que oculta las opciones que no coinciden
//   - campo de texto .column-filter-input (Enter cierra el panel)
//   - campo de año .column-filter-input[data-format="year"]: solo admite hasta 4 dígitos y
//     filtra únicamente con el año completo (AAAA); vacío equivale a todos los años
//   - componentes con estado propio (p. ej. <grade-dropdown variant="panel"> o <course-filter>)
// El embudo del encabezado se rellena (.has-selection) mientras el filtro tenga algo activo.

(() => {
  // Aire mínimo entre el panel y los bordes de la ventana, y separación respecto al encabezado
  const VIEWPORT_MARGIN = 12;
  const HEADER_GAP = 8;

  const YEAR_LENGTH = 4;

  // Campo de año: se descartan los caracteres que no son dígitos (letras, espacios, signos,
  // separadores) y se rechaza la edición completa si dejaría más de 4 dígitos, en lugar de
  // recortarla y alterar el año ya escrito.
  const setupYearInput = (input) => {
    let previousValue = input.value;

    // También antes de cada edición, por si el valor cambió por código (p. ej. "Limpiar filtro")
    input.addEventListener('beforeinput', () => {
      previousValue = input.value;
    });

    input.addEventListener('input', () => {
      const { value, selectionStart } = input;
      const digits = value.replace(/\D/g, '');
      const accepted = digits.length <= YEAR_LENGTH;

      if (!accepted || digits !== value) {
        // El cursor queda junto al mismo dígito, o donde empezaba la edición rechazada
        const cursor = accepted
          ? value.slice(0, selectionStart).replace(/\D/g, '').length
          : Math.max(0, selectionStart - (value.length - previousValue.length));
        input.value = accepted ? digits : previousValue;
        input.setSelectionRange(cursor, cursor);
      }
      previousValue = input.value;
    });
  };

  // Un componente del panel gestiona su propio estado si expone la API hasSelection/clear
  const isFilterComponent = (element) => typeof element.clear === 'function';

  // Los desplegables clásicos de la vista (formularios, modales) no deben quedar abiertos detrás del panel
  const closeOpenDropdowns = () => {
    document.querySelectorAll('.dropdown.open').forEach((dropdown) => {
      dropdown.classList.remove('open');
      dropdown.querySelector('.dropdown-toggle')?.setAttribute('aria-expanded', 'false');
      const menu = dropdown.querySelector('.dropdown-menu');
      if (menu) menu.hidden = true;
    });
  };

  function setupColumnFilter(root) {
    const toggle = root.querySelector('.column-filter-toggle');
    const panel = root.querySelector('.column-filter-panel');
    if (!toggle || !panel) return;

    const search = panel.querySelector('.searchable-input');
    const textInput = panel.querySelector('.column-filter-input');
    const isYearInput = textInput?.dataset.format === 'year';
    const getOptions = () => Array.from(panel.querySelectorAll('.dropdown-option'));
    const isMultiple = panel.querySelector('[role="listbox"]')?.getAttribute('aria-multiselectable') === 'true';
    const emptyState = panel.querySelector('.dropdown-empty');
    const clearButton = panel.querySelector('.column-filter-clear');
    const components = Array.from(panel.children).filter(isFilterComponent);
    const filterLabel = toggle.getAttribute('aria-label');

    const selectedOptions = () => getOptions().filter((option) => option.classList.contains('selected'));
    const optionLabel = (option) => (option.querySelector('.option-name') ?? option).textContent.trim();

    // Un año incompleto (menos de 4 dígitos) todavía no filtra
    const textValue = () => {
      const value = textInput?.value.trim() ?? '';
      if (isYearInput && value.length < YEAR_LENGTH) return '';
      return value;
    };

    // "Todos" (valor vacío) equivale a no filtrar: el embudo sigue vacío
    const activeValue = () => {
      const labels = selectedOptions().filter((option) => option.dataset.value).map(optionLabel);
      if (labels.length) return labels.join(', ');
      return textValue();
    };

    const refreshState = () => {
      const value = activeValue();
      const hasSelection = Boolean(value) || components.some((component) => component.hasSelection);
      toggle.classList.toggle('has-selection', hasSelection);
      toggle.setAttribute('aria-label', value ? `${filterLabel}: ${value}` : filterLabel);
    };

    const notifyChange = () => {
      root.dispatchEvent(new CustomEvent('column-filter-change', {
        bubbles: true,
        detail: {
          values: selectedOptions().map((option) => option.dataset.value).filter(Boolean),
          text: textValue(),
        },
      }));
    };

    // Corre en cada apertura, así que también prepara las opciones agregadas después de cargar
    const filterOptions = () => {
      const query = search ? search.value.trim().toLocaleLowerCase('es') : '';
      const options = getOptions();
      options.forEach((option) => {
        option.tabIndex = 0;
        option.hidden = !option.textContent.toLocaleLowerCase('es').includes(query);
      });
      if (emptyState) emptyState.hidden = options.some((option) => !option.hidden);
    };

    const positionPanel = () => {
      const anchor = toggle.getBoundingClientRect();
      const availableBelow = window.innerHeight - anchor.bottom - HEADER_GAP - VIEWPORT_MARGIN;
      const availableAbove = anchor.top - HEADER_GAP - VIEWPORT_MARGIN;
      const openAbove = availableBelow < panel.scrollHeight && availableAbove > availableBelow;
      panel.style.maxHeight = `${Math.max(0, openAbove ? availableAbove : availableBelow)}px`;
      panel.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - VIEWPORT_MARGIN))}px`;
      panel.style.top = `${openAbove ? anchor.top - panel.offsetHeight - HEADER_GAP : anchor.bottom + HEADER_GAP}px`;
    };

    const closePanel = () => {
      panel.hidePopover();
      toggle.focus({ preventScroll: true });
    };

    const setSelected = (option, selected) => {
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
    };

    const selectOption = (option) => {
      getOptions().forEach((candidate) => setSelected(candidate, candidate === option));
      refreshState();
      closePanel();
      notifyChange();
    };

    // Selección múltiple: el panel sigue abierto para marcar más opciones, y "Todos" deja de
    // estar marcado en cuanto se elige una opción concreta
    const toggleOption = (option) => {
      if (!option.dataset.value) {
        selectOption(option);
        return;
      }
      setSelected(option, !option.classList.contains('selected'));
      getOptions().filter((candidate) => !candidate.dataset.value).forEach((candidate) => setSelected(candidate, false));
      refreshState();
      notifyChange();
    };

    const chooseOption = isMultiple ? toggleOption : selectOption;

    const clearFilter = () => {
      if (textInput) textInput.value = '';
      components.forEach((component) => component.clear());
      selectOption(null);
    };

    panel.addEventListener('beforetoggle', (event) => {
      const isOpen = event.newState === 'open';
      toggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        closeOpenDropdowns();
        if (search) search.value = '';
        filterOptions();
      } else if (isYearInput && !textValue()) {
        // Al cerrar, un año incompleto se descarta: el campo vuelve a representar todos los años
        textInput.value = '';
      }
    });

    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) return;
      positionPanel();
      const focusTarget = search
        ?? textInput
        ?? selectedOptions()[0]
        ?? getOptions()[0]
        ?? panel.querySelector('button, [tabindex="0"]')
        ?? panel;
      focusTarget.focus({ preventScroll: true });
    });

    // Por delegación, para alcanzar también a las opciones agregadas después de cargar
    const optionOf = (event) => {
      const option = event.target.closest?.('.dropdown-option');
      return option && panel.contains(option) ? option : null;
    };

    panel.addEventListener('click', (event) => {
      const option = optionOf(event);
      if (option) chooseOption(option);
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        const option = optionOf(event);
        if (!option) return;
        event.preventDefault();
        chooseOption(option);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const visibleOptions = getOptions().filter((option) => !option.hidden);
      if (!visibleOptions.length) return;
      const current = visibleOptions.indexOf(document.activeElement);
      const next = current < 0
        ? (event.key === 'ArrowDown' ? 0 : visibleOptions.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + visibleOptions.length) % visibleOptions.length;
      visibleOptions[next].focus();
    });

    if (search) search.addEventListener('input', filterOptions);

    if (textInput) {
      // Antes que refreshState, para que el embudo evalúe el valor ya depurado
      if (isYearInput) setupYearInput(textInput);
      textInput.addEventListener('input', () => {
        refreshState();
        notifyChange();
      });
      textInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') closePanel();
      });
    }

    // Los componentes mantienen su propio estado al hacer clic o escribir; aquí solo se refresca
    // el embudo y se avisa a la vista si el cambio ocurrió dentro de uno de ellos
    if (components.length) {
      const handleComponentChange = (event) => {
        refreshState();
        if (components.some((component) => component.contains(event.target))) notifyChange();
      };
      panel.addEventListener('click', handleComponentChange);
      panel.addEventListener('input', handleComponentChange);
    }

    clearButton?.addEventListener('click', clearFilter);

    root.addEventListener('column-filter-refresh', refreshState);

    window.addEventListener('resize', () => {
      if (panel.matches(':popover-open')) positionPanel();
    });

    document.addEventListener('scroll', (event) => {
      if (panel.matches(':popover-open') && !panel.contains(event.target)) panel.hidePopover();
    }, true);

    refreshState();
  }

  const setupAll = () => document.querySelectorAll('.column-filter').forEach(setupColumnFilter);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupAll);
  else setupAll();
})();
