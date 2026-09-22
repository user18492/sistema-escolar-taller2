const sessionService = require('./session.service');

// Única comprobación de sesión y rol del proceso principal. La usan las vistas (navigation-guard.js)
// y las operaciones IPC protegidas (ipc/protected-handler.js). El menú lateral solo muestra las
// opciones del rol: no autoriza nada.

// Error previsto, con un mensaje apto para la UI (como AuthenticationError en auth.service.js).
class AccessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
  }
}

// `allowedRoles` son valores de usuario_roles.nombre (ADMIN, SECRETARIO, PROFESOR).
function hasRole(allowedRoles) {
  const user = sessionService.getCurrentUser();
  return user !== null && allowedRoles.includes(user.role);
}

// Devuelve el usuario de la sesión. Lanza un AccessError UNAUTHENTICATED si no hay sesión iniciada
// y FORBIDDEN si el rol del usuario no está en `allowedRoles`.
function requireRole(allowedRoles) {
  const user = sessionService.getCurrentUser();
  if (!user) {
    throw new AccessError('UNAUTHENTICATED', 'Tu sesión finalizó. Iniciá sesión nuevamente.');
  }
  if (!allowedRoles.includes(user.role)) {
    throw new AccessError('FORBIDDEN', 'No tenés permiso para realizar esta operación.');
  }
  return user;
}

module.exports = { hasRole, requireRole, AccessError };
