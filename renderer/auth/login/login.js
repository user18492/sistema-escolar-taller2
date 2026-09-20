// Vista Login — interacción puramente visual, sin autenticación real

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const password = document.getElementById('loginPassword');
  const toggle = document.getElementById('passwordToggle');

  // Muestra u oculta los caracteres de la contraseña. Con type="password" el campo
  // vacío sigue mostrando solo el placeholder y, al escribir, los oculta con puntos.
  toggle.onclick = () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    const label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
    toggle.classList.toggle('is-visible', visible);
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    // El cursor vuelve al campo, al final de lo escrito.
    password.focus({ preventScroll: true });
  };

  // La vista es solo visual: el envío no autentica ni recarga la ventana.
  form.onsubmit = (event) => event.preventDefault();
});
