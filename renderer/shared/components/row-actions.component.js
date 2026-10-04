// Componente reutilizable: acciones de las filas de tabla (Editar y Eliminar, con "Gestionar" opcional;
// o Reactivar, en las filas de los registros dados de baja).
// Uso: <row-actions edit-label="Editar curso" delete-label="Borrar curso"></row-actions> en la última celda.
//   - "edit-label" / "delete-label": aria-label y title de cada botón.
//   - "reactivate-label" (opcional): la fila es de un registro dado de baja. En lugar de Editar y
//     Eliminar lleva solo Reactivar, con ese aria-label y title.
//   - "variant" (opcional): "user" usa .user-actions/.user-action; por defecto .table-actions/.table-action.
//   - "manage-href" (opcional): antepone un <manage-link> con ese href (requiere manage-link.component.js).
// Los botones llevan data-action="edit" / "delete" / "reactivate". confirm-modal.component.js atiende
// Eliminar por delegación, pero hay vistas que enlazan Editar en DOMContentLoaded, así que el script
// se carga sin defer en <head>.
// Estilos en base.css.

(() => {
  const ICONS = {
    // resources/PencilSquare.svg
    edit: '<path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />',
    // resources/Trash.svg
    delete: '<path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />',
    // resources/ArrowUturnLeft.svg
    reactivate: '<path d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />',
  };

  class RowActions extends HTMLElement {
    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      const prefix = this.getAttribute('variant') === 'user' ? 'user' : 'table';
      // Un registro dado de baja no se edita ni se elimina: solo se reactiva
      const actions = this.hasAttribute('reactivate-label') ? ['reactivate'] : ['edit', 'delete'];
      const buttons = actions.map((action) => `<button class="${prefix}-action" type="button" data-action="${action}" aria-label="" title="">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            ${ICONS[action]}
          </svg>
        </button>`);
      this.innerHTML = `<div class="${prefix}-actions">
        ${buttons.join('\n        ')}
      </div>`;

      this.querySelectorAll('[data-action]').forEach((button) => {
        const label = this.getAttribute(`${button.dataset.action}-label`);
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
      });

      // El href se asigna antes de conectar el <manage-link>, que lo lee al generarse
      const manageHref = this.getAttribute('manage-href');
      if (manageHref) {
        const manageLink = document.createElement('manage-link');
        manageLink.setAttribute('href', manageHref);
        this.firstElementChild.prepend('\n', manageLink);
      }
    }
  }

  customElements.define('row-actions', RowActions);
})();
