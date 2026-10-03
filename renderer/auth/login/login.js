// Vista Login — valida el formulario y autentica a través del proceso principal. Quien pertenece a
// varias instituciones elige después con cuál ingresar, en un segundo paso dentro de la misma tarjeta.

// Vista inicial de cada rol. El rol es el que devuelve el proceso principal después de
// verificar la cuenta (auth.service.js), nunca uno elegido o guardado en la interfaz.
// Mismas vistas que HOME_VIEW_BY_ROLE en navigation-guard.js, que igual rechaza cualquier
// vista que no corresponda a la sesión.
const HOME_BY_ROLE = {
  ADMIN: '../../admin/dashboard/index.html',
  SECRETARIO: '../../secretary/dashboard/index.html',
  PROFESOR: '../../teacher/assignments/index.html',
};

// Nombre visible de cada rol (usuario_rol.nombre), igual que en el menú lateral (sidebar.js).
const ROLE_LABELS = {
  ADMIN: 'Administrador',
  SECRETARIO: 'Secretario',
  PROFESOR: 'Profesor',
};

const INSTITUTIONS_TITLE = 'Elegí una institución';
// institucion.nombre admite null.
const UNNAMED_INSTITUTION = 'Institución sin nombre';

const UNEXPECTED_ERROR_MESSAGE = 'No se pudo iniciar sesión. Intentá nuevamente.';
const UNRECOGNIZED_ROLE_MESSAGE = 'Tu cuenta no tiene un rol habilitado. Contactá al administrador.';

// Mismos mensajes que auth.service.js (y las mismas reglas, en isValidEmail de
// field-validation.component.js), para avisar sin esperar al proceso principal, que vuelve a
// validar los datos de todas formas.
function validateEmail(email) {
  if (!email) return 'Ingresá tu email.';
  if (!isValidEmail(email)) return 'Ingresá un email válido.';
  return '';
}

function validatePassword(password) {
  return password ? '' : 'Ingresá tu contraseña.';
}

// Nunca rechaza: si el IPC falla, devuelve el mismo formato que un error del proceso principal.
async function requestLogin(email, password, rememberAccount) {
  try {
    return await window.api.auth.login(email, password, rememberAccount);
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    return { ok: false, error: { code: 'UNEXPECTED_ERROR', message: UNEXPECTED_ERROR_MESSAGE } };
  }
}

// Nunca rechaza, como requestLogin.
async function requestSelectInstitution(institutionId, rememberAccount) {
  try {
    return await window.api.auth.selectInstitution(institutionId, rememberAccount);
  } catch (error) {
    console.error('Error al elegir la institución:', error);
    return { ok: false, error: { code: 'UNEXPECTED_ERROR', message: UNEXPECTED_ERROR_MESSAGE } };
  }
}

