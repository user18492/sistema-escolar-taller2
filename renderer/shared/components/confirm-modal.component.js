// Componente global: modal de confirmación de las acciones destructivas (Eliminar).
// Uso: setupConfirmModal(overlay, opciones) con el .modal-overlay del modal, cuyo .confirm-actions
// tiene el botón Cancelar (.btn-neutral) y el de confirmación (.btn-danger); los estilos
// están en confirm-modal.css.
// Lo abre cada botón [data-action="delete"] de las filas de la tabla, también de las que la vista
// agrega después de llamar a setupConfirmModal: se cierran los filtros de
// columna abiertos y el foco pasa a "Cancelar". Cancelar, Escape y confirmar lo cierran y
// devuelven el foco al botón que lo abrió. Escape se escucha en el documento mientras está
// abierto, así que también lo cierra si el foco quedó fuera de un control (clic en su texto).
// El overlay no lo cierra al hacer clic fuera.
// Opciones:
//   - beforeOpen(): se llama antes de abrirlo (la vista cierra ahí sus dropdowns y buscadores).
//   - onConfirm(trigger): se llama al confirmar, con el botón de la fila. Si devuelve una promesa,
//     el modal la espera abierto: "Sí, eliminar" pasa a "Eliminando…" y ni los botones ni Escape
//     responden. Si el resultado es { message }, el modal sigue abierto, muestra el mensaje debajo
//     de la descripción y el foco vuelve a "Cancelar"; con { message, canRetry: false }, "Sí,
//     eliminar" queda deshabilitado (p. ej., el registro ya no existe). Con cualquier otro
//     resultado se cierra.
//   - fallbackFocus(): al cerrar, si el botón que lo abrió ya no está en el documento (su fila se
//     eliminó), el foco pasa al elemento que devuelva.
// Marcado: <confirm-modal entity="User" heading="Eliminar usuario" description="¿Quieres eliminar
// este usuario?"></confirm-modal> genera el .modal-overlay con los ids delete{entity}Overlay,
// delete{entity}Title, delete{entity}Description, delete{entity}Message, cancelDelete{entity}Btn
// y confirmDelete{entity}Btn.
// El script se carga sin defer en <head>, así el marcado existe antes de que la vista llame a
// setupConfirmModal en DOMContentLoaded.

(() => {
  const TRIGGER_SELECTOR = '.data-table tbody [data-action="delete"]';
  const PENDING_LABEL = 'Eliminando…';
  // Solo si la promesa de onConfirm se rechaza: la vista debería resolverla con su propio mensaje
  const GENERIC_ERROR = 'No se pudo completar la operación. Intentá nuevamente.';

  // resources/ExclamationTriangle.svg
  const WARNING_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>`;

  class ConfirmModal extends HTMLElement {
    connectedCallback() {
      // Se genera una sola vez: los listeners de setupConfirmModal quedan sobre estos nodos
      if (this.rendered) return;
      this.rendered = true;
      const entity = this.getAttribute('entity');
      this.innerHTML = `<div class="modal-overlay" id="delete${entity}Overlay">
        <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete${entity}Title" aria-describedby="delete${entity}Description">
          <div class="confirm-content">
            <span class="confirm-icon" aria-hidden="true">
              ${WARNING_ICON}
            </span>
            <h2 id="delete${entity}Title"></h2>
            <p id="delete${entity}Description"></p>
            <p class="confirm-message" id="delete${entity}Message" role="alert" hidden></p>
          </div>

          <div class="confirm-actions">
            <button type="button" class="btn btn-neutral" id="cancelDelete${entity}Btn">Cancelar</button>
            <button type="button" class="btn btn-danger" id="confirmDelete${entity}Btn">Sí, eliminar</button>
          </div>
        </div>
      </div>`;
      this.querySelector('.confirm-content h2').textContent = this.getAttribute('heading');
      this.querySelector('.confirm-content p').textContent = this.getAttribute('description');
    }
  }

  customElements.define('confirm-modal', ConfirmModal);

  window.setupConfirmModal = (overlay, { beforeOpen, onConfirm, fallbackFocus } = {}) => {
    const dialog = overlay.querySelector('.modal-confirm');
    const message = overlay.querySelector('.confirm-message');
    const cancelButton = overlay.querySelector('.confirm-actions .btn-neutral');
    const confirmButton = overlay.querySelector('.confirm-actions .btn-danger');
    const confirmLabel = confirmButton.textContent;
    let trigger = null;
    let isPending = false;

    const showMessage = (text) => {
      message.textContent = text;
      message.hidden = !text;
    };

    // Mientras espera, los botones quedan con aria-disabled y no con disabled: así conservan el
    // foco y la retención de modal-focus-trap sigue teniendo controles donde apoyarse.
    const setPending = (pending) => {
      isPending = pending;
      dialog.setAttribute('aria-busy', String(pending));
      [cancelButton, confirmButton].forEach((button) => button.setAttribute('aria-disabled', String(pending)));
      confirmButton.textContent = pending ? PENDING_LABEL : confirmLabel;
    };

    const openModal = (button) => {
      trigger = button;
      beforeOpen?.();
      document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
      showMessage('');
      confirmButton.disabled = false;
      overlay.classList.add('is-open');
      // "Cancelar" recibe el foco para evitar eliminaciones accidentales con Enter.
      cancelButton.focus();
    };

    const closeModal = () => {
      overlay.classList.remove('is-open');
      (trigger?.isConnected ? trigger : fallbackFocus?.())?.focus();
    };

    // Con un mensaje, el modal sigue abierto para mostrarlo; sin mensaje, se cierra
    const finish = (result) => {
      if (!result?.message) {
        closeModal();
        return;
      }
      showMessage(result.message);
      confirmButton.disabled = result.canRetry === false;
      cancelButton.focus();
    };

    // Por delegación, para abarcar también las filas que la vista genera después de cargar
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.(TRIGGER_SELECTOR);
      if (button) openModal(button);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('is-open') && !isPending) closeModal();
    });
    cancelButton.addEventListener('click', () => {
      if (!isPending) closeModal();
    });
    confirmButton.addEventListener('click', () => {
      if (isPending) return;
      const result = onConfirm?.(trigger);
      if (typeof result?.then !== 'function') {
        finish(result);
        return;
      }
      showMessage('');
      setPending(true);
      result
        .catch((error) => {
          console.error('Error al confirmar la acción:', error);
          return { message: GENERIC_ERROR };
        })
        .then((value) => {
          setPending(false);
          finish(value);
        });
    });
  };
})();
