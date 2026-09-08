// Componente reutilizable: navbar lateral (sidebar), compartido por todas las vistas de la app.
// Uso: <app-sidebar active="dashboard"></app-sidebar>
// El atributo "active" marca qué item del menú se resalta como actual.
// Sin shadow DOM a propósito: así los estilos de sidebar.css (selectores .sidebar, .nav-item, etc.) siguen aplicando tal cual.

(() => {
  const logoUrl = new URL('../../../resources/logotipo_header.png', document.currentScript.src).href;
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

  class AppSidebar extends HTMLElement {
    connectedCallback() {
      const active = this.getAttribute('active') || '';

      const navHtml = NAV_ITEMS.map((item) => {
        const activeClass = item.key === active ? ' active' : '';
        return `
          <a class="nav-item${activeClass}" href="${item.href}"${item.key === active ? ' aria-current="page"' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              ${item.icon}
            </svg>
            ${item.label}
          </a>`;
      }).join('');

      this.innerHTML = `
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <div class="sidebar-logo"><img src="${logoUrl}" alt="Gestión educativa" draggable="false" /></div>
            <p class="sidebar-institution"></p>
          </div>
          <nav class="sidebar-nav" aria-label="Navegación principal">
            ${navHtml}
          </nav>
          <div class="sidebar-profile">
            <div class="profile-panel" id="profilePanel" role="group" aria-label="Opciones de usuario">
              <button class="profile-option" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3-1.5-2v-3l1.5-1.5-2-3-2 .5-2-1-.5-2z" /><circle cx="11" cy="12" r="3" />
                </svg>
                Configuración
              </button>
              <button class="profile-option" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 12h12m-5-5 5 5-5 5" />
                </svg>
                Cerrar sesión
              </button>
            </div>
            <button class="profile-button" type="button" aria-expanded="false" aria-controls="profilePanel">
              <span class="profile-avatar" aria-hidden="true"></span>
              <span class="profile-info">
                <span class="profile-name"></span>
                <span class="profile-role"></span>
              </span>
            </button>
          </div>
        </aside>`;
      this.querySelector('.sidebar-institution').textContent = this.getAttribute('institution-name') || 'Institución San Martín';
      this.querySelector('.profile-name').textContent = this.getAttribute('user-name') || 'Ana Morales';
      this.querySelector('.profile-role').textContent = this.getAttribute('user-role') || 'Administradora';
      const avatar = this.querySelector('.profile-avatar');
      avatar.textContent = this.getAttribute('user-initials') || 'AM';
      const imageUrl = this.getAttribute('user-image');
      if (imageUrl) {
        const image = document.createElement('img');
        image.alt = '';
        image.src = imageUrl;
        image.addEventListener('error', () => image.remove());
        avatar.append(image);
      }

      // Volver a pulsar la vista activa no debe recargar la página: sin navegación no se
      // vuelve a renderizar el contenido ni se repite el fade-in de entrada de la vista.
      this.querySelector('.sidebar-nav').addEventListener('click', (event) => {
        const item = event.target.closest('.nav-item');
        if (item?.classList.contains('active')) event.preventDefault();
      });

      const profile = this.querySelector('.sidebar-profile');
      const button = this.querySelector('.profile-button');
      const panel = this.querySelector('.profile-panel');
      const options = [...panel.querySelectorAll('button')];
      // El estado abierto vive en la clase `is-open` y no en el atributo `hidden`: así el
      // panel conserva su `display` mientras dura la transición de salida definida en
      // sidebar.css y solo se oculta (saliendo del foco y del árbol de accesibilidad)
      // cuando esa transición termina.
      const isOpen = () => panel.classList.contains('is-open');
      const setOpen = (open) => {
        panel.classList.toggle('is-open', open);
        button.setAttribute('aria-expanded', String(open));
      };
      this.profileListeners?.abort();
      this.profileListeners = new AbortController();
      const { signal } = this.profileListeners;
      button.addEventListener('click', () => setOpen(!isOpen()), { signal });
      profile.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) {
          event.preventDefault();
          setOpen(false);
          button.focus();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          setOpen(true);
          const index = options.indexOf(document.activeElement);
          const next = index < 0 ? (event.key === 'ArrowUp' ? options.length - 1 : 0)
            : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
          options[next].focus();
        }
      }, { signal });
      panel.addEventListener('click', (event) => {
        if (event.target.closest('button')) {
          setOpen(false);
          button.focus();
        }
      }, { signal });
      document.addEventListener('click', (event) => {
        if (!profile.contains(event.target)) setOpen(false);
      }, { signal });
      document.addEventListener('focusin', (event) => {
        if (!profile.contains(event.target)) setOpen(false);
      }, { signal });
    }

    disconnectedCallback() {
      this.profileListeners?.abort();
    }
  }

  customElements.define('app-sidebar', AppSidebar);
})();
