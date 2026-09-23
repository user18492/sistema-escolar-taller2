const { handleTrusted } = require('./trusted-sender');
const { failure } = require('./ipc-response');
const sessionService = require('../services/session.service');
const rememberedAccountService = require('../services/remembered-account.service');
const { AuthenticationError } = require('../services/auth.service');

// Solo lo que muestra la interfaz: los ids y el email quedan en la sesión del proceso principal.
function toSessionUser(user) {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    imageUrl: user.imageUrl,
    institutionName: user.institutionName,
  };
}

function isLoginPayload(payload) {
  return payload !== null
    && typeof payload === 'object'
    && typeof payload.email === 'string'
    && typeof payload.password === 'string'
    && (payload.rememberAccount === undefined || typeof payload.rememberAccount === 'boolean');
}

// Se aplica solo después de un acceso exitoso y nunca lo impide: si falla, el detalle queda en la consola.
async function updateRememberedAccount(rememberAccount, email) {
  try {
    if (rememberAccount) await rememberedAccountService.rememberEmail(email);
    else await rememberedAccountService.forgetEmail();
  } catch (error) {
    console.error('Error al actualizar la cuenta recordada:', error);
  }
}

// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en la consola.
async function login(payload) {
  if (!isLoginPayload(payload)) {
    return failure('INVALID_INPUT', 'Datos de inicio de sesión inválidos.');
  }

  let user;
  try {
    user = await sessionService.login({ email: payload.email, password: payload.password });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return failure(error.code, error.message);
    }
    console.error('Error al iniciar sesión:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo iniciar sesión. Intentá nuevamente.');
  }

  await updateRememberedAccount(payload.rememberAccount === true, user.email);
  return { ok: true, user: toSessionUser(user) };
}

// Nunca rechaza: si no se puede leer la preferencia, el login se muestra como sin cuenta recordada.
async function getRememberedEmail() {
  try {
    return await rememberedAccountService.getRememberedEmail();
  } catch (error) {
    console.error('Error al leer la cuenta recordada:', error);
    return null;
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
  handleTrusted(browserWindow, 'auth:get-remembered-email', getRememberedEmail);
  handleTrusted(browserWindow, 'auth:forget-remembered-email', () => rememberedAccountService.forgetEmail());
}

module.exports = { registerAuthHandlers };
