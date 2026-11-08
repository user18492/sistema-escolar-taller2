// Componente global: filtros desplegables en los encabezados de las tablas.
// Uso: <th class="column-filter"> con un botón .column-filter-toggle (con popovertarget)
// y un panel .column-filter-panel[popover="auto"] que contiene el filtro; la vista no
// necesita registrar nada.
// Las opciones se leen cada vez que se usan: la vista puede agregarlas o reemplazarlas después
// de cargar (p. ej. con los datos de la base) y funcionan igual que las escritas en el marcado.
// Después de cada cambio del usuario (elegir, marcar o desmarcar, "Limpiar filtro", escribir en
// el campo de texto o usar un componente interno), el <th class="column-filter"> emite el evento
// column-filter-change (burbujea) con detail { values, text, texts }: los data-value no vacíos de
// las opciones marcadas, el valor que filtra el (primer) campo de texto ('' si no hay o si el valor
// está incompleto) y, por su atributo name, el que filtra cada campo de texto con nombre (en un panel
// con varios). La vista lo escucha para filtrar sus filas; la inicialización no lo emite.
// Si la vista quita una opción marcada (p. ej., la de un registro que se eliminó), emite
// column-filter-refresh sobre el <th class="column-filter"> para que el embudo refleje las
// marcadas que quedan; no emite column-filter-change, así que la vista actualiza su propio filtro.
// Para dejar el filtro sin nada elegido (p. ej., al cambiar de pestaña), la vista emite
// column-filter-reset sobre el <th class="column-filter">: hace lo mismo que "Limpiar filtro", pero
// sin cerrar el panel ni emitir column-filter-change.
// Para reemplazar todas las opciones de una lista que sale de los registros cargados (p. ej., al
// cambiar el ciclo lectivo que muestra la tabla, school-year.js), la vista usa
// replaceColumnFilterOptions(root, options, selectedValues): `root` es el <th class="column-filter">,
// `options` las nuevas .dropdown-option (con data-value) y `selectedValues`, los data-value que la
// vista tenía elegidos. Quedan marcadas las que siguen entre las nuevas; las demás dejan de filtrar.
// La opción "Todos" (data-value vacío) y .dropdown-empty se conservan en su lugar, y el embudo se
// actualiza. Devuelve los data-value que siguen marcados, para que la vista actualice su filtro; no
// emite column-filter-change.
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
//   - campos numéricos .column-filter-input[data-format]: "year" (AAAA), "month" (MM, 01 a 12) o
//     "day" (DD, 01 a 31). Solo admiten dígitos, hasta su largo, y rechazan lo que no puede llegar
//     a un valor del rango; filtran únicamente completos y, al cerrar el panel, uno incompleto se
//     descarta. Vacío no filtra.
//   - varios campos de texto con name (p. ej. día, mes y año de una fecha, cada uno opcional): el
//     embudo los resume con su data-label ("Día 15, Año 2025")
//   - componentes con estado propio (p. ej. <grade-dropdown variant="panel"> o <course-filter>)
// El embudo del encabezado se rellena (.has-selection) mientras el filtro tenga algo activo.