// Nunca rechaza: si no se puede leer, el formulario queda como sin cuenta recordada.
async function requestRememberedEmail() {
  try {
    return await window.api.auth.getRememberedEmail();
  } catch (error) {
    console.error('Error al obtener la cuenta recordada:', error);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const title = document.getElementById('loginTitle');
  const form = document.getElementById('loginForm');
  const email = document.getElementById('loginEmail');
  const password = document.getElementById('loginPassword');
  const toggle = document.getElementById('passwordToggle');
  const rememberAccount = document.getElementById('rememberAccount');
  const submitButton = document.getElementById('loginSubmit');
  const formError = document.getElementById('loginError');
  const institutionStep = document.getElementById('institutionStep');
  const institutionAccount = document.getElementById('institutionAccount');
  const institutionList = document.getElementById('institutionList');
  const institutionError = document.getElementById('institutionError');
  const institutionBack = document.getElementById('institutionBack');
  const institutionOptionTemplate = document.getElementById('institutionOptionTemplate');
  const formTitle = title.textContent;
  const submitLabel = submitButton.textContent;
  // Hay un pedido en curso al proceso principal: el login o la elección de la institución.
  let isSubmitting = false;

  // Con una cuenta recordada, el email llega completo y la casilla marcada: solo falta la contraseña.
  // Si ya se empezó a escribir otro email, se respeta.
  requestRememberedEmail().then((rememberedEmail) => {
    if (!rememberedEmail || email.value) return;
    email.value = rememberedEmail;
    rememberAccount.checked = true;
    if (document.activeElement === document.body) password.focus();
  });

  // Desmarcar la casilla olvida el email en el momento; marcarla lo guarda recién con el próximo
  // acceso exitoso (auth.controller.js).
  rememberAccount.onchange = () => {
    if (rememberAccount.checked) return;
    window.api.auth.forgetRememberedEmail().catch((error) => {
      console.error('Error al olvidar la cuenta recordada:', error);
    });
  };

  // Mientras se verifica la cuenta la casilla no cambia: su valor ya se envió con los datos.
  rememberAccount.onclick = (event) => {
    if (isSubmitting) event.preventDefault();
  };

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

  // Los errores de cada campo se muestran con setFieldError (field-validation.component.js),
  // en el elemento #<id>Error que lo describe (aria-describedby).
  const setError = (element, message) => {
    element.textContent = message;
    element.hidden = !message;
  };
  const setFormError = (message) => setError(formError, message);
  const setInstitutionError = (message) => setError(institutionError, message);

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

  // Con un rol que tiene vista en la interfaz, la abre y devuelve true: quien llama mantiene el
  // estado de carga mientras se abre, así no se puede reenviar. Si no la tiene, devuelve false y
  // cierra la sesión, que no debe quedar abierta.
  const openHome = (user) => {
    if (Object.hasOwn(HOME_BY_ROLE, user?.role)) {
      window.location.assign(HOME_BY_ROLE[user.role]);
      return true;
    }
    window.api.auth.logout().catch((error) => console.error('Error al cerrar la sesión:', error));
    return false;
  };

  // ---------- Selector de instituciones ----------

  // Las opciones y "Volver" quedan con aria-disabled y no con disabled: así conservan el foco.
  const setSelecting = (selecting) => {
    isSubmitting = selecting;
    institutionStep.setAttribute('aria-busy', String(selecting));
    institutionStep.querySelectorAll('button').forEach((button) => button.setAttribute('aria-disabled', String(selecting)));
  };

  // Reemplaza el formulario por las instituciones a las que permiten ingresar las credenciales
  // ({ id, name, role }, con el rol del usuario en cada una). El formulario conserva sus valores.
  const showInstitutions = (institutions, accountEmail) => {
    institutionList.replaceChildren(...institutions.map((institution) => {
      const item = institutionOptionTemplate.content.firstElementChild.cloneNode(true);
      item.querySelector('.institution-option').dataset.institutionId = institution.id;
      item.querySelector('.institution-name').textContent = institution.name || UNNAMED_INSTITUTION;
      item.querySelector('.institution-role').textContent = ROLE_LABELS[institution.role] ?? '';
      return item;
    }));
    institutionAccount.textContent = accountEmail;
    setInstitutionError('');
    title.textContent = INSTITUTIONS_TITLE;
    form.hidden = true;
    institutionStep.hidden = false;
    institutionList.querySelector('.institution-option').focus();
  };

  const showForm = () => {
    institutionStep.hidden = true;
    institutionList.replaceChildren();
    title.textContent = formTitle;
    form.hidden = false;
  };

  // Por delegación: las opciones se generan con cada login.
  institutionList.onclick = async (event) => {
    const option = event.target.closest('.institution-option');
    if (!option || isSubmitting) return;

    setInstitutionError('');
    setSelecting(true);
    const result = await requestSelectInstitution(Number(option.dataset.institutionId), rememberAccount.checked);

    if (result.ok && openHome(result.user)) return;

    setSelecting(false);
    const message = result.ok ? UNRECOGNIZED_ROLE_MESSAGE : result.error?.message || UNEXPECTED_ERROR_MESSAGE;

    // Sin un login a la espera de la elección no queda nada que elegir: hay que volver a ingresar
    // las credenciales.
    if (result.ok || result.error?.code === 'NO_PENDING_LOGIN') {
      showForm();
      setFormError(message);
      password.focus();
      password.select();
      return;
    }
    setInstitutionError(message);
  };

  // Descarta las cuentas que el proceso principal dejó a la espera de la elección.
  institutionBack.onclick = () => {
    if (isSubmitting) return;
    window.api.auth.logout().catch((error) => console.error('Error al cancelar el inicio de sesión:', error));
    showForm();
    email.focus();
  };

  // ---------- Formulario ----------

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
    const result = await requestLogin(emailValue, passwordValue, rememberAccount.checked);

    // Las credenciales permiten ingresar a varias instituciones: falta elegir con cuál.
    if (result.ok && result.institutions?.length > 0) {
      setLoading(false);
      showInstitutions(result.institutions, emailValue);
      return;
    }

    if (result.ok && openHome(result.user)) return;

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
