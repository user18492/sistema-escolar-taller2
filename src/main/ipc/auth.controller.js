const { handleTrusted } = require('./trusted-sender');
const { failure } = require('./ipc-response');
const sessionService = require('../services/session.service');
const rememberedAccountService = require('../services/remembered-account.service');
const { AuthenticationError } = require('../services/auth.service');
const { toImageUrl } = require('../services/profile-image.service');

// Solo lo que muestra la interfaz: los ids y el email quedan en la sesión del proceso principal, y
// la foto sale como URL del protocolo profile-image (o null), nunca como nombre de archivo.
function toSessionUser(user) {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    imageUrl: toImageUrl(user.imageFileName),
    institutionName: user.institutionName,
  };
}

// Opción del selector de instituciones: el id identifica la elección y el rol es el de la cuenta del
// usuario en esa institución.
function toInstitutionOption(account) {
  return {
    id: account.institutionId,
    name: account.institutionName,
    role: account.role,
  };
}

function isLoginPayload(payload) {
  return payload !== null
    && typeof payload === 'object'
    && typeof payload.email === 'string'
    && typeof payload.password === 'string'
    && (payload.rememberAccount === undefined || typeof payload.rememberAccount === 'boolean');
}

function isSelectInstitutionPayload(payload) {
  return payload !== null
    && typeof payload === 'object'
    && Number.isInteger(payload.institutionId)
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
// Si las credenciales permiten ingresar a varias instituciones, responde con ellas en lugar del usuario:
// la sesión se inicia con selectInstitution.
async function login(payload) {
  if (!isLoginPayload(payload)) {
    return failure('INVALID_INPUT', 'Datos de inicio de sesión inválidos.');
  }

  let result;
  try {
    result = await sessionService.login({ email: payload.email, password: payload.password });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return failure(error.code, error.message);
    }
    console.error('Error al iniciar sesión:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo iniciar sesión. Intentá nuevamente.');
  }

  // Todavía no hubo acceso: la cuenta recordada se actualiza al elegir la institución.
  if (result.pendingAccounts) {
    return { ok: true, institutions: result.pendingAccounts.map(toInstitutionOption) };
  }

  await updateRememberedAccount(payload.rememberAccount === true, result.user.email);
  return { ok: true, user: toSessionUser(result.user) };
}

// Segundo paso del login de quien pertenece a varias instituciones. Nunca rechaza, como login.
async function selectInstitution(payload) {
  if (!isSelectInstitutionPayload(payload)) {
    return failure('INVALID_INPUT', 'Datos de selección de institución inválidos.');
  }

  let user;
  try {
    user = sessionService.selectInstitution(payload.institutionId);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return failure(error.code, error.message);
    }
    console.error('Error al elegir la institución:', error);
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
  handleTrusted(browserWindow, 'auth:select-institution', selectInstitution);
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
