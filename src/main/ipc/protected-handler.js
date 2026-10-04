const { handleTrusted } = require('./trusted-sender');
const { failure } = require('./ipc-response');
const { requireRole, AccessError } = require('../services/access.service');
const { showSuspendedLogin } = require('../navigation-guard');

// Registra una operación protegida: solo se ejecuta con una sesión iniciada, un rol de `allowedRoles`
// (valores de usuario_roles.nombre) y la cuenta todavía activa en la base, sin importar qué opciones
// muestre el menú de la vista.
// `action` recibe el usuario de la sesión seguido de los argumentos enviados por el renderer.
// Si se rechaza el acceso, resuelve { ok: false, error: { code, message } } sin ejecutar `action`.
// Nunca rechaza: si no se puede consultar la cuenta, responde UNEXPECTED_ERROR con el detalle en la consola.
function handleProtected(browserWindow, channel, allowedRoles, action) {
  handleTrusted(browserWindow, channel, async (...args) => {
    let user;
    try {
      user = await requireRole(allowedRoles);
    } catch (error) {
      if (error instanceof AccessError) {
        // La sesión ya quedó cerrada: la ventana vuelve al login, que avisa el motivo.
        if (error.code === 'ACCOUNT_SUSPENDED') showSuspendedLogin(browserWindow);
        return failure(error.code, error.message);
      }
      console.error('Error al comprobar la cuenta de la sesión:', error);
      return failure('UNEXPECTED_ERROR', 'No se pudo completar la operación. Intentá nuevamente.');
    }
    return action(user, ...args);
  });
}

module.exports = { handleProtected };
