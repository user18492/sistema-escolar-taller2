// Componente reutilizable: navbar lateral (sidebar), compartido por todas las vistas de la app.
// Uso: <app-sidebar nav-role="admin" active="dashboard"></app-sidebar>
// El atributo "nav-role" elige el menú del rol (por defecto "admin") y "active" marca
// qué item de ese menú se resalta como actual.
// Sin shadow DOM a propósito: así los estilos de sidebar.css (selectores .sidebar, .nav-item, etc.) siguen aplicando tal cual.

(() => {
  const logoUrl = new URL('../../../resources/logotipo_header.png', document.currentScript.src).href;
  // Cada rol tiene su propio menú: las vistas viven en renderer/<rol>/<vista>, así que
  // los enlaces son relativos a la carpeta hermana dentro del mismo rol.
  // Atributos del <svg> según el estilo del ícono: "outline" (trazo 1.75) es el
  // predeterminado; "resource" replica los atributos de los íconos outline de resources/
  // (viewBox 24, trazo 1.5). Los trazos se copian en línea para que hereden currentColor.
  const ICON_SVG_ATTRS = {
    outline: 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"',
    resource: 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
  };
  const NAV_ITEMS_BY_ROLE = {
    admin: [
      {
        key: 'dashboard',
        href: '../dashboard/index.html',
        label: 'Inicio',
        // resources/Home.svg
        iconStyle: 'resource',
        icon: '<path d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />',
      },
      {
        key: 'users',
        href: '../users/index.html',
        label: 'Usuarios',
        // resources/Users.svg
        iconStyle: 'resource',
        icon: '<path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />',
      },
      {
        key: 'courses',
        href: '../courses/index.html',
        label: 'Cursos',
        // resources/RectangleStack.svg
        iconStyle: 'resource',
        icon: '<path d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-.98.626-1.813 1.5-2.122" />',
      },
      {
        key: 'assignments',
        href: '../assignments/index.html',
        label: 'Docencia',
        // resources/ClipboardDocumentList.svg
        iconStyle: 'resource',
        icon: '<path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />',
      },
      {
        key: 'reports',
        href: '../reports/index.html',
        label: 'Reportes',
        // resources/ChartBar.svg
        iconStyle: 'resource',
        icon: '<path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />',
      },
    ],
    teacher: [
      {
        key: 'assignments',
        href: '../assignments/index.html',
        label: 'Asignaciones',
        icon: '<path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />',
      },
    ],
    secretary: [
      {
        key: 'students',
        href: '../students/index.html',
        label: 'Alumnos',
        icon: '<path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />',
      },
      {
        key: 'enrollments',
        href: '../enrollments/index.html',
        label: 'Inscripciones',
        icon: '<path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="m9 14 2 2 4-4" />',
      },
    ],
  };

  class AppSidebar extends HTMLElement {
    connectedCallback() {
      const active = this.getAttribute('active') || '';
      const requestedRole = this.getAttribute('nav-role') || 'admin';
      const navRole = Object.hasOwn(NAV_ITEMS_BY_ROLE, requestedRole) ? requestedRole : 'admin';
      const navItems = NAV_ITEMS_BY_ROLE[navRole];

      const navHtml = navItems.map((item) => {
        const activeClass = item.key === active ? ' active' : '';
        return `
          <a class="nav-item${activeClass}" href="${item.href}"${item.key === active ? ' aria-current="page"' : ''}>
            <svg ${ICON_SVG_ATTRS[item.iconStyle] || ICON_SVG_ATTRS.outline}>
              ${item.icon}
            </svg>
            ${item.label}
          </a>`;
      }).join('');

      this.innerHTML = `
        <aside class="sidebar" id="sidebar" data-nav-role="${navRole}">
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
