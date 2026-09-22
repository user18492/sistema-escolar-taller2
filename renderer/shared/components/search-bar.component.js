// Componente reutilizable: buscador de los paneles de filtro de columna (lupa + input).
// Uso: <search-bar placeholder="Buscar por nombre"></search-bar> como primer hijo de un
// .column-filter-panel.column-filter-searchable, antes de su lista (que sigue escrita en la vista).
//   - "placeholder": placeholder y aria-label del input.
// column-filter.js toma el .searchable-input del panel para filtrar las opciones y darle el foco.
// A propósito no expone clear() ni hasSelection: column-filter.js trata como filtro con estado
// propio a todo hijo directo del panel que los tenga.
// Estilos en searchable-select.css.

(() => {
  class SearchBar extends HTMLElement {
    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      const placeholder = this.getAttribute('placeholder');
      this.innerHTML = `<div class="searchable-bar">
        <span class="searchable-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input type="text" class="searchable-input" placeholder="" aria-label="" autocomplete="off" />
      </div>`;
      const input = this.querySelector('.searchable-input');
      input.setAttribute('placeholder', placeholder);
      input.setAttribute('aria-label', placeholder);
    }
  }

  customElements.define('search-bar', SearchBar);
})();
