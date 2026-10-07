const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const userService = require('../services/user.service');
const { RECOGNIZED_ROLES } = require('../services/auth.service');

const { UserError } = userService;

// Campos de texto del formulario de Configuración de perfil; el servicio valida su contenido.
const PROFILE_TEXT_FIELDS = ['firstName', 'lastName', 'dni', 'email', 'birthDate', 'newPassword', 'repeatPassword'];

// Un objeto con todos los campos de texto como strings, `image` (los bytes de la foto) Uint8Array o
// null y `removeImage` booleano. Si trae otros campos (un rol, un estado), el servicio no los usa.
function isProfileData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    PROFILE_TEXT_FIELDS.every((field) => typeof value[field] === 'string') &&
    (value.image === null || value.image instanceof Uint8Array) &&
    typeof value.removeImage === 'boolean'
  );
}

// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en la consola.
async function getProfile(currentUser) {
  try {
    return { ok: true, profile: await userService.getProfile(currentUser) };
  } catch (error) {
    if (error instanceof UserError) {
      return failure(error.code, error.message);
    }
    console.error('Error al obtener el perfil:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar tus datos. Intentá nuevamente.');
  }
}

// Nunca rechaza, como getProfile. Los errores previstos pueden traer fieldErrors. No registra
// `data`: puede traer una contraseña en texto plano y los bytes de una foto.
async function updateProfile(currentUser, data) {
  if (!isProfileData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return { ok: true, profile: await userService.updateProfile(currentUser, data) };
  } catch (error) {
    if (error instanceof UserError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al guardar el perfil:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron guardar los cambios. Intentá nuevamente.');
  }
}

// Cada usuario opera solo sobre su propia cuenta, la de la sesión: ningún canal recibe un id.
// Sin sesión o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED o
// ACCOUNT_SUSPENDED sin llamar a la acción.
function registerProfileHandlers(browserWindow) {
  handleProtected(browserWindow, 'profile:get', RECOGNIZED_ROLES, getProfile);
  handleProtected(browserWindow, 'profile:update', RECOGNIZED_ROLES, updateProfile);
}

module.exports = { registerProfileHandlers };
