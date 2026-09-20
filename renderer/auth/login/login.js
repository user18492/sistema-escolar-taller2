// Vista Login — interacción puramente visual, sin autenticación real

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const password = document.getElementById('loginPassword');
  const toggle = document.getElementById('passwordToggle');

  // El botón no toma el foco al pulsarlo: así el campo no lo pierde ni lo recupera
  // y su borde azul no parpadea. El foco por teclado (Tab) no se ve afectado.
  toggle.onmousedown = (event) => event.preventDefault();

  // Muestra u oculta los caracteres de la contraseña. Con type="password" el campo
  // vacío sigue mostrando solo el placeholder y, al escribir, los oculta con puntos.
  toggle.onclick = () => {
    const visible = password.type === 'password';
    const hadFocus = document.activeElement === password;
    password.type = visible ? 'text' : 'password';
    const label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
    toggle.classList.toggle('is-visible', visible);
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    // Cambiar el tipo puede descartar el foco: se devuelve solo si el campo ya lo
    // tenía, para no encender el borde azul cuando el campo no estaba enfocado.
    if (hadFocus && document.activeElement !== password) {
      password.focus({ preventScroll: true });
    }
  };

  // La vista es solo visual: el envío no autentica ni recarga la ventana.
  form.onsubmit = (event) => event.preventDefault();
});