(() => {
  // Aire mínimo entre el panel y los bordes de la ventana, y separación respecto al encabezado
  const VIEWPORT_MARGIN = 12;
  const HEADER_GAP = 8;

  // Largo y rango de cada campo numérico (data-format); sin rango, cualquier valor completo vale
  const NUMERIC_FORMATS = {
    year: { length: 4 },
    month: { length: 2, min: 1, max: 12 },
    day: { length: 2, min: 1, max: 31 },
  };

  // Si los dígitos todavía pueden llegar a un valor del rango: completos, que estén en él;
  // incompletos, que completarlos con ceros no lo supere (en el día, un 4 inicial ya no puede).
  const isAcceptedDigits = (digits, { length, min = 0, max = Infinity }) => {
    if (digits.length > length) return false;
    if (digits.length === length) return Number(digits) >= min && Number(digits) <= max;
    return Number(digits.padEnd(length, '0')) <= max;
  };

  // Campo numérico: se descartan los caracteres que no son dígitos (letras, espacios, signos,
  // separadores) y se rechaza la edición completa si dejaría más dígitos que su largo o un valor
  // fuera de su rango, en lugar de recortarla y alterar lo ya escrito.
  const setupNumericInput = (input, format) => {
    let previousValue = input.value;

    // También antes de cada edición, por si el valor cambió por código (p. ej. "Limpiar filtro")
    input.addEventListener('beforeinput', () => {
      previousValue = input.value;
    });

    input.addEventListener('input', () => {
      const { value, selectionStart } = input;
      const digits = value.replace(/\D/g, '');
      const accepted = isAcceptedDigits(digits, format);

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
    const textInputs = Array.from(panel.querySelectorAll('.column-filter-input'));
    const formatOf = (input) => NUMERIC_FORMATS[input.dataset.format];
    const getOptions = () => Array.from(panel.querySelectorAll('.dropdown-option'));
    const isMultiple = panel.querySelector('[role="listbox"]')?.getAttribute('aria-multiselectable') === 'true';
    const emptyState = panel.querySelector('.dropdown-empty');
    const clearButton = panel.querySelector('.column-filter-clear');
    const components = Array.from(panel.children).filter(isFilterComponent);
    const filterLabel = toggle.getAttribute('aria-label');

    const selectedOptions = () => getOptions().filter((option) => option.classList.contains('selected'));
    const optionLabel = (option) => (option.querySelector('.option-name') ?? option).textContent.trim();

    // Un campo numérico incompleto (p. ej. un año de menos de 4 dígitos) todavía no filtra
    const inputValue = (input) => {
      const value = input.value.trim();
      const format = formatOf(input);
      if (format && value.length < format.length) return '';
      return value;
    };
    const textValue = () => (textInputs[0] ? inputValue(textInputs[0]) : '');

    // "Todos" (valor vacío) equivale a no filtrar: el embudo sigue vacío. Con varios campos, cada
    // uno que filtra va con su etiqueta.
    const activeValue = () => {
      const labels = selectedOptions().filter((option) => option.dataset.value).map(optionLabel);
      if (labels.length) return labels.join(', ');
      if (textInputs.length > 1) {
        return textInputs
          .filter((input) => inputValue(input))
          .map((input) => `${input.dataset.label ?? input.name} ${inputValue(input)}`)
          .join(', ');
      }
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
          texts: Object.fromEntries(textInputs.filter((input) => input.name).map((input) => [input.name, inputValue(input)])),
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

    const resetFilter = () => {
      textInputs.forEach((input) => {
        input.value = '';
      });
      components.forEach((component) => component.clear());
      getOptions().forEach((option) => setSelected(option, false));
      refreshState();
    };

    const clearFilter = () => {
      resetFilter();
      closePanel();
      notifyChange();
    };

    panel.addEventListener('beforetoggle', (event) => {
      const isOpen = event.newState === 'open';
      toggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        closeOpenDropdowns();
        if (search) search.value = '';
        filterOptions();
      } else {
        // Al cerrar, un campo numérico incompleto se descarta: vuelve a no filtrar
        textInputs.filter((input) => formatOf(input) && !inputValue(input)).forEach((input) => {
          input.value = '';
        });
      }
    });

    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) return;
      positionPanel();
      const focusTarget = search
        ?? textInputs[0]
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

    textInputs.forEach((input) => {
      // Antes que refreshState, para que el embudo evalúe el valor ya depurado
      const format = formatOf(input);
      if (format) setupNumericInput(input, format);
      input.addEventListener('input', () => {
        refreshState();
        notifyChange();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') closePanel();
      });
    });

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
    root.addEventListener('column-filter-reset', resetFilter);

    window.addEventListener('resize', () => {
      if (panel.matches(':popover-open')) positionPanel();
    });

    document.addEventListener('scroll', (event) => {
      if (panel.matches(':popover-open') && !panel.contains(event.target)) panel.hidePopover();
    }, true);

    refreshState();
  }

  window.replaceColumnFilterOptions = (root, options, selectedValues) => {
    const list = root.querySelector('[role="listbox"]');
    const allOption = list.querySelector('.dropdown-option[data-value=""]');
    const emptyState = list.querySelector('.dropdown-empty');
    list.replaceChildren(...[allOption, ...options, emptyState].filter(Boolean));
    const kept = options.map((option) => option.dataset.value).filter((value) => selectedValues.includes(value));
    options.forEach((option) => {
      const isSelected = kept.includes(option.dataset.value);
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
    root.dispatchEvent(new Event('column-filter-refresh'));
    return kept;
  };

  const setupAll = () => document.querySelectorAll('.column-filter').forEach(setupColumnFilter);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupAll);
  else setupAll();
})();
