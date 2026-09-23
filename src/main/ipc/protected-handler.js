const { handleTrusted } = require('./trusted-sender');
const { failure } = require('./ipc-response');
const { requireRole, AccessError } = require('../services/access.service');

// Registra una operación protegida: solo se ejecuta con una sesión iniciada y un rol de `allowedRoles`
// (valores de usuario_roles.nombre), sin importar qué opciones muestre el menú de la vista.
// `action` recibe el usuario de la sesión seguido de los argumentos enviados por el renderer.
// Si se rechaza el acceso, resuelve { ok: false, error: { code, message } } sin ejecutar `action`.
function handleProtected(browserWindow, channel, allowedRoles, action) {
  handleTrusted(browserWindow, channel, (...args) => {
    let user;
    try {
      user = requireRole(allowedRoles);
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      return failure(error.code, error.message);
    }
    return action(user, ...args);
  });
}

module.exports = { handleProtected };
