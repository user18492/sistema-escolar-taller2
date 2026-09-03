// Componente reutilizable: navbar lateral (sidebar), compartido por todas las vistas de la app.
// Uso: <app-sidebar active="dashboard"></app-sidebar>
// El atributo "active" marca qué item del menú se resalta como actual.
// Sin shadow DOM a propósito: así los estilos de sidebar.css (selectores .sidebar, .nav-item, etc.) siguen aplicando tal cual.

(() => {
  const NAV_ITEMS = [
    {
      key: 'dashboard',
      href: '../dashboard/index.html',
      label: 'Inicio',
      icon: '<path d="M3 11.5L12 4l9 7.5" /><path d="M5 10v10h5v-6h4v6h5V10" />',
    },
    {
      key: 'users',
      href: '../users/index.html',
      label: 'Usuarios',
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />',
    },
    {
      key: 'courses',
      href: '../courses/index.html',
      label: 'Cursos',
      icon: '<path d="M2 4h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />',
    },
    {
      key: 'assignments',
      href: '../assignments/index.html',
      label: 'Docencia',
      icon: '<path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />',
    },
    {
      key: 'reports',
      href: '../reports/index.html',
      label: 'Reportes',
      icon: '<path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" />',
    },
  ];

  const BRAND_ICON =
    '<path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />';

  class AppSidebar extends HTMLElement {
    connectedCallback() {
      const active = this.getAttribute('active') || '';

      const navHtml = NAV_ITEMS.map((item) => {
        const activeClass = item.key === active ? ' active' : '';
        return `
          <a class="nav-item${activeClass}" href="${item.href}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              ${item.icon}
            </svg>
            ${item.label}
          </a>`;
      }).join('');

      this.innerHTML = `
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
              ${BRAND_ICON}
            </svg>
            <span>Gestión Escolar</span>
          </div>

          <nav class="sidebar-nav">
            ${navHtml}
          </nav>
        </aside>`;
    }
  }

  customElements.define('app-sidebar', AppSidebar);
})();
