// Componente reutilizable: estado del guardado automático, al estilo de Google Docs, para las
// vistas que guardan cada cambio sin un botón Guardar.
// Uso: <save-status></save-status>, a la derecha del .page-header. Sin guardados no muestra nada.
//   - start(): empezó un guardado. Muestra "Guardando…".
//   - finish(saved): terminó uno de los guardados que empezaron con start(), con true si se
//     guardó. Cuando terminan todos los que estaban en curso, muestra "Guardado" o, si alguno de
//     ellos falló, "No se pudo guardar" (el detalle lo da la vista, con un toast). El estado queda
//     a la vista hasta el próximo guardado.
// Puede haber varios guardados en curso a la vez (uno por campo). "Guardando…" se ve al menos
// MIN_SAVING_MS, así no parpadea cuando la respuesta llega enseguida; el error se muestra apenas
// llega. Los lectores de pantalla anuncian cada estado (role="status").
// Estilos en save-status.css.

(() => {
  const MIN_SAVING_MS = 500;

  const STATES = {
    saving: { label: 'Guardando…' },
    // resources/CheckCircle.svg
    saved: { label: 'Guardado', icon: '<path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />' },
    // resources/XCircle.svg
    error: {
      label: 'No se pudo guardar',
      icon: '<path d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
    },
  };

  class SaveStatus extends HTMLElement {
    // Guardados en curso; `failed` indica si falló alguno de los que terminaron mientras tanto
    pending = 0;
    failed = false;
    savingSince = 0;
    savedTimer = null;

    // La región se anuncia si ya estaba en la página antes de cambiar: se crea vacía
    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      this.setAttribute('role', 'status');
      this.innerHTML = `<svg class="save-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>
        <span class="save-status-label"></span>`;
    }

    start() {
      if (this.pending === 0) this.failed = false;
      this.pending += 1;
      clearTimeout(this.savedTimer);
      if (this.dataset.state === 'saving') return;
      this.savingSince = Date.now();
      this.show('saving');
    }

    finish(saved) {
      this.pending -= 1;
      if (!saved) this.failed = true;
      if (this.pending > 0) return;
      if (this.failed) {
        this.show('error');
        return;
      }
      const remaining = MIN_SAVING_MS - (Date.now() - this.savingSince);
      this.savedTimer = setTimeout(() => this.show('saved'), Math.max(0, remaining));
    }

    // data-state elige el color y si el ícono se ve (save-status.css)
    show(state) {
      const { label, icon = '' } = STATES[state];
      this.dataset.state = state;
      this.querySelector('.save-status-icon').innerHTML = icon;
      this.querySelector('.save-status-label').textContent = label;
    }
  }

  customElements.define('save-status', SaveStatus);
})();
