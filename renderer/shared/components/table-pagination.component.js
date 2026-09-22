// Componente reutilizable: pie de las tablas con el total de resultados y la paginación.
// Uso: <table-pagination results="Mostrando 1-10 de 67" label="Paginación de usuarios" pages="1 2 3 … 7"></table-pagination>
// Genera el .table-footer completo (estilos en pagination.css):
//   - "results": texto de .results-count.
//   - "label": aria-label del <nav class="pagination">.
//   - "pages": páginas separadas por espacios; cada una es un .page-btn y "…" es un .page-ellipsis.
//   - "current" (opcional, por defecto "1"): página marcada como .active.
// Con una sola página, Previo y Siguiente quedan deshabilitados.
// El script se carga sin defer en <head>, así el marcado existe al parsear la vista.

(() => {
  const ELLIPSIS = '…';

  class TablePagination extends HTMLElement {
    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      this.innerHTML = `<div class="table-footer">
        <span class="results-count"></span>
        <nav class="pagination" aria-label="">
          <button class="page-btn page-nav" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Previo
          </button>
          <button class="page-btn page-nav" type="button">
            Siguiente
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </nav>
      </div>`;

      const pages = (this.getAttribute('pages') ?? '').split(/\s+/).filter(Boolean);
      const current = this.getAttribute('current') ?? '1';
      const nav = this.querySelector('.pagination');
      const [previous, next] = nav.querySelectorAll('.page-nav');

      this.querySelector('.results-count').textContent = this.getAttribute('results');
      nav.setAttribute('aria-label', this.getAttribute('label'));

      // Cada página se inserta antes de Siguiente, separada por un salto como en el marcado original
      pages.forEach((page) => {
        const item = document.createElement(page === ELLIPSIS ? 'span' : 'button');
        if (page === ELLIPSIS) {
          item.className = 'page-ellipsis';
        } else {
          item.className = page === current ? 'page-btn active' : 'page-btn';
          item.type = 'button';
        }
        item.textContent = page;
        nav.insertBefore(item, next);
        nav.insertBefore(document.createTextNode('\n'), next);
      });

      if (pages.length === 1) {
        previous.disabled = true;
        next.disabled = true;
      }
    }
  }

  customElements.define('table-pagination', TablePagination);
})();
