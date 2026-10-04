const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const userService = require('../services/user.service');

const { UserError } = userService;

// Rango de usuario.usuario_id (INT): fuera de él, PostgreSQL rechazaría el parámetro.
const MAX_USER_ID = 2 ** 31 - 1;

function isUserId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_USER_ID;
}

// Campos de texto del formulario de usuario; el servicio valida su contenido.
const USER_TEXT_FIELDS = ['firstName', 'lastName', 'dni', 'email', 'birthDate', 'role'];

// Un objeto con todos los campos de texto como strings, `password` string o null, `image` (los bytes
// de la foto) Uint8Array o null y `removeImage` booleano. Si trae otros campos, el servicio no los usa.
function isUserData(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    USER_TEXT_FIELDS.every((field) => typeof value[field] === 'string') &&
    (value.password === null || typeof value.password === 'string') &&
    (value.image === null || value.image instanceof Uint8Array) &&
    typeof value.removeImage === 'boolean'
  );
}

// Al editar llega además `isActive` (booleano): el estado no se elige en el alta, que siempre crea
// al usuario activo.
function isUserUpdateData(value) {
  return isUserData(value) && typeof value.isActive === 'boolean';
}

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listUsers(currentUser) {
  try {
    return { ok: true, users: await userService.listUsers(currentUser) };
  } catch (error) {
    console.error('Error al listar los usuarios:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los usuarios. Intentá nuevamente.');
  }
}

// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en la consola.
async function deleteUser(currentUser, userId) {
  if (!isUserId(userId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar al usuario.');
  }
  try {
    return { ok: true, user: await userService.deleteUser(currentUser, userId) };
  } catch (error) {
    if (error instanceof UserError) {
      return failure(error.code, error.message);
    }
    console.error('Error al eliminar el usuario:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo eliminar el usuario. Intentá nuevamente.');
  }
}

// Nunca rechaza, como deleteUser. Los errores previstos pueden traer fieldErrors. No registra
// `data`: puede traer una contraseña en texto plano y los bytes de una foto.
async function updateUser(currentUser, userId, data) {
  if (!isUserId(userId)) {
    return failure('INVALID_INPUT', 'No se pudo identificar al usuario.');
  }
  if (!isUserUpdateData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return { ok: true, user: await userService.updateUser(currentUser, userId, data) };
  } catch (error) {
    if (error instanceof UserError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al guardar el usuario:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron guardar los cambios. Intentá nuevamente.');
  }
}

// Nunca rechaza, como updateUser, y tampoco registra `data`: trae la contraseña en texto plano y
// puede traer los bytes de una foto. Que la contraseña no sea null lo comprueba el servicio.
async function createUser(currentUser, data) {
  if (!isUserData(data)) {
    return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
  }
  try {
    return { ok: true, user: await userService.createUser(currentUser, data) };
  } catch (error) {
    if (error instanceof UserError) {
      return failure(error.code, error.message, error.fieldErrors);
    }
    console.error('Error al crear el usuario:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo crear el usuario. Intentá nuevamente.');
  }
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerUserHandlers(browserWindow) {
  handleProtected(browserWindow, 'users:list', ['ADMIN'], listUsers);
  handleProtected(browserWindow, 'users:create', ['ADMIN'], createUser);
  handleProtected(browserWindow, 'users:update', ['ADMIN'], updateUser);
  handleProtected(browserWindow, 'users:delete', ['ADMIN'], deleteUser);
}

module.exports = { registerUserHandlers };
