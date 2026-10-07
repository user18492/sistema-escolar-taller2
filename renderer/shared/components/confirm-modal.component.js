// Componente global: modal de confirmación de las acciones sobre una fila de la tabla: las
// destructivas (Eliminar) y la restauración de un registro dado de baja (Restaurar).
// Uso: setupConfirmModal(overlay, opciones) con el .modal-overlay del modal, cuyo .confirm-actions
// tiene el botón Cancelar (.btn-neutral) y el de confirmación (.btn-danger o, al restaurar,
// .btn-primary); los estilos están en confirm-modal.css.
// Lo abre cada botón de las filas de la tabla con el data-action de su acción ("delete" o
// "restore"), también de las que la vista agrega después de llamar a setupConfirmModal: se
// cierran los filtros de columna abiertos y el foco pasa a "Cancelar". Cancelar, Escape y
// confirmar lo cierran y devuelven el foco al botón que lo abrió. Escape se escucha en el
// documento mientras está abierto, así que también lo cierra si el foco quedó fuera de un control
// (clic en su texto). El overlay no lo cierra al hacer clic fuera.
// Opciones:
//   - beforeOpen(): se llama antes de abrirlo (la vista cierra ahí sus dropdowns y buscadores).
//   - onConfirm(trigger): se llama al confirmar, con el botón de la fila. Si devuelve una promesa,
//     el modal la espera abierto: "Sí, eliminar" pasa a "Eliminando…" ("Sí, restaurar", a
//     "Restaurando…") y ni los botones ni Escape responden. Si el resultado es { message }, el
//     modal sigue abierto, muestra el mensaje debajo de la descripción y el foco vuelve a
//     "Cancelar"; con { message, canRetry: false }, el botón de confirmación queda deshabilitado
//     (p. ej., el registro ya no existe). Con cualquier otro resultado se cierra.
//   - fallbackFocus(): al cerrar, si el botón que lo abrió ya no está en el documento (su fila se
//     eliminó), el foco pasa al elemento que devuelva.
//   - triggerSelector: selector de los botones que lo abren, para las vistas donde la acción no
//     está en las filas de una tabla ("Eliminar mi cuenta" en Configuración de perfil).
// Marcado: <confirm-modal entity="User" heading="Eliminar usuario" description="¿Quieres eliminar
// este usuario?"></confirm-modal> genera el .modal-overlay con los ids delete{entity}Overlay,
// delete{entity}Title, delete{entity}Description, delete{entity}Message, cancelDelete{entity}Btn
// y confirmDelete{entity}Btn.
//   - "action" (opcional): "restore" confirma una restauración en lugar de una eliminación, con
//     el ícono de pregunta y el botón de confirmación en azul. Los ids llevan esa acción en lugar
//     de "delete": restore{entity}Overlay, cancelRestore{entity}Btn…
// El script se carga sin defer en <head>, así el marcado existe antes de que la vista llame a
// setupConfirmModal en DOMContentLoaded.

(() => {
  // Solo si la promesa de onConfirm se rechaza: la vista debería resolverla con su propio mensaje
  const GENERIC_ERROR = 'No se pudo completar la operación. Intentá nuevamente.';

  // resources/ExclamationTriangle.svg
  const WARNING_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>`;

  // resources/QuestionMarkCircle.svg
  const QUESTION_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
              </svg>`;

  // Lo que cambia con la acción que se confirma, por el data-action de los botones de las filas
  // que abren el modal: el ícono y su color, y el botón de confirmación con su texto, en reposo y
  // mientras espera
  const ACTIONS = {
    delete: {
      icon: WARNING_ICON,
      iconClass: 'confirm-icon',
      confirmClass: 'btn-danger',
      confirmLabel: 'Sí, eliminar',
      pendingLabel: 'Eliminando…',
    },
    restore: {
      icon: QUESTION_ICON,
      iconClass: 'confirm-icon confirm-icon-blue',
      confirmClass: 'btn-primary',
      confirmLabel: 'Sí, restaurar',
      pendingLabel: 'Restaurando…',
    },
  };

  class ConfirmModal extends HTMLElement {
    connectedCallback() {
      // Se genera una sola vez: los listeners de setupConfirmModal quedan sobre estos nodos
      if (this.rendered) return;
      this.rendered = true;
      const entity = this.getAttribute('entity');
      const action = this.getAttribute('action') ?? 'delete';
      const { icon, iconClass, confirmClass, confirmLabel } = ACTIONS[action];
      // Los ids de los botones llevan la acción con mayúscula inicial: cancelDelete{entity}Btn
      const buttonId = `${action[0].toUpperCase()}${action.slice(1)}${entity}Btn`;
      this.innerHTML = `<div class="modal-overlay" id="${action}${entity}Overlay" data-confirm-action="${action}">
        <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="${action}${entity}Title" aria-describedby="${action}${entity}Description">
          <div class="confirm-content">
            <span class="${iconClass}" aria-hidden="true">
              ${icon}
            </span>
            <h2 id="${action}${entity}Title"></h2>
            <p id="${action}${entity}Description"></p>
            <p class="confirm-message" id="${action}${entity}Message" role="alert" hidden></p>
          </div>

          <div class="confirm-actions">
            <button type="button" class="btn btn-neutral" id="cancel${buttonId}">Cancelar</button>
            <button type="button" class="btn ${confirmClass}" id="confirm${buttonId}">${confirmLabel}</button>
          </div>
        </div>
      </div>`;
      this.querySelector('.confirm-content h2').textContent = this.getAttribute('heading');
      this.querySelector('.confirm-content p').textContent = this.getAttribute('description');
    }
  }

  customElements.define('confirm-modal', ConfirmModal);

  window.setupConfirmModal = (overlay, { beforeOpen, onConfirm, fallbackFocus, triggerSelector } = {}) => {
    // La acción del modal la fija su marcado (atributo "action" de <confirm-modal>)
    const action = overlay.dataset.confirmAction;
    const { confirmClass, pendingLabel } = ACTIONS[action];
    // Sin triggerSelector lo abren los botones de las filas de la tabla
    const openerSelector = triggerSelector ?? `.data-table tbody [data-action="${action}"]`;
    const dialog = overlay.querySelector('.modal-confirm');
    const message = overlay.querySelector('.confirm-message');
    const cancelButton = overlay.querySelector('.confirm-actions .btn-neutral');
    const confirmButton = overlay.querySelector(`.confirm-actions .${confirmClass}`);
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
      confirmButton.textContent = pending ? pendingLabel : confirmLabel;
    };

    const openModal = (button) => {
      trigger = button;
      beforeOpen?.();
      document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
      showMessage('');
      confirmButton.disabled = false;
      overlay.classList.add('is-open');
      // "Cancelar" recibe el foco para evitar confirmaciones accidentales con Enter.
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
      const button = event.target.closest?.(openerSelector);
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
