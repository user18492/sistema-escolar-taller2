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
// No cubre la ✕ del titlebar, que oculta la ventana y conserva los cambios, ni el cierre de la
// aplicación.
// El script se carga sin defer en <head>, después de confirm-modal.component.js.

(() => {
  window.setupUnsavedChangesGuard = (overlay, { hasUnsavedChanges, fallbackFocus } = {}) => {
    // La salida que se está confirmando, mientras el modal está abierto
    let proceed = null;
    // Ya confirmada: las salidas que siguen (la navegación de proceed) no vuelven a preguntar
    let isReleased = false;

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
  };
})();
