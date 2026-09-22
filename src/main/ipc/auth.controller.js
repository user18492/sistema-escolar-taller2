const { handleTrusted } = require('./trusted-sender');
const sessionService = require('../services/session.service');
const { AuthenticationError } = require('../services/auth.service');

// Solo lo que muestra la interfaz: el id y la institución quedan en la sesión del proceso principal.
function toSessionUser(user) {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    imageUrl: user.imageUrl,
  };
}

function isCredentialsPayload(payload) {
  return payload !== null
    && typeof payload === 'object'
    && typeof payload.email === 'string'
    && typeof payload.password === 'string';
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en la consola.
async function login(payload) {
  if (!isCredentialsPayload(payload)) {
    return failure('INVALID_INPUT', 'Datos de inicio de sesión inválidos.');
  }

  try {
    const user = await sessionService.login({ email: payload.email, password: payload.password });
    return { ok: true, user: toSessionUser(user) };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return failure(error.code, error.message);
    }
    console.error('Error al iniciar sesión:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo iniciar sesión. Intentá nuevamente.');
  }
}

function registerAuthHandlers(browserWindow) {
  handleTrusted(browserWindow, 'auth:login', login);
  handleTrusted(browserWindow, 'auth:get-current-user', () => {
    const user = sessionService.getCurrentUser();
    return user ? toSessionUser(user) : null;
  });
  handleTrusted(browserWindow, 'auth:logout', () => {
    sessionService.logout();
  });
}

module.exports = { registerAuthHandlers };
