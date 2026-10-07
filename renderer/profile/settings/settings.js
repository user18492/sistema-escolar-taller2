// Vista Configuración de perfil, compartida por los tres roles (la abre "Configuración", en el menú
// del perfil de sidebar.js). Los campos traen los datos del usuario de la sesión, que llegan del
// proceso principal (window.api.profile.get), y "Guardar cambios" los guarda
// (window.api.profile.update) junto con la foto de perfil y, si se escribió una, la contraseña
// nueva. El resultado se avisa con un toast (toast.component.js), salvo los errores de un campo,
// que se marcan en el formulario. "Eliminar mi cuenta" sigue siendo visual: no da de baja la cuenta.
// La foto de perfil es el componente compartido avatar-editor.component.js y las máscaras y los
// errores de los campos, field-validation.component.js.

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('profileForm');
  // Todo menos el botón "Guardar cambios": queda inerte mientras se cargan o se guardan los datos
  const formSections = form.querySelectorAll(':scope > :not(.settings-actions)');
  const loadError = document.getElementById('profileLoadError');
  const submitBtn = form.querySelector('button[type="submit"]');
  const submitLabel = submitBtn.textContent;
  // Foto de perfil (subir, encuadrar y quitar): componente compartido avatar-editor.component.js.
  const avatarEditor = form.querySelector('avatar-editor');
  const sidebar = document.querySelector('app-sidebar');

  const firstNameInput = document.getElementById('profileFirstName');
  const lastNameInput = document.getElementById('profileLastName');
  const dniInput = document.getElementById('profileDni');
  const emailInput = document.getElementById('profileEmail');
  const birthdateInput = document.getElementById('profileBirthdate');
  const newPasswordInput = document.getElementById('profileNewPassword');
  const repeatPasswordInput = document.getElementById('profileRepeatPassword');

  // Campos que el proceso principal puede marcar (error.fieldErrors), en el orden del formulario
  const FIELD_INPUTS = {
    firstName: firstNameInput,
    lastName: lastNameInput,
    dni: dniInput,
    email: emailInput,
    birthDate: birthdateInput,
    newPassword: newPasswordInput,
    repeatPassword: repeatPasswordInput,
  };

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar tus datos. Intentá nuevamente.';

  let isLoaded = false;
  let isSaving = false;

  // La fecha llega como 'AAAA-MM-DD' (o null) y el campo usa DD/MM/AAAA
  const toDisplayDate = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('/') : '');
  // El campo ya validado (DD/MM/AAAA) se envía como 'AAAA-MM-DD'
  const toIsoDate = (displayDate) => displayDate.split('/').reverse().join('-');

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  const setSectionsInert = (inert) => {
    formSections.forEach((section) => (section.inert = inert));
  };

  // ---------- Datos del usuario de la sesión ----------

  // Deja el formulario con los datos guardados: sin contraseña escrita, sin errores y con la foto
  // del usuario, sin cambios pendientes.
  const showProfile = (profile) => {
    firstNameInput.value = profile.firstName ?? '';
    lastNameInput.value = profile.lastName ?? '';
    dniInput.value = formatDni(profile.dni ?? '');
    emailInput.value = profile.email ?? '';
    birthdateInput.value = toDisplayDate(profile.birthDate);
    newPasswordInput.value = '';
    repeatPasswordInput.value = '';
    clearFieldErrors(form);
    avatarEditor.reset();
    if (profile.imageUrl) avatarEditor.showSavedImage(profile.imageUrl);
  };

  // Si los datos no llegan, el formulario queda inerte y sin poder guardar: con los campos vacíos
  // no hay nada que editar.
  async function loadProfile() {
    setSectionsInert(true);
    let response;
    try {
      response = await window.api?.profile?.get();
    } catch (error) {
      console.error('Error al cargar el perfil:', error);
    }
    if (!response?.ok) {
      loadError.textContent = response?.error?.message || GENERIC_LOAD_ERROR;
      loadError.hidden = false;
      submitBtn.disabled = true;
      return;
    }
    showProfile(response.profile);
    setSectionsInert(false);
    isLoaded = true;
  }

  loadProfile();

  // ---------- Guardar cambios ----------

  // Cambiar la contraseña es opcional: con los dos campos vacíos se conserva la actual
  const isChangingPassword = () => newPasswordInput.value !== '' || repeatPasswordInput.value !== '';

  // Los errores de un campo de contraseña dependen del otro: al editarlo dejan de valer. Se
  // vuelven a comprobar al guardar.
  newPasswordInput.addEventListener('input', () => setFieldError(repeatPasswordInput, ''));
  repeatPasswordInput.addEventListener('input', () => {
    if (!isChangingPassword()) setFieldError(newPasswordInput, '');
  });

  // Mientras se espera la respuesta, los campos quedan inertes, así lo enviado coincide con lo que
  // se ve. El botón queda con aria-disabled y no con disabled: conserva el foco, como en los modales.
  const setSaving = (saving) => {
    isSaving = saving;
    setSectionsInert(saving);
    form.setAttribute('aria-busy', String(saving));
    submitBtn.setAttribute('aria-disabled', String(saving));
    submitBtn.textContent = saving ? 'Guardando…' : submitLabel;
  };

  // El DNI se envía solo con dígitos, como se guarda, y las contraseñas, tal cual se escribieron.
  const readFormData = () => ({
    firstName: firstNameInput.value,
    lastName: lastNameInput.value,
    dni: dniInput.value.replace(/\D/g, ''),
    email: emailInput.value,
    birthDate: toIsoDate(birthdateInput.value),
    newPassword: newPasswordInput.value,
    repeatPassword: repeatPasswordInput.value,
  });

  // Marca los campos que rechazó el proceso principal (DNI o email de otro usuario, datos
  // inválidos) y enfoca el primero. Devuelve false si no había ninguno para marcar.
  const showFieldErrors = (fieldErrors = {}) => {
    const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
    invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
    invalidFields[0]?.[1].focus();
    return invalidFields.length > 0;
  };

  // Guarda y lo avisa con un toast. Los errores de un campo se marcan en el formulario y los demás
  // salen en un toast: en ambos casos el formulario sigue con lo que se escribió y la foto elegida.
  const saveProfile = async () => {
    const focusedElement = document.activeElement;
    setSaving(true);
    let response;
    try {
      // image null no cambia la foto
      const imageChange = await avatarEditor.readChange();
      response = await window.api?.profile?.update({ ...readFormData(), ...imageChange });
    } catch (error) {
      console.error('Error al guardar el perfil:', error);
    }
    setSaving(false);
    // El campo que tenía el foco (Enter) lo perdió al quedar inerte
    if (document.activeElement === document.body && form.contains(focusedElement)) focusedElement.focus();

    if (response?.ok) {
      showProfile(response.profile);
      // El nombre y la foto del menú del perfil salen de la sesión, que ya tiene los datos nuevos
      sidebar.loadSessionUser();
      showToast({ type: 'success', title: 'Perfil actualizado', description: 'Se guardaron los cambios de tu perfil.' });
      return;
    }
    const error = response?.error;
    if (showFieldErrors(error?.fieldErrors)) return;
    showToast({ type: 'error', title: 'No se pudieron guardar los cambios', description: errorDescription(error) });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isLoaded || isSaving) return;
    // Con uno de los dos campos de contraseña escrito hacen falta ambos: validateFields marca el
    // vacío como obligatorio.
    newPasswordInput.required = isChangingPassword();
    repeatPasswordInput.required = isChangingPassword();
    // Con algún campo inválido, el foco queda en el primero. El proceso principal vuelve a validar
    // todo y guarda solo el hash de la contraseña (password.service.js).
    if (validateFields(form)) return;
    saveProfile();
  });

  // ---------- Modal: Eliminar cuenta ----------

  // Componente compartido confirm-modal.component.js. Sigue siendo visual: la baja real de la
  // cuenta se conecta con onConfirm cuando exista en la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteUserOverlay'), { triggerSelector: '#deleteAccountBtn' });
});
