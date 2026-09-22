// Componente global: dropdowns de selección única (.dropdown con un .dropdown-toggle, su
// .dropdown-label y un .dropdown-menu de .dropdown-option).
// Uso: la vista llama a setupDropdowns(opciones) al cargar y recibe { closeDropdown,
// closeAllDropdowns } para cerrarlos desde sus modales. Se llama antes de que la vista registre
// sus propios listeners sobre las opciones, para que el genérico siga corriendo primero.
// Actúa sobre los .dropdown que existen al llamarlo:
//   - abrir uno cierra los demás, y un clic fuera de ellos los cierra todos;
//   - Escape resuelve primero el desplegable abierto: lo cierra, devuelve el foco a su botón y
//     consume la pulsación antes que los handlers de los modales, que solo la reciben si no había
//     ninguno abierto. Si hay un <dialog> modal o un popover automático abiertos (recorte de
//     avatar, filtros de column-filter.js), Escape les pertenece y el navegador los cierra; los
//     menús flotantes de modal-dropdown.js son popovers manuales y no cuentan. Las repeticiones
//     de la tecla mantenida se descartan, para que una pulsación no encadene varios cierres;
//   - elegir una opción la marca como seleccionada, copia su data-label (o su texto) en la
//     etiqueta, le quita .placeholder y emite "dropdown-change" con su data-value;
//   - las opciones con aria-disabled="true" no se pueden elegir;
//   - la etiqueta que arranca con .placeholder guarda ese texto en data-placeholder, para que
//     la vista pueda restablecerlo;
//   - un .dropdown sin botón o sin menú se ignora.
// Opciones, para que los buscadores (searchable-select.component.js) se cierren junto con los
// dropdowns:
//   - onToggle(): se llama cada vez que se pulsa el botón de un dropdown, después de cerrar los demás.
//   - onDismiss(event): se llama con cada clic en el documento y con Escape, después de cerrar
//     los dropdowns; con Escape devuelve true si cerró algún desplegable, y esa pulsación
//     también se consume.

(() => {
  // Capas que resuelven Escape por sí mismas
  const NATIVE_LAYER_SELECTOR = 'dialog:modal, :popover-open:not([popover="manual"])';

  window.setupDropdowns = ({ onToggle, onDismiss } = {}) => {
    const dropdowns = document.querySelectorAll('.dropdown');

    const closeDropdown = (dropdown) => {
      dropdown.classList.remove('open');
      dropdown.querySelector('.dropdown-toggle')?.setAttribute('aria-expanded', 'false');
      const menu = dropdown.querySelector('.dropdown-menu');
      if (menu) menu.hidden = true;
    };

    const closeAllDropdowns = (except) => {
      dropdowns.forEach((dropdown) => {
        if (dropdown !== except) closeDropdown(dropdown);
      });
    };

    dropdowns.forEach((dropdown) => {
      const toggle = dropdown.querySelector('.dropdown-toggle');
      const label = dropdown.querySelector('.dropdown-label');
      const menu = dropdown.querySelector('.dropdown-menu');
      if (!toggle || !menu) return;
      const options = dropdown.querySelectorAll('.dropdown-option');

      if (label?.classList.contains('placeholder')) {
        label.dataset.placeholder = label.textContent.trim();
      }

      toggle.addEventListener('click', () => {
        const isOpen = dropdown.classList.contains('open');
        closeAllDropdowns(dropdown);
        onToggle?.();

        if (isOpen) {
          closeDropdown(dropdown);
          return;
        }

        dropdown.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
      });

      options.forEach((option) => {
        option.addEventListener('click', () => {
          if (option.getAttribute('aria-disabled') === 'true') return;
          options.forEach((o) => {
            o.classList.remove('selected');
            o.setAttribute('aria-selected', 'false');
          });
          option.classList.add('selected');
          option.setAttribute('aria-selected', 'true');
          label.textContent = option.dataset.label ?? option.textContent.trim();
          label.classList.remove('placeholder');
          closeDropdown(dropdown);
          dropdown.dispatchEvent(new CustomEvent('dropdown-change', { detail: { value: option.dataset.value } }));
        });
      });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.dropdown')) {
        closeAllDropdowns();
      }
      onDismiss?.(event);
    });

    // En fase de captura, para decidir antes que los handlers de los modales
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.repeat) {
        consume();
        return;
      }
      if (document.querySelector(NATIVE_LAYER_SELECTOR)) return;

      const openDropdown = Array.from(dropdowns).find((dropdown) => dropdown.classList.contains('open'));
      closeAllDropdowns();
      openDropdown?.querySelector('.dropdown-toggle').focus();
      const dismissed = onDismiss?.(event);
      if (openDropdown || dismissed) consume();
    }, true);

    return { closeDropdown, closeAllDropdowns };
  };
})();
