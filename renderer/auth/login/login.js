// Vista Login — valida el formulario y autentica a través del proceso principal

// Vista inicial de cada rol. El rol es el que devuelve el proceso principal después de
// verificar la cuenta (auth.service.js), nunca uno elegido o guardado en la interfaz.
const HOME_BY_ROLE = {
  ADMIN: '../../admin/dashboard/index.html',
  SECRETARIO: '../../secretary/dashboard/index.html',
  PROFESOR: '../../teacher/assignments/index.html',
};

// Mismas reglas y mensajes que auth.service.js, para avisar sin esperar al proceso
// principal, que vuelve a validar los datos de todas formas.
const EMAIL_MAX_LENGTH = 150;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UNEXPECTED_ERROR_MESSAGE = 'No se pudo iniciar sesión. Intentá nuevamente.';
const UNRECOGNIZED_ROLE_MESSAGE = 'Tu cuenta no tiene un rol habilitado. Contactá al administrador.';

function validateEmail(email) {
  if (!email) return 'Ingresá tu email.';
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) return 'Ingresá un email válido.';
  return '';
}

function validatePassword(password) {
  return password ? '' : 'Ingresá tu contraseña.';
}

// Nunca rechaza: si el IPC falla, devuelve el mismo formato que un error del proceso principal.
async function requestLogin(email, password) {
  try {
    return await window.api.auth.login(email, password);
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    return { ok: false, error: { code: 'UNEXPECTED_ERROR', message: UNEXPECTED_ERROR_MESSAGE } };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const email = document.getElementById('loginEmail');
  const password = document.getElementById('loginPassword');
  const toggle = document.getElementById('passwordToggle');
  const submitButton = document.getElementById('loginSubmit');
  const formError = document.getElementById('loginError');
  const submitLabel = submitButton.textContent;
  let isSubmitting = false;

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

  // El mensaje va en el elemento que describe al campo (aria-describedby); sin mensaje, se oculta.
  const setFieldError = (input, message) => {
    const fieldError = document.getElementById(input.getAttribute('aria-describedby'));
    fieldError.textContent = message;
    fieldError.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  const setFormError = (message) => {
    formError.textContent = message;
    formError.hidden = !message;
  };

  // Los campos quedan de solo lectura y no deshabilitados: conservan el foco y lo enviado
  // coincide con lo que se ve hasta que llega la respuesta.
  const setLoading = (loading) => {
    isSubmitting = loading;
    submitButton.disabled = loading;
    submitButton.classList.toggle('is-loading', loading);
    submitButton.textContent = loading ? 'Ingresando…' : submitLabel;
    email.readOnly = loading;
    password.readOnly = loading;
  };

  // Al editar un campo se descartan su error y el del último intento, que ya no corresponde.
  email.oninput = () => {
    setFieldError(email, '');
    setFormError('');
  };
  password.oninput = () => {
    setFieldError(password, '');
    setFormError('');
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError('');
    const emailValue = email.value.trim();
    const passwordValue = password.value;
    setFieldError(email, validateEmail(emailValue));
    setFieldError(password, validatePassword(passwordValue));
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setLoading(true);
    const result = await requestLogin(emailValue, passwordValue);

    if (result.ok && Object.hasOwn(HOME_BY_ROLE, result.user?.role)) {
      // El estado de carga se mantiene mientras se abre la vista, así no se puede reenviar.
      window.location.assign(HOME_BY_ROLE[result.user.role]);
      return;
    }

    if (result.ok) {
      // Un rol sin vista en la interfaz no debe dejar la sesión abierta.
      window.api.auth.logout().catch((error) => console.error('Error al cerrar la sesión:', error));
    }

    setLoading(false);
    setFormError(result.ok ? UNRECOGNIZED_ROLE_MESSAGE : result.error?.message || UNEXPECTED_ERROR_MESSAGE);

    // Con credenciales incorrectas se selecciona la contraseña para reescribirla directamente.
    if (result.error?.code === 'INVALID_CREDENTIALS') {
      password.focus();
      password.select();
    } else if (!form.contains(document.activeElement)) {
      // Deshabilitar el botón le quita el foco si se había pulsado.
      submitButton.focus();
    }
  };
});
