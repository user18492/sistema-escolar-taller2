// Componente reutilizable: acción de texto "Gestionar" + chevron de las filas de tabla, que abre
// la vista que continúa desde la fila.
// Uso: <manage-link href="../assignment-management/index.html"></manage-link>
// Genera el <a class="manage-link"> con el href relativo tal cual: cada vista lo lee con
// getAttribute('href') para agregarle los datos de la fila. También lo usa <row-actions>.
// Estilos en base.css.

(() => {
  class ManageLink extends HTMLElement {
    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      // resources/ChevronRight.svg
      this.innerHTML = `<a class="manage-link" href="">
        Gestionar
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </a>`;
      this.querySelector('.manage-link').setAttribute('href', this.getAttribute('href'));
    }
  }

  customElements.define('manage-link', ManageLink);
})();
