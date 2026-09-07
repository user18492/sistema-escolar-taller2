// Componente global: reajuste progresivo del tamaño de los modales.
// Uso: incluir el script en cualquier vista que tenga modales; no requiere marcado extra.
// Cuando el contenido cambia el alto o el ancho de un panel (.modal o <dialog>), el
// contenedor se lleva desde su tamaño anterior hasta el nuevo con la misma curva y
// duración que la card del gráfico de Inicio, en lugar de saltar de golpe.
// El tamaño se anima con estilos en línea temporales y la clase .is-resizing definida en
// base.css, así que ni la estructura ni la lógica de cada vista necesitan cambios.

(() => {
  const MODAL_SELECTOR = '.modal, dialog';
  // Debe superar la duración de --size-transition
  const FALLBACK_MS = 700;
  // Por debajo de 1 px el cambio no se percibe y no vale la pena animarlo
  const MIN_DELTA_PX = 1;
  // Los cambios de tamaño encadenados a un redimensionado de la ventana son del layout,
  // no del contenido: se aplican al instante para que el panel siga al borde de la ventana
  const WINDOW_RESIZE_GRACE_MS = 250;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // modal -> { open, size, finish } ; `finish` cierra la transición en curso, si la hay
  const states = new WeakMap();
  let windowResizedAt = -Infinity;

  const isOpen = (modal) =>
    modal.tagName === 'DIALOG'
      ? modal.open
      : modal.closest('.modal-overlay')?.classList.contains('is-open') ?? true;

  // Caja de layout, sin el `transform` de entrada y salida del modal
  const measure = (modal) => ({ width: modal.offsetWidth, height: modal.offsetHeight });

  const differs = (a, b) =>
    Math.abs(a.width - b.width) >= MIN_DELTA_PX || Math.abs(a.height - b.height) >= MIN_DELTA_PX;

  // Lleva el modal desde `from` hasta `to` con la transición de --size-transition
  function animateResize(modal, from, to) {
    const state = states.get(modal);

    modal.classList.add('is-resizing');
    modal.style.width = `${from.width}px`;
    modal.style.height = `${from.height}px`;
    void modal.offsetHeight; // fija el tamaño inicial antes de animar
    modal.style.width = `${to.width}px`;
    modal.style.height = `${to.height}px`;

    const finish = () => {
      window.clearTimeout(fallbackTimer);
      modal.removeEventListener('transitionend', onTransitionEnd);
      state.finish = null;
      modal.classList.remove('is-resizing');
      modal.style.width = '';
      modal.style.height = '';
      // El contenido pudo cambiar otra vez durante la transición: se retoma desde el
      // tamaño alcanzado hasta el natural actual, sin salto visible
      state.size = measure(modal);
      if (state.open && !reducedMotion.matches && differs(state.size, to)) {
        animateResize(modal, to, state.size);
      }
    };

    const onTransitionEnd = (transitionEvent) => {
      if (transitionEvent.target !== modal) return;
      if (transitionEvent.propertyName === 'height' || transitionEvent.propertyName === 'width') finish();
    };

    // Respaldo por si la transición no llega a emitir su evento de fin
    const fallbackTimer = window.setTimeout(finish, FALLBACK_MS);
    modal.addEventListener('transitionend', onTransitionEnd);
    state.finish = finish;
  }

  // El observador se dispara ya con el nuevo tamaño calculado y antes de pintarlo, así que
  // restituir el tamaño anterior aquí no produce parpadeo
  const sizeObserver = new ResizeObserver((entries) => {
    const afterWindowResize = performance.now() - windowResizedAt < WINDOW_RESIZE_GRACE_MS;

    entries.forEach((entry) => {
      const modal = entry.target;
      const state = states.get(modal);
      // Mientras dura la transición, los cambios de tamaño son los que aplica este componente
      if (!state || state.finish) return;

      const previous = state.size;
      state.size = measure(modal);
      if (!state.open || reducedMotion.matches || afterWindowResize) return;
      if (!differs(previous, state.size)) return;

      animateResize(modal, previous, state.size);
    });
  });

  // Al abrir o cerrar, el tamaño de referencia se renueva sin animar: el panel ya entra y
  // sale con su propia transición de opacidad y desplazamiento
  function syncOpenState(container) {
    const modal = container.tagName === 'DIALOG' ? container : container.querySelector('.modal');
    const state = states.get(modal);
    // Solo interesa el cambio de apertura: el resto de cambios de clase del contenedor
    // se ignoran, incluida la propia .is-resizing de un <dialog> en plena transición
    if (!state || state.open === isOpen(modal)) return;

    state.open = !state.open;
    state.finish?.();
    state.size = measure(modal);
  }

  const openObserver = new MutationObserver((records) => {
    records.forEach((record) => syncOpenState(record.target));
  });

  function registerModal(modal) {
    if (states.has(modal)) return;

    states.set(modal, { open: isOpen(modal), size: measure(modal), finish: null });
    sizeObserver.observe(modal);
    // La apertura se marca en el overlay (clase is-open) o en el propio <dialog> (atributo open)
    openObserver.observe(modal.closest('.modal-overlay') ?? modal, {
      attributes: true,
      attributeFilter: ['class', 'open'],
    });
  }

  // Redimensionar la ventana cambia el ancho de los modales abiertos: ese cambio se aplica
  // al instante para que el panel no quede arrastrándose detrás del borde de la ventana
  window.addEventListener(
    'resize',
    () => {
      windowResizedAt = performance.now();
    },
    { passive: true }
  );

  const registerAll = () => document.querySelectorAll(MODAL_SELECTOR).forEach(registerModal);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerAll);
  else registerAll();
})();
