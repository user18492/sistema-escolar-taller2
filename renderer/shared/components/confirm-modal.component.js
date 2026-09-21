// Componente global: modal de confirmación de las acciones destructivas (Eliminar).
// Uso: setupConfirmModal(overlay, opciones) con el .modal-overlay del modal, cuyo .confirm-actions
// tiene el botón Cancelar (.btn-neutral) y el de confirmación (.btn-danger); los estilos
// están en confirm-modal.css.
// Lo abre cada botón [data-action="delete"] de las filas de la tabla: se cierran los filtros de
// columna abiertos y el foco pasa a "Cancelar". Cancelar, Escape y confirmar lo cierran y
// devuelven el foco al botón que lo abrió. El overlay no lo cierra al hacer clic fuera.
// Opciones:
//   - beforeOpen(): se llama antes de abrirlo (la vista cierra ahí sus dropdowns y buscadores).
//   - onConfirm(trigger): se llama al confirmar, antes de cerrarlo, con el botón de la fila.

(() => {
  const TRIGGER_SELECTOR = '.data-table tbody [data-action="delete"]';

  window.setupConfirmModal = (overlay, { beforeOpen, onConfirm } = {}) => {
    const cancelButton = overlay.querySelector('.confirm-actions .btn-neutral');
    const confirmButton = overlay.querySelector('.confirm-actions .btn-danger');
    let trigger = null;

    const openModal = (button) => {
      trigger = button;
      beforeOpen?.();
      document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
      overlay.classList.add('is-open');
      // "Cancelar" recibe el foco para evitar eliminaciones accidentales con Enter.
      cancelButton.focus();
    };

    const closeModal = () => {
      overlay.classList.remove('is-open');
      trigger?.focus();
    };

    document.querySelectorAll(TRIGGER_SELECTOR).forEach((button) => {
      button.addEventListener('click', () => openModal(button));
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });
    cancelButton.addEventListener('click', closeModal);
    confirmButton.addEventListener('click', () => {
      onConfirm?.(trigger);
      closeModal();
    });
  };
})();
