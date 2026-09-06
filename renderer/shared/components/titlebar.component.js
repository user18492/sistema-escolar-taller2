// La barra conserva la región de arrastre y presenta controles propios.
(() => {
  class AppTitlebar extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <header class="window-titlebar" aria-label="Barra de la ventana">
          <button class="window-titlebar-button window-sidebar-toggle" type="button" id="sidebarToggle" aria-label="Ocultar menú" title="Ocultar menú" aria-expanded="true" aria-controls="sidebar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M11 3v18" /></svg>
          </button>
          <div class="window-titlebar-controls" role="group" aria-label="Controles de la ventana">
            <button class="window-titlebar-button" type="button" data-action="minimize" aria-label="Minimizar" title="Minimizar">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h12" /></svg>
            </button>
            <button class="window-titlebar-button" type="button" data-action="maximize" aria-label="Maximizar" title="Maximizar">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path class="window-maximize-icon" d="M3 3h10v10H3z" /><path class="window-restore-icon" d="M5 2h9v9M2 5h9v9H2z" /></svg>
            </button>
            <button class="window-titlebar-button window-titlebar-button-close" type="button" data-action="close" aria-label="Cerrar" title="Cerrar">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
            </button>
          </div>
        </header>`;

      this.querySelector('#sidebarToggle').onclick = (event) => {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        const collapsed = sidebar.classList.toggle('collapsed');
        sidebar.inert = collapsed;
        sidebar.setAttribute('aria-hidden', String(collapsed));
        const button = event.currentTarget;
        const label = collapsed ? 'Mostrar menú' : 'Ocultar menú';
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', label);
        button.title = label;
      };

      const controls = window.api?.windowControls;
      if (!controls) return;

      this.querySelector('[data-action="minimize"]').onclick = () => controls.minimize();
      this.querySelector('[data-action="maximize"]').onclick = () => controls.toggleMaximize();
      this.querySelector('[data-action="close"]').onclick = () => controls.close();
      this.unsubscribeMaximized = controls.onMaximizedChanged((maximized) => this.updateMaximized(maximized));
      controls.isMaximized().then((maximized) => {
        if (this.isConnected) this.updateMaximized(maximized);
      });
    }

    disconnectedCallback() {
      this.unsubscribeMaximized?.();
    }

    updateMaximized(maximized) {
      const button = this.querySelector('[data-action="maximize"]');
      const label = maximized ? 'Restaurar' : 'Maximizar';
      button.classList.toggle('is-maximized', maximized);
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  customElements.define('app-titlebar', AppTitlebar);
})();
