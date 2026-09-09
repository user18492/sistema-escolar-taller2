// Componente global: menús desplegables flotantes dentro de los formularios modal.
// Uso: incluir el script en cualquier vista que tenga modales; no requiere marcado extra.
// Cada .dropdown-menu de un modal (.modal o <dialog>) se promueve al top layer del
// navegador con la API de popover, así que la lista deja de estar recortada por el
// desplazamiento y el alto máximo del panel y desplegarla ya no cambia su tamaño.
// La capa se sitúa siempre debajo del campo, con su mismo ancho, y su alto se limita al
// espacio libre hasta el borde de la ventana para que la lista se desplace por dentro.
// El estado sigue siendo el atributo `hidden` que ya usan las vistas: este componente solo
// lo refleja en el popover, así que ni el marcado ni la lógica de cada vista cambian.

(() => {
  const MENU_SELECTOR = '.modal .dropdown-menu, dialog .dropdown-menu';
  // Misma separación que el `top: calc(100% + 6px)` del menú anclado al campo
  const FIELD_GAP = 6;
  // Aire mínimo entre el menú y el borde inferior de la ventana
  const VIEWPORT_MARGIN = 16;
  // Por debajo de este alto la lista deja de ser utilizable
  const MIN_MENU_HEIGHT = 120;

  // menú -> alto máximo declarado en la hoja de estilos (Infinity si no declara ninguno)
  const declaredMaxHeights = new WeakMap();
  const floatingMenus = new Set();

  const modalOf = (menu) => menu.closest('.modal, dialog');

  const isModalOpen = (modal) =>
    modal.tagName === 'DIALOG'
      ? modal.open
      : modal.closest('.modal-overlay')?.classList.contains('is-open') ?? true;

  // El menú se ancla a la parte visible del campo: el botón del desplegable o la barra de búsqueda
  const anchorOf = (menu) => {
    const field = menu.parentElement;
    return field.querySelector('.dropdown-toggle, .searchable-bar') ?? field;
  };

  // Sitúa la capa bajo el campo, con su mismo ancho, y limita su alto al espacio libre que
  // queda por debajo sin superar el que declare la hoja de estilos
  function place(menu) {
    const anchor = anchorOf(menu).getBoundingClientRect();
    const top = anchor.bottom + FIELD_GAP;
    const available = window.innerHeight - top - VIEWPORT_MARGIN;
    const maxHeight = Math.max(
      Math.min(available, declaredMaxHeights.get(menu)),
      MIN_MENU_HEIGHT
    );

    menu.style.top = `${top}px`;
    menu.style.left = `${anchor.left}px`;
    menu.style.width = `${anchor.width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
  }

  function openMenu(menu) {
    menu.classList.add('is-floating');
    if (!menu.matches(':popover-open')) menu.showPopover();
    place(menu);
    floatingMenus.add(menu);
  }

  function closeMenu(menu) {
    floatingMenus.delete(menu);
    if (menu.matches(':popover-open')) menu.hidePopover();
    menu.classList.remove('is-floating');
    ['top', 'left', 'width', 'maxHeight'].forEach((property) => {
      menu.style[property] = '';
    });
  }

  const syncMenu = (menu) => (menu.hidden ? closeMenu(menu) : openMenu(menu));

  // Las vistas siguen abriendo y cerrando el menú con `hidden`
  const menuObserver = new MutationObserver((records) => {
    records.forEach((record) => syncMenu(record.target));
  });

  // La capa flotante ya no vive dentro del overlay: si el modal se cerrara con un menú
  // desplegado, este quedaría suelto sobre la vista
  const modalObserver = new MutationObserver(() => {
    floatingMenus.forEach((menu) => {
      if (!isModalOpen(modalOf(menu))) menu.hidden = true;
    });
  });

  function registerMenu(menu) {
    if (declaredMaxHeights.has(menu)) return;

    const declared = Number.parseFloat(getComputedStyle(menu).maxHeight);
    declaredMaxHeights.set(menu, Number.isNaN(declared) ? Infinity : declared);
    menu.setAttribute('popover', 'manual');
    menuObserver.observe(menu, { attributes: true, attributeFilter: ['hidden'] });

    // La apertura se marca en el overlay (clase is-open) o en el propio <dialog> (atributo open)
    const modal = modalOf(menu);
    modalObserver.observe(modal.closest('.modal-overlay') ?? modal, {
      attributes: true,
      attributeFilter: ['class', 'open'],
    });

    syncMenu(menu);
  }

  // El panel se desplaza por dentro y la ventana cambia de tamaño: la capa sigue al campo
  const repositionAll = () => floatingMenus.forEach(place);

  window.addEventListener('scroll', repositionAll, { capture: true, passive: true });
  window.addEventListener('resize', repositionAll, { passive: true });

  const registerAll = () => document.querySelectorAll(MENU_SELECTOR).forEach(registerMenu);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerAll);
  else registerAll();
})();
