// Componente global: notificaciones toast, avisos breves del resultado de una operación.
// Uso: showToast({ type, title, description }) desde cualquier vista que enlace toast.css y
// cargue este script; no requiere marcado: la pila (.toast-stack) se crea en <body> con el
// primer toast.
// Opciones:
//   - type: 'success' (por defecto) o 'error'. Define el color, el ícono y el rol (status o alert).
//   - title y description: textos del aviso. Se asignan con textContent, nunca como HTML.
// Aparecen abajo a la derecha, el más nuevo pegado a la esquina. Con MAX_VISIBLE a la vista, el
// siguiente cierra el más antiguo. Cada toast se cierra solo cuando termina su barra de progreso
// (5 s, toast.css), que se pausa con el puntero o el foco encima, o antes con su botón ✕.

(() => {
  const MAX_VISIBLE = 3;

  const ICONS = {
    // resources/CheckCircle.svg
    success: '<path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
    // resources/XCircle.svg
    error: '<path d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let stack = null;

  // Con animaciones, lo quita el animationend de la salida; sin ellas, no habría tal evento
  const dismiss = (toast) => {
    if (toast.classList.contains('is-leaving')) return;
    if (reducedMotion.matches) toast.remove();
    else toast.classList.add('is-leaving');
  };

  window.showToast = ({ type = 'success', title, description }) => {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.append(stack);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${ICONS[type]}
      </svg>
      <div class="toast-text">
        <p class="toast-title"></p>
        <p class="toast-description"></p>
      </div>
      <button type="button" class="toast-close" aria-label="Cerrar notificación">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <span class="toast-progress"></span>`;
    toast.querySelector('.toast-title').textContent = title;
    toast.querySelector('.toast-description').textContent = description;

    toast.querySelector('.toast-close').addEventListener('click', () => dismiss(toast));
    // El animationend de la barra burbujea hasta el toast: se distingue por el nombre
    toast.addEventListener('animationend', (event) => {
      if (event.animationName === 'toast-progress') dismiss(toast);
      else if (event.animationName === 'toast-out') toast.remove();
    });

    const visibleToasts = stack.querySelectorAll('.toast:not(.is-leaving)');
    if (visibleToasts.length >= MAX_VISIBLE) dismiss(visibleToasts[0]);
    stack.append(toast);
  };
})();
