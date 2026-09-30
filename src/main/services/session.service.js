const { authenticate, AuthenticationError } = require('./auth.service');

// La sesión vive en memoria del proceso principal: se mantiene al navegar entre vistas y al ocultar
// la ventana en la bandeja, y termina con logout() o al salir de la aplicación, cuando el proceso finaliza.
let currentUser = null;

// Cambia en cada login y logout: un login que termina después de otra operación de sesión se descarta.
let sessionVersion = 0;

// Un intento de login cierra la sesión anterior aunque falle, para no dejar autenticado a otro usuario.
async function login(credentials) {
  const version = ++sessionVersion;
  currentUser = null;

  const user = await authenticate(credentials);
  if (version !== sessionVersion) {
    throw new AuthenticationError('LOGIN_CANCELLED', 'Se canceló el inicio de sesión. Intentá nuevamente.');
  }

  currentUser = Object.freeze(user);
  return currentUser;
}

// Devuelve null si no hay sesión iniciada.
function getCurrentUser() {
  return currentUser;
}

function logout() {
  sessionVersion += 1;
  currentUser = null;
}

module.exports = { login, getCurrentUser, logout };
