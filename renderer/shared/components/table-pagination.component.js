// Componente reutilizable: pie de las tablas con el total de resultados y la paginación.
// Genera el .table-footer completo (estilos en pagination.css). Tiene dos modos:
// - Estático (maquetas): muestra lo que dicen sus atributos y los botones no hacen nada.
//   Uso: <table-pagination results="Mostrando 1-10 de 67" label="Paginación de usuarios" pages="1 2 3 … 7"></table-pagination>
//     - "results": texto de .results-count.
//     - "label": aria-label del <nav class="pagination">.
//     - "pages": páginas separadas por espacios; cada una es un .page-btn y "…" es un .page-ellipsis.
//     - "current" (opcional, por defecto "1"): página marcada como .active.
//   Con una sola página, Previo y Siguiente quedan deshabilitados.
// - Dinámico: empieza la primera vez que la vista llama a update(). Los atributos "results",
//   "pages" y "current" quedan como el estado mientras carga. API para la vista:
//     - "page-size" (atributo, por defecto 10) y pageSize: filas por página.
//     - page: página actual.
//     - update({ total, page = this.page }): acota la página a [1, páginas], actualiza el texto,
//       los números y los estados, y devuelve la página resultante.
//     - slice(items, { page } = {}): atajo para listas en memoria; llama a update() con
//       items.length y devuelve las filas de esa página.
//     - page-change (burbujea) con detail { page }: el usuario eligió otra página. El componente
//       ya la marcó; la vista solo vuelve a pedir o recortar las filas.
//   No recorta filas ni pide datos: una vista paginada en el backend llama a update() con el
//   total que devuelve el proceso principal.
// El script se carga sin defer en <head>, así el marcado existe al parsear la vista.

(() => {
  const ELLIPSIS = '…';
  const DEFAULT_PAGE_SIZE = 10;

  const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

  // Hasta 7 posiciones: la primera, la última y el tramo alrededor de la actual. Un hueco de una
  // sola página muestra ese número (ocupa lo mismo que "…"); uno más largo muestra "…".
  const pageItems = (page, totalPages) => {
    const start = Math.max(1, Math.min(page - 1, totalPages - 2));
    const end = Math.min(totalPages, Math.max(page + 1, 3));
    const shown = [...new Set([1, ...range(start, end), totalPages])];
    return shown.flatMap((number, index) => {
      const gap = number - (shown[index - 1] ?? 0) - 1;
      if (gap === 1) return [String(number - 1), String(number)];
      if (gap > 1) return [ELLIPSIS, String(number)];
      return [String(number)];
    });
  };

  class TablePagination extends HTMLElement {
    #nav;
    #previous;
    #next;
    #isDynamic = false;
    #page = 1;
    #total = 0;
    // Página y cantidad de páginas de los números en pantalla, para no regenerarlos sin cambios
    #renderedPages = null;

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
      this.#nav = this.querySelector('.pagination');
      [this.#previous, this.#next] = this.#nav.querySelectorAll('.page-nav');
      this.#page = Number(current) || 1;

      this.querySelector('.results-count').textContent = this.getAttribute('results');
      this.#nav.setAttribute('aria-label', this.getAttribute('label'));
      this.#renderPages(pages, current);

      if (pages.length === 1) {
        this.#previous.disabled = true;
        this.#next.disabled = true;
      }

      // Un solo listener para los números, Previo y Siguiente: cada botón lleva su destino en data-page
      this.#nav.addEventListener('click', (event) => this.#choosePage(event.target.closest('.page-btn[data-page]')));
    }

    get pageSize() {
      const size = Number(this.getAttribute('page-size'));
      return Number.isInteger(size) && size > 0 ? size : DEFAULT_PAGE_SIZE;
    }

    get page() {
      return this.#page;
    }

    update({ total, page = this.page }) {
      this.#isDynamic = true;
      const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
      this.#page = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
      this.#total = total;

      const first = (this.#page - 1) * this.pageSize + 1;
      const last = Math.min(total, this.#page * this.pageSize);
      this.querySelector('.results-count').textContent = total ? `Mostrando ${first}-${last} de ${total}` : 'Mostrando 0 de 0';

      const renderedPages = `${this.#page}/${totalPages}`;
      if (renderedPages !== this.#renderedPages) {
        this.#renderedPages = renderedPages;
        while (this.#previous.nextSibling !== this.#next) this.#previous.nextSibling.remove();
        this.#renderPages(pageItems(this.#page, totalPages), String(this.#page));
      }

      this.#previous.disabled = this.#page === 1;
      this.#next.disabled = this.#page === totalPages;
      this.#previous.dataset.page = String(this.#page - 1);
      this.#next.dataset.page = String(this.#page + 1);
      return this.#page;
    }

    slice(items, { page } = {}) {
      const current = this.update({ total: items.length, page });
      return items.slice((current - 1) * this.pageSize, current * this.pageSize);
    }

    // Cada página se inserta antes de Siguiente, separada por un salto como en el marcado original
    #renderPages(pages, current) {
      pages.forEach((page) => {
        const item = document.createElement(page === ELLIPSIS ? 'span' : 'button');
        if (page === ELLIPSIS) {
          item.className = 'page-ellipsis';
        } else {
          item.className = page === current ? 'page-btn active' : 'page-btn';
          item.type = 'button';
          item.dataset.page = page;
          if (page === current) item.setAttribute('aria-current', 'page');
        }
        item.textContent = page;
        this.#nav.insertBefore(item, this.#next);
        this.#nav.insertBefore(document.createTextNode('\n'), this.#next);
      });
    }

    // En modo estático los botones no hacen nada. La página activa y los botones deshabilitados tampoco.
    #choosePage(button) {
      if (!this.#isDynamic || !button || button.disabled) return;
      const page = Number(button.dataset.page);
      if (page === this.#page) return;
      this.update({ total: this.#total, page });
      // Los números se regeneran, y Previo o Siguiente pueden quedar deshabilitados: en esos casos
      // el foco pasa a la página activa para no perderse.
      if (!button.classList.contains('page-nav') || button.disabled) this.#nav.querySelector('.page-btn.active').focus();
      this.dispatchEvent(new CustomEvent('page-change', { bubbles: true, detail: { page: this.#page } }));
    }
  }

  customElements.define('table-pagination', TablePagination);
})();
