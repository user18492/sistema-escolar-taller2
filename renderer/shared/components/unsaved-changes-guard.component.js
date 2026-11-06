// Componente global: aviso de cambios sin guardar al salir de una vista. Mientras la vista tenga
// cambios sin guardar, cada salida pide confirmación en un modal de confirm-modal.component.js con
// action="leave": "Cancelar" se queda en la vista con los cambios y "Salir sin guardar" los descarta
// y sale. Sin cambios sin guardar, sale enseguida, sin modal.
// Uso: setupUnsavedChangesGuard(overlay, opciones) en DOMContentLoaded, con el .modal-overlay de
// <confirm-modal entity="Scores" action="leave" heading="…" description="…"></confirm-modal>
// (ids leave{entity}Overlay, cancelLeave{entity}Btn, confirmLeave{entity}Btn).
// Opciones:
//   - hasUnsavedChanges(): true si la vista tiene cambios sin guardar; se consulta en cada salida.
//   - fallbackFocus(): como en setupConfirmModal, el foco al cancelar si el control que abrió el
//     modal ya no está en el documento o quedó deshabilitado.
// Qué cubre:
//   - Los enlaces de la vista, con el ratón o con Enter: el menú lateral, la ruta de navegación y
//     "Configuración" del menú del perfil. No abren el modal los que ya cancelaron su navegación (el
//     item activo del menú: sidebar.js hace preventDefault), los que no tienen href ni las anclas.
//     Al cancelar, el foco vuelve al control que lo tenía al hacer clic: el enlace o, en
//     "Configuración", el botón del perfil, porque el menú del perfil se cierra al elegir la opción.
//   - window.requestLeave(proceed, trigger), para las salidas que se hacen desde código ("Cerrar
//     sesión" de sidebar.js): sin cambios sin guardar llama a proceed(); con cambios, abre el modal
//     y la llama al confirmar. Si proceed() devuelve una promesa, el modal la espera abierto
//     ("Saliendo…"). trigger es el control al que vuelve el foco al cancelar.
//   - El cierre de la aplicación ("Salir" de la bandeja y el apagado, el reinicio o el cierre de
//     sesión de Windows): con cambios, el proceso principal no cierra, muestra la ventana y pide el
//     mismo modal (window.api.app.onQuitRequested); "Salir sin guardar" cierra la aplicación
//     (window.api.app.quit). Para decidir en el acto, el proceso principal necesita saber si hay
//     cambios: setupUnsavedChangesGuard devuelve { notify }, que la vista llama cada vez que pueden
//     cambiar, y se le informa con window.api.app.setUnsavedChanges solo cuando el valor cambia.
//     Si el pedido llega sin cambios (el aviso quedó desactualizado), cierra directamente; con el
//     modal de salida ya abierto, lo que se confirma pasa a ser cerrar la aplicación; con otro
//     modal abierto, lo cierra con su "Cancelar" y abre el de salida, salvo que esté esperando
//     (aria-busy="true", p. ej. "Guardando…"): entonces espera a que termine y vuelve a evaluar.
// No cubre la ✕ del titlebar, que oculta la ventana y conserva los cambios, ni las terminaciones
// forzadas (Administrador de tareas), que no se pueden interceptar.
// El script se carga sin defer en <head>, después de confirm-modal.component.js.

(() => {
  window.setupUnsavedChangesGuard = (overlay, { hasUnsavedChanges, fallbackFocus } = {}) => {
    // La salida que se está confirmando, mientras el modal está abierto
    let proceed = null;
    // Ya confirmada: las salidas que siguen (la navegación de proceed) no vuelven a preguntar
    let isReleased = false;
    // Lo último que se le informó al proceso principal: al abrirse la vista, sin cambios
    let reportedUnsavedChanges = false;
    // Mientras un pedido de cierre espera a que termine el guardado de otro modal
    let isWaitingForModal = false;

    const leave = (action) => {
      isReleased = true;
      const result = action();
      if (typeof result?.then !== 'function') return result;
      // Si la salida no se completó (p. ej., no se pudo cerrar la sesión), la vista sigue abierta
      // con sus cambios y la próxima salida vuelve a preguntar
      return result.finally(() => {
        isReleased = false;
      });
    };

    const modal = setupConfirmModal(overlay, {
      fallbackFocus,
      onConfirm: () => leave(proceed),
    });

    window.requestLeave = (action, trigger = null) => {
      if (isReleased || !hasUnsavedChanges?.()) return action();
      proceed = action;
      modal.open(trigger);
      return undefined;
    };

    // Le informa al proceso principal si hay cambios sin guardar, solo cuando el valor cambia: lo
    // necesita para decidir en el acto si el cierre de la aplicación pregunta (quit-guard.js)
    const notify = () => {
      const value = Boolean(hasUnsavedChanges?.());
      if (value === reportedUnsavedChanges) return;
      reportedUnsavedChanges = value;
      window.api?.app?.setUnsavedChanges(value).catch((error) => {
        console.error('Error al informar los cambios sin guardar:', error);
      });
    };

    const quitApp = () => window.api.app.quit();

    // El proceso principal pide confirmar el cierre de la aplicación ("Salir" de la bandeja o el
    // apagado de Windows), ya con la ventana visible
    const requestQuit = () => {
      if (isWaitingForModal) return;
      // Sin cambios (el aviso al proceso principal quedó desactualizado) o con la salida ya
      // confirmada: cierra directamente
      if (isReleased || !hasUnsavedChanges?.()) {
        quitApp();
        return;
      }
      // Con el modal de salida abierto, lo que se confirma pasa a ser cerrar la aplicación
      if (overlay.classList.contains('is-open')) {
        proceed = quitApp;
        return;
      }
      const otherModal = document.querySelector('.modal-overlay.is-open');
      if (otherModal) {
        // Guardando ("Guardando…"): se espera a que termine y se vuelve a evaluar, porque el
        // guardado puede dejar la vista sin cambios
        if (otherModal.querySelector('[aria-busy="true"]')) {
          isWaitingForModal = true;
          const observer = new MutationObserver(() => {
            if (otherModal.classList.contains('is-open') && otherModal.querySelector('[aria-busy="true"]')) return;
            observer.disconnect();
            isWaitingForModal = false;
            requestQuit();
          });
          observer.observe(otherModal, { attributes: true, attributeFilter: ['class', 'aria-busy'], subtree: true });
          return;
        }
        // Si no espera nada, se cierra con su "Cancelar", que devuelve el foco a quien lo abrió
        otherModal.querySelector('.confirm-actions .btn-neutral')?.click();
      }
      const focused = document.activeElement;
      window.requestLeave(quitApp, focused && focused !== document.body ? focused : null);
    };

    window.api?.app?.onQuitRequested(requestQuit);

    // En fase de burbuja: así llegan ya con el preventDefault del item activo del menú
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      const link = event.target.closest?.('a[href]');
      const href = link?.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      event.preventDefault();
      const focused = document.activeElement;
      const trigger = focused && focused !== document.body ? focused : link;
      window.requestLeave(() => {
        window.location.href = link.href;
      }, trigger);
    });

    return { notify };
  };
})();
