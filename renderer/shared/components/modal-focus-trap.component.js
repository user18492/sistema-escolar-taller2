// Componente global: retención del foco dentro de los modales abiertos.
// Uso: incluir el script en cualquier vista que tenga modales (.modal-overlay); no requiere
// marcado extra ni llamadas desde la vista.
// Al recorrer el modal con Tab, pasar del último control vuelve al primero y Shift+Tab desde
// el primero vuelve al último, así que el foco no se escapa hacia la vista que queda detrás.
// Los <dialog> abiertos con showModal() ya retienen el foco de forma nativa y no se tocan.

(() => {
  const OPEN_OVERLAY_SELECTOR = '.modal-overlay.is-open';
  const CONTROL_SELECTOR = [
    'a[href]',
    'button:not(:disabled)',
    'input:not(:disabled)',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  // Solo cuentan los controles visibles: se descartan menús cerrados y secciones ocultas
  const visibleControls = (container) =>
    Array.from(container.querySelectorAll(CONTROL_SELECTOR)).filter(
      (element) => element.getClientRects().length > 0
    );

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    // Solo actúa cuando el foco está dentro de un overlay abierto
    const overlay = event.target.closest?.(OPEN_OVERLAY_SELECTOR);
    if (!overlay) return;

    const controls = visibleControls(overlay);
    const first = controls[0];
    const last = controls[controls.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
