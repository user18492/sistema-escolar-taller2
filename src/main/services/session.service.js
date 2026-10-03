const { authenticate, AuthenticationError } = require('./auth.service');

// La sesión vive en memoria del proceso principal: se mantiene al navegar entre vistas y al ocultar
// la ventana en la bandeja, y termina con logout() o al salir de la aplicación, cuando el proceso finaliza.
let currentUser = null;

// Cuentas de quien pertenece a varias instituciones, con las credenciales ya verificadas, mientras
// elige con cuál ingresar: todavía no hay sesión. null si no hay un login a la espera de esa elección.
let pendingAccounts = null;

// Cambia en cada login y logout: un login que termina después de otra operación de sesión se descarta.
let sessionVersion = 0;

// Un intento de login cierra la sesión anterior aunque falle, para no dejar autenticado a otro usuario.
// Devuelve { user } si la sesión quedó iniciada, o { pendingAccounts } si las credenciales permiten
// ingresar a varias instituciones: la sesión se inicia recién con selectInstitution.
async function login(credentials) {
  const version = ++sessionVersion;
  currentUser = null;
  pendingAccounts = null;

  const accounts = await authenticate(credentials);
  if (version !== sessionVersion) {
    throw new AuthenticationError('LOGIN_CANCELLED', 'Se canceló el inicio de sesión. Intentá nuevamente.');
  }

  if (accounts.length > 1) {
    pendingAccounts = accounts.map((account) => Object.freeze(account));
    return { pendingAccounts };
  }

  currentUser = Object.freeze(accounts[0]);
  return { user: currentUser };
}

// Inicia la sesión con la cuenta de esa institución, que tiene que ser una de las que dejó pendientes
// el último login. Si no lo es, o ya no hay un login pendiente, lanza un AuthenticationError
// (NO_PENDING_LOGIN).
function selectInstitution(institutionId) {
  const account = pendingAccounts?.find((pendingAccount) => pendingAccount.institutionId === institutionId);
  if (!account) {
    throw new AuthenticationError('NO_PENDING_LOGIN', 'La selección ya no está disponible. Iniciá sesión nuevamente.');
  }

  pendingAccounts = null;
  currentUser = account;
  return currentUser;
}

// Devuelve null si no hay sesión iniciada.
function getCurrentUser() {
  return currentUser;
}

// También descarta un login que quedó a la espera de elegir la institución.
function logout() {
  sessionVersion += 1;
  currentUser = null;
  pendingAccounts = null;
}

module.exports = { login, selectInstitution, getCurrentUser, logout };
