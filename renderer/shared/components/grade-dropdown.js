// Componente reutilizable: dropdown de filtro "Grado", compartido por las vistas Cursos y Docencia.
// Uso: <grade-dropdown></grade-dropdown> para el campo completo (botón + menú desplegable),
// o <grade-dropdown variant="panel"></grade-dropdown> para incrustar solo el menú en un
// contenedor que ya se encarga de desplegarlo (el filtro del encabezado de la tabla).
// Selección múltiple con checkboxes tri-estado (Todos / por nivel educativo / por grado individual).
// API para el contenedor: `hasSelection` indica si hay grados elegidos y `clear()` los restablece.
// Sin shadow DOM a propósito: así los estilos de grade-dropdown.css (selectores .dropdown-menu-grade, .grade-card, etc.) siguen aplicando tal cual,
// y el botón .dropdown-toggle sigue siendo detectado por la lógica genérica de apertura/cierre de dropdowns de cada vista.

(() => {
  const GRADE_LEVELS = [
    { key: 'PRIMARY', label: 'Primaria' },
    { key: 'SECONDARY', label: 'Secundaria' },
  ];

  const GRADE_VALUES = ['1', '2', '3', '4', '5', '6'];

  const CHECK_ICON =
    '<svg class="grade-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>';
  const DASH_ICON =
    '<svg class="grade-dash-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>';

  const renderLevelBlock = (level) => {
    const cardsHtml = GRADE_VALUES.map(
      (value) =>
        `<button type="button" class="grade-card" data-value="${value}" data-level="${level.key}" aria-pressed="false">${value}°</button>`
    ).join('');

    return `
      <div class="dropdown-divider" role="separator"></div>

      <div class="grade-level-block" data-level-block="${level.key}">
        <div class="grade-row grade-row-level" role="menuitemcheckbox" aria-checked="false" tabindex="0" data-level-header="${level.key}">
          <span class="grade-checkbox" aria-hidden="true">
            ${CHECK_ICON}
            ${DASH_ICON}
          </span>
          <span class="grade-row-label grade-level-label">${level.label}</span>
        </div>
        <div class="grade-grid" data-level-grid="${level.key}">
          ${cardsHtml}
        </div>
      </div>`;
  };

  const setCheckboxState = (row, state) => {
    row.classList.remove('is-checked', 'is-indeterminate');
    if (state === 'checked') {
      row.classList.add('is-checked');
      row.setAttribute('aria-checked', 'true');
    } else if (state === 'indeterminate') {
      row.classList.add('is-indeterminate');
      row.setAttribute('aria-checked', 'mixed');
    } else {
      row.setAttribute('aria-checked', 'false');
    }
  };

  const stateFromCards = (cards) => {
    const selectedCount = cards.filter((card) => card.classList.contains('selected')).length;
    if (selectedCount === 0) return 'empty';
    if (selectedCount === cards.length) return 'checked';
    return 'indeterminate';
  };

  class GradeDropdown extends HTMLElement {
    connectedCallback() {
      const levelBlocksHtml = GRADE_LEVELS.map(renderLevelBlock).join('');
      // La variante "panel" ya vive dentro de un contenedor desplegable (el filtro del
      // encabezado de la tabla): aporta solo el menú, siempre visible y sin su propio botón.
      const isPanel = this.getAttribute('variant') === 'panel';

      const menuHtml = `
          <div class="dropdown-menu dropdown-menu-grade" role="menu"${isPanel ? '' : ' hidden'}>
            <div class="grade-row grade-row-all" role="menuitemcheckbox" aria-checked="false" tabindex="0" data-grade-all>
              <span class="grade-checkbox" aria-hidden="true">
                ${CHECK_ICON}
                ${DASH_ICON}
              </span>
              <span class="grade-row-label">Todos</span>
            </div>
            ${levelBlocksHtml}
          </div>`;

      this.innerHTML = isPanel
        ? menuHtml
        : `
        <div class="field field-select dropdown" data-filter="grade">
          <button type="button" class="dropdown-toggle" aria-haspopup="true" aria-expanded="false">
            <span class="dropdown-label">Grado</span>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          ${menuHtml}
        </div>`;

      this.setupGradeDropdown();
    }

    // Grados seleccionados: lo consulta el contenedor para marcar el filtro como activo
    get hasSelection() {
      return this.querySelector('.grade-card.selected') !== null;
    }

    setupGradeDropdown() {
      const menu = this.querySelector('.dropdown-menu-grade');
      const allCards = Array.from(menu.querySelectorAll('.grade-card'));
      const levelBlocks = menu.querySelectorAll('.grade-level-block');
      const allRow = menu.querySelector('[data-grade-all]');

      const setCardSelected = (card, selected) => {
        card.classList.toggle('selected', selected);
        card.setAttribute('aria-pressed', String(selected));
      };

      const refreshStates = () => {
        levelBlocks.forEach((block) => {
          const header = block.querySelector('[data-level-header]');
          const blockCards = Array.from(block.querySelectorAll('.grade-card'));
          setCheckboxState(header, stateFromCards(blockCards));
        });
        if (allRow) {
          setCheckboxState(allRow, stateFromCards(allCards));
        }
      };

      allCards.forEach((card) => {
        card.addEventListener('click', () => {
          setCardSelected(card, !card.classList.contains('selected'));
          refreshStates();
        });
      });

      levelBlocks.forEach((block) => {
        const header = block.querySelector('[data-level-header]');
        const blockCards = Array.from(block.querySelectorAll('.grade-card'));
        const toggleBlock = () => {
          const selectAll = !header.classList.contains('is-checked');
          blockCards.forEach((card) => setCardSelected(card, selectAll));
          refreshStates();
        };
        header.addEventListener('click', toggleBlock);
        header.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleBlock();
          }
        });
      });

      // Restablece el filtro desde el contenedor (botón "Limpiar filtro" del encabezado)
      this.clear = () => {
        allCards.forEach((card) => setCardSelected(card, false));
        refreshStates();
      };

      if (allRow) {
        const toggleAll = () => {
          const selectAll = !allRow.classList.contains('is-checked');
          allCards.forEach((card) => setCardSelected(card, selectAll));
          refreshStates();
        };
        allRow.addEventListener('click', toggleAll);
        allRow.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleAll();
          }
        });
      }

      refreshStates();
    }
  }

  customElements.define('grade-dropdown', GradeDropdown);
})();
