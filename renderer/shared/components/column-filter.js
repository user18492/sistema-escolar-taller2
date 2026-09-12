// Componente global: filtros desplegables en los encabezados de las tablas.
// Uso: <th class="column-filter"> con un botón .column-filter-toggle (con popovertarget)
// y un panel .column-filter-panel[popover="auto"] que contiene el filtro; la vista no
// necesita registrar nada.
// El panel se promueve al top layer del navegador con la API de popover, así que la lista
// deja de estar recortada por el desplazamiento de la tabla; su posición y su alto máximo
// se calculan sobre el botón del encabezado, y se abre hacia arriba si abajo no cabe.
// Contenidos admitidos dentro del panel, todos opcionales:
//   - lista de .dropdown-option (selección única: elegir una cierra el panel)
//   - buscador .searchable-input, que oculta las opciones que no coinciden
//   - campo de texto .column-filter-input (Enter cierra el panel)
//   - componentes con estado propio (p. ej. <grade-dropdown variant="panel"> o <course-filter>)
// El embudo del encabezado se rellena (.has-selection) mientras el filtro tenga algo activo.

(() => {
  // Aire mínimo entre el panel y los bordes de la ventana, y separación respecto al encabezado
  const VIEWPORT_MARGIN = 12;
  const HEADER_GAP = 8;

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
    const options = Array.from(panel.querySelectorAll('.dropdown-option'));
    const emptyState = panel.querySelector('.dropdown-empty');
    const clearButton = panel.querySelector('.column-filter-clear');
    const components = Array.from(panel.children).filter(isFilterComponent);
    const filterLabel = toggle.getAttribute('aria-label');

    const selectedOption = () => options.find((option) => option.classList.contains('selected'));

    // "Todos" (valor vacío) equivale a no filtrar: el embudo sigue vacío
    const activeValue = () => {
      const option = selectedOption();
      if (option?.dataset.value) return (option.querySelector('.option-name') ?? option).textContent.trim();
      if (textInput?.value.trim()) return textInput.value.trim();
      return '';
    };

    const refreshState = () => {
      const value = activeValue();
      const hasSelection = Boolean(value) || components.some((component) => component.hasSelection);
      toggle.classList.toggle('has-selection', hasSelection);
      toggle.setAttribute('aria-label', value ? `${filterLabel}: ${value}` : filterLabel);
    };

    const filterOptions = () => {
      const query = search ? search.value.trim().toLocaleLowerCase('es') : '';
      options.forEach((option) => {
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

    const selectOption = (option) => {
      options.forEach((candidate) => {
        const selected = candidate === option;
        candidate.classList.toggle('selected', selected);
        candidate.setAttribute('aria-selected', String(selected));
      });
      refreshState();
      closePanel();
    };

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
      }
    });

    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) return;
      positionPanel();
      const focusTarget = search
        ?? textInput
        ?? selectedOption()
        ?? options[0]
        ?? panel.querySelector('button, [tabindex="0"]')
        ?? panel;
      focusTarget.focus({ preventScroll: true });
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

    if (search) search.addEventListener('input', filterOptions);

    if (textInput) {
      textInput.addEventListener('input', refreshState);
      textInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') closePanel();
      });
    }

    // Los componentes mantienen su propio estado al hacer clic o escribir; aquí solo se refresca el embudo
    if (components.length) {
      panel.addEventListener('click', refreshState);
      panel.addEventListener('input', refreshState);
    }

    clearButton?.addEventListener('click', clearFilter);

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
