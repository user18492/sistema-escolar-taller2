const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const userService = require('../services/user.service');

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listUsers(currentUser) {
  try {
    return { ok: true, users: await userService.listUsers(currentUser) };
  } catch (error) {
    console.error('Error al listar los usuarios:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudieron cargar los usuarios. Intentá nuevamente.');
  }
}

// Sin sesión o con otro rol, handleProtected responde UNAUTHENTICATED o FORBIDDEN sin llamar a la acción.
function registerUserHandlers(browserWindow) {
  handleProtected(browserWindow, 'users:list', ['ADMIN'], listUsers);
}

module.exports = { registerUserHandlers };
