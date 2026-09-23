const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const userService = require('../services/user.service');

const { UserError } = userService;

// Rango de usuarios.usuario_id (SERIAL): fuera de él, PostgreSQL rechazaría el parámetro.
const MAX_USER_ID = 2 ** 31 - 1;

function isUserId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_USER_ID;
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
    await userService.deleteUser(currentUser, userId);
    return { ok: true };
  } catch (error) {
    if (error instanceof UserError) {
      return failure(error.code, error.message);
    }
    console.error('Error al eliminar el usuario:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo eliminar el usuario. Intentá nuevamente.');
  }
}

// Sin sesión o con otro rol, handleProtected responde UNAUTHENTICATED o FORBIDDEN sin llamar a la acción.
function registerUserHandlers(browserWindow) {
  handleProtected(browserWindow, 'users:list', ['ADMIN'], listUsers);
  handleProtected(browserWindow, 'users:delete', ['ADMIN'], deleteUser);
}

module.exports = { registerUserHandlers };
