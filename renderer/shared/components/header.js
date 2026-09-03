// Componente reutilizable: header superior (topbar), compartido por todas las vistas de la app.
// Uso: <app-header user-name="Ana Morales" user-role="Administradora" user-initials="AM"></app-header>
// Los atributos son opcionales; si se omiten se usan los valores por defecto (usuaria admin actual).
// Sin shadow DOM a propósito: así los estilos de header.css (selectores .topbar, .user-menu, etc.) siguen aplicando tal cual,
// y el botón #sidebarToggle sigue siendo accesible por id para el toggle del sidebar en cada vista.

(() => {
  class AppHeader extends HTMLElement {
    connectedCallback() {
      const userName = this.getAttribute('user-name') || 'Ana Morales';
      const userRole = this.getAttribute('user-role') || 'Administradora';
      const userInitials = this.getAttribute('user-initials') || 'AM';

      this.innerHTML = `
        <header class="topbar">
          <button class="icon-btn" type="button" id="sidebarToggle" aria-label="Alternar menú" aria-expanded="true" aria-controls="sidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div class="topbar-right">
            <button class="icon-btn" type="button" aria-label="Configuración">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            <div class="user-menu">
              <div class="avatar">${userInitials}</div>
              <div class="user-info">
                <span class="user-name">${userName}</span>
                <span class="user-role">${userRole}</span>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </header>`;
    }
  }

  customElements.define('app-header', AppHeader);
})();
