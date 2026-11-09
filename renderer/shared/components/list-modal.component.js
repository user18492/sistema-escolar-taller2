// Componente global: modal por pasos de los reportes (Materias sin docente por curso, Carga docente
// por profesor, Inscripciones activas por curso). Un único modal muestra el listado completo de una
// celda de la tabla y, desde una acción de ese listado (o de la celda), un formulario
// (<assignment-form> o <enrollment-form>) en el mismo modal: listado → formulario → listado
// actualizado, sin abrir otro modal encima. Un modal sin listado (sin .list-modal-step) solo se abre
// en el formulario, con openForm desde la tabla: la X y Escape lo cierran igual.
// Marcado (estilos en list-modal.css):
//   <div class="modal-overlay">
//     <div class="modal list-modal" role="dialog" aria-modal="true" aria-label="">
//       <div class="list-modal-head"><button type="button" class="list-modal-close">…</button></div>
//       <div class="list-modal-step"><ul class="list-modal-items"></ul></div>
//       <assignment-form hidden></assignment-form>
//     </div>
//   </div>
// Uso: const listModal = setupListModal(overlay, { form, focusAfterClose }), una vez. `form` es el
// formulario del modal (<assignment-form> o <enrollment-form>, con open, focusFirst, closeMenus e
// isSaving; la vista llama a su setup y le pasa onCancel: listModal.cancelForm);
// `focusAfterClose(trigger)` devuelve dónde dejar el foco al cerrar si el botón que abrió el modal
// ya no está en la página (la tabla se volvió a dibujar).
// API:
//   - openList(trigger, { label, items, renderItem }): abre el modal en el listado. `label` es su
//     nombre accesible (no tiene título visible) y renderItem(item) arma el <li> de cada elemento;
//     el foco pasa a la X. `trigger`, el botón de la tabla que lo abrió.
//   - openForm(trigger, formOptions, { fromItem = false }): pasa al formulario con
//     form.open(formOptions). Con fromItem, `trigger` es la acción de un elemento del listado ya
//     abierto, y Cancelar vuelve al listado con el foco en ella; sin él, el modal se abre directo en
//     el formulario desde el botón `trigger` de la tabla, y Cancelar lo cierra.
//   - cancelForm(): lo que hace Cancelar en el formulario (el onCancel de su setup).
//   - showList(items): después de guardar, o si lo elegido quedó viejo, vuelve al listado con
//     `items`, los datos nuevos, y el foco en la acción del elemento que quedó en el lugar del que
//     abrió el formulario. Cierra el modal si `items` está vacío o si se había abierto directo en
//     el formulario.
//   - close() e isOpen().
// La X y Escape cierran el modal en cualquier paso; Escape, después de cerrar un desplegable
// abierto (dropdown.component.js lo resuelve antes). Mientras el formulario guarda, ni la X ni
// Escape responden. Al cerrar, el foco vuelve al botón que abrió el modal o al de focusAfterClose.
// El modal toma el ancho del formulario en ese paso (list-modal.css) y modal-resize.js anima el
// cambio de tamaño.

(() => {
  window.setupListModal = (overlay, { form = null, focusAfterClose = null } = {}) => {
    const modal = overlay.querySelector('.modal');
    // Sin listado, el modal solo tiene el paso del formulario
    const listStep = modal.querySelector('.list-modal-step');
    const list = listStep?.querySelector('.list-modal-items') ?? null;
    const closeButton = modal.querySelector('.list-modal-close');
    // El nombre accesible del paso del formulario es su título
    const formTitleId = form?.querySelector('h2[id]')?.id ?? null;

    // Lo que muestra el listado ({ label, items, renderItem }); null si el modal se abrió directo en
    // el formulario
    let listOptions = null;
    // El botón de la tabla que abrió el modal, al que vuelve el foco al cerrarlo
    let trigger = null;
    // La acción del listado que abrió el formulario; null si se abrió directo
    let formTrigger = null;

    const isOpen = () => overlay.classList.contains('is-open');
    const isSaving = () => Boolean(form?.isSaving);

    // Muestra el paso `step` ('list' o 'form') y le da al modal su nombre accesible: el `label` del
    // listado o el título del formulario
    const showStep = (step) => {
      const isForm = step === 'form';
      if (listStep) listStep.hidden = isForm;
      if (form) form.hidden = !isForm;
      modal.classList.toggle('is-form-step', isForm);
      if (isForm && formTitleId) {
        modal.removeAttribute('aria-label');
        modal.setAttribute('aria-labelledby', formTitleId);
      } else {
        modal.removeAttribute('aria-labelledby');
        modal.setAttribute('aria-label', listOptions?.label ?? '');
      }
      modal.scrollTop = 0;
    };

    const renderList = () => {
      list.replaceChildren(...listOptions.items.map((item) => listOptions.renderItem(item)));
    };

    const openList = (button, options) => {
      trigger = button;
      formTrigger = null;
      listOptions = options;
      renderList();
      showStep('list');
      overlay.classList.add('is-open');
      closeButton.focus();
    };

    const openForm = (button, formOptions, { fromItem = false } = {}) => {
      if (fromItem) {
        formTrigger = button;
      } else {
        trigger = button;
        formTrigger = null;
        listOptions = null;
      }
      showStep('form');
      form.open(formOptions);
      overlay.classList.add('is-open');
      form.focusFirst();
    };

    const close = () => {
      if (!isOpen()) return;
      overlay.classList.remove('is-open');
      form?.closeMenus();
      const target = trigger?.isConnected ? trigger : focusAfterClose?.(trigger);
      target?.focus();
      trigger = null;
      formTrigger = null;
      listOptions = null;
    };

    // Vuelve al listado con el foco en `focusTarget` (o, si ya no está, en la X)
    const backToList = (focusTarget) => {
      form?.closeMenus();
      showStep('list');
      formTrigger = null;
      (focusTarget?.isConnected ? focusTarget : closeButton).focus();
    };

    const cancelForm = () => {
      if (listOptions && formTrigger) backToList(formTrigger);
      else close();
    };

    const showList = (items) => {
      if (!isOpen()) return;
      if (!listOptions || !items?.length) {
        close();
        return;
      }
      // La posición del elemento que abrió el formulario, para dejar el foco en el que ocupe su lugar
      const index = Math.max(0, Array.from(list.children).findIndex((item) => item.contains(formTrigger)));
      listOptions = { ...listOptions, items };
      renderList();
      const item = list.children[Math.min(index, list.children.length - 1)];
      backToList(item?.querySelector('.list-modal-action') ?? closeButton);
    };

    closeButton.addEventListener('click', () => {
      if (!isSaving()) close();
    });

    // Escape se escucha en el documento para que funcione aunque el foco haya quedado fuera de un
    // control (clic en el texto de la lista). El overlay no cierra el modal al hacer clic fuera.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen() && !isSaving()) close();
    });

    return { openList, openForm, cancelForm, showList, close, isOpen };
  };
})();
