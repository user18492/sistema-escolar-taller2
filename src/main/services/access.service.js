const sessionService = require('./session.service');
const userRepository = require('../repositories/user.repository');

// Única comprobación de sesión y rol del proceso principal. La usan las vistas (navigation-guard.js)
// y las operaciones IPC protegidas (ipc/protected-handler.js). El menú lateral solo muestra las
// opciones del rol: no autoriza nada.
// La sesión vive en memoria y no se entera de una suspensión ni de una baja hechas desde otra PC:
// por eso la cuenta se vuelve a consultar en la base con cada operación protegida y con cada vista.

// Error previsto, con un mensaje apto para la UI (como AuthenticationError en auth.service.js).
class AccessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
  }
}

function unauthenticatedError() {
  return new AccessError('UNAUTHENTICATED', 'Tu sesión finalizó. Iniciá sesión nuevamente.');
}

// `allowedRoles` son valores de usuario_roles.nombre (ADMIN, SECRETARIO, PROFESOR).
function hasRole(allowedRoles) {
  const user = sessionService.getCurrentUser();
  return user !== null && allowedRoles.includes(user.role);
}

// Si la cuenta de la sesión fue suspendida o dada de baja (un dado de baja también queda
// suspendido), cierra la sesión y devuelve true: quien llama vuelve al login. Devuelve false si no
// había nada que cerrar: no hay sesión, la cuenta sigue activa o la sesión cambió durante la consulta.
async function closeSessionIfSuspended() {
  const user = sessionService.getCurrentUser();
  if (!user) return false;
  if (await userRepository.existsActive(user.id)) return false;
  if (sessionService.getCurrentUser() !== user) return false;

  sessionService.logout();
  return true;
}

// Devuelve el usuario de la sesión. Lanza un AccessError UNAUTHENTICATED si no hay sesión iniciada,
// FORBIDDEN si el rol del usuario no está en `allowedRoles` y ACCOUNT_SUSPENDED si su cuenta fue
// suspendida o dada de baja: en ese caso la sesión ya quedó cerrada.
async function requireRole(allowedRoles) {
  const user = sessionService.getCurrentUser();
  if (!user) {
    throw unauthenticatedError();
  }
  if (!allowedRoles.includes(user.role)) {
    throw new AccessError('FORBIDDEN', 'No tenés permiso para realizar esta operación.');
  }
  if (await closeSessionIfSuspended()) {
    throw new AccessError('ACCOUNT_SUSPENDED', 'Tu cuenta fue suspendida. Contactá al administrador.');
  }
  // La sesión terminó o pasó a ser de otra cuenta mientras se consultaba la base.
  if (sessionService.getCurrentUser() !== user) {
    throw unauthenticatedError();
  }
  return user;
}

module.exports = { hasRole, requireRole, closeSessionIfSuspended, AccessError };
