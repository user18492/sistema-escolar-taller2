// Componente reutilizable: acciones de las filas de tabla (Editar y Eliminar, con Imprimir y "Gestionar"
// opcionales; o Restaurar, en las filas de los registros dados de baja).
// Uso: <row-actions edit-label="Editar curso" delete-label="Borrar curso"></row-actions> en la última celda.
//   - "edit-label" / "delete-label": aria-label y title de cada botón. La acción que no tiene su
//     etiqueta no se genera (solo "delete-label": la fila lleva únicamente Eliminar).
//   - "print-label" (opcional): antepone Imprimir, con ese aria-label y title.
//   - "restore-label" (opcional): la fila es de un registro dado de baja. En lugar de Editar y
//     Eliminar lleva solo Restaurar, con ese aria-label y title.
//   - "disabled" (opcional): las acciones no están disponibles para esa fila y sus botones quedan
//     deshabilitados. Se puede poner y quitar con la fila ya en la tabla.
//   - "read-only-title" (opcional): el registro de la fila es de solo lectura (p. ej., de un ciclo
//     lectivo cerrado, school-year.js). Editar y Eliminar quedan deshabilitados y llevan ese texto
//     como title, con su etiqueta como aria-label; Imprimir, Restaurar y "Gestionar" no cambian. Se
//     puede poner y quitar con la fila ya en la tabla, y se suma a "disabled".
//   - "variant" (opcional): "user" usa .user-actions/.user-action; por defecto .table-actions/.table-action.
//   - "manage-href" (opcional): antepone un <manage-link> con ese href (requiere manage-link.component.js).
// Los botones llevan data-action="print" / "edit" / "delete" / "restore". confirm-modal.component.js atiende
// Eliminar y Restaurar por delegación, pero hay vistas que enlazan Editar en DOMContentLoaded, así
// que el script se carga sin defer en <head>.
// Estilos en base.css.

(() => {
  const ICONS = {
    // resources/Printer.svg
    print: '<path d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />',
    // resources/PencilSquare.svg
    edit: '<path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />',
    // resources/Trash.svg
    delete: '<path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />',
    // resources/ArrowUturnLeft.svg
    restore: '<path d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />',
  };

  // Acciones que un registro de solo lectura ("read-only-title") no ofrece
  const READ_ONLY_ACTIONS = ['edit', 'delete'];

  class RowActions extends HTMLElement {
    static observedAttributes = ['disabled', 'read-only-title'];

    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      const prefix = this.getAttribute('variant') === 'user' ? 'user' : 'table';
      // Un registro dado de baja no se edita ni se elimina: solo se restaura. Del resto, va cada
      // acción que tenga su etiqueta
      const actions = this.hasAttribute('restore-label')
        ? ['restore']
        : ['print', 'edit', 'delete'].filter((action) => this.hasAttribute(`${action}-label`));
      const buttons = actions.map((action) => `<button class="${prefix}-action" type="button" data-action="${action}" aria-label="" title="">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            ${ICONS[action]}
          </svg>
        </button>`);
      this.innerHTML = `<div class="${prefix}-actions">
        ${buttons.join('\n        ')}
      </div>`;

      this.querySelectorAll('[data-action]').forEach((button) => {
        button.setAttribute('aria-label', this.getAttribute(`${button.dataset.action}-label`));
      });
      this.syncButtons();

      // El href se asigna antes de conectar el <manage-link>, que lo lee al generarse
      const manageHref = this.getAttribute('manage-href');
      if (manageHref) {
        const manageLink = document.createElement('manage-link');
        manageLink.setAttribute('href', manageHref);
        this.firstElementChild.prepend('\n', manageLink);
      }
    }

    // Deshabilita los botones según "disabled" y "read-only-title" y les pone su title: la etiqueta
    // de la acción o, en Editar y Eliminar de un registro de solo lectura, el motivo
    syncButtons() {
      const readOnlyTitle = this.getAttribute('read-only-title');
      this.querySelectorAll('[data-action]').forEach((button) => {
        const { action } = button.dataset;
        const isReadOnly = readOnlyTitle !== null && READ_ONLY_ACTIONS.includes(action);
        button.disabled = this.hasAttribute('disabled') || isReadOnly;
        button.setAttribute('title', isReadOnly ? readOnlyTitle : this.getAttribute(`${action}-label`));
      });
    }

    // Antes de conectarse no hay botones que actualizar: connectedCallback lee los valores iniciales.
    attributeChangedCallback() {
      if (this.rendered) this.syncButtons();
    }
  }

  customElements.define('row-actions', RowActions);
})();
