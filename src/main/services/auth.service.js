const bcrypt = require('bcrypt');
const userRepository = require('../repositories/user.repository');

// Valores de usuario_rol.nombre con acceso al sistema.
const RECOGNIZED_ROLES = ['ADMIN', 'SECRETARIO', 'PROFESOR'];

// Mismo largo que la columna usuario.email.
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hash bcrypt (costo 10, como los de la base) de un texto descartable. Si el email no existe, se compara
// igual contra este hash para que la respuesta tarde lo mismo y no revele qué emails están registrados.
const DUMMY_PASSWORD_HASH = '$2b$10$UHDxLH/S1eqeU.9FZBVWr..jD7hpzh5KwSGtcClcMWVcHcUEspdl.';

// Único mensaje para email inexistente y contraseña incorrecta.
const INVALID_CREDENTIALS_MESSAGE = 'Email o contraseña incorrectos.';

// Error previsto, con un mensaje apto para la UI. La clase y el código propio lo distinguen
// de los errores de PostgreSQL (ECONNREFUSED, 28P01…), cuyo detalle no debe llegar a la interfaz.
class AuthenticationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

// Solo el email se normaliza: la contraseña se compara tal cual llega, con sus espacios y mayúsculas.
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// Recibe un email ya normalizado.
function isValidEmail(email) {
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);
}

function validateCredentials(email, password) {
  if (!email) {
    throw new AuthenticationError('INVALID_INPUT', 'Ingresá tu email.');
  }
  if (!isValidEmail(email)) {
    throw new AuthenticationError('INVALID_INPUT', 'Ingresá un email válido.');
  }
  if (typeof password !== 'string' || password === '') {
    throw new AuthenticationError('INVALID_INPUT', 'Ingresá tu contraseña.');
  }
}

// Lista explícita de campos: passwordHash, y cualquier campo que se agregue a User, no sale del proceso principal.
function toPublicUser(user) {
  return {
    id: user.id,
    role: user.role,
    institutionId: user.institutionId,
    institutionName: user.institutionName,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    imageFileName: user.imageFileName,
  };
}

// Devuelve, sin datos sensibles, las cuentas con las que esas credenciales permiten ingresar: una por
// institución, ordenadas por el nombre de la institución. Quien pertenece a varias instituciones tiene
// una cuenta en cada una, con el mismo email y su propia contraseña: cuentan solo las cuentas en las que
// la contraseña coincide y que están habilitadas (activas y con un rol reconocido). Si ninguna permite el
// acceso, lanza un AuthenticationError (INVALID_INPUT, INVALID_CREDENTIALS, INACTIVE_USER, UNRECOGNIZED_ROLE).
async function authenticate(credentials) {
  const { email, password } = credentials ?? {};
  const normalizedEmail = normalizeEmail(email);
  validateCredentials(normalizedEmail, password);

  const accounts = await userRepository.findAllByEmail(normalizedEmail);

  // Sin cuentas se compara igual, contra el hash descartable. Las comparaciones corren a la vez (bcrypt
  // las reparte en hilos), para que la respuesta no demore más por cada institución del email.
  const passwordHashes = accounts.length > 0 ? accounts.map((account) => account.passwordHash) : [DUMMY_PASSWORD_HASH];
  const matches = await Promise.all(passwordHashes.map((passwordHash) => bcrypt.compare(password, passwordHash)));
  const matchingAccounts = accounts.filter((_account, index) => matches[index]);
  if (matchingAccounts.length === 0) {
    throw new AuthenticationError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
  }

  // El estado de las cuentas se informa recién con la contraseña verificada, y solo si ninguna permite
  // ingresar: una cuenta suspendida no impide el acceso con las de otras instituciones.
  const enabledAccounts = matchingAccounts.filter((account) => account.isActive && RECOGNIZED_ROLES.includes(account.role));
  if (enabledAccounts.length === 0) {
    if (matchingAccounts.some((account) => !account.isActive)) {
      throw new AuthenticationError('INACTIVE_USER', 'Tu cuenta está suspendida. Contactá al administrador.');
    }
    throw new AuthenticationError('UNRECOGNIZED_ROLE', 'Tu cuenta no tiene un rol habilitado. Contactá al administrador.');
  }

  return enabledAccounts.map(toPublicUser);
}

module.exports = { authenticate, normalizeEmail, isValidEmail, RECOGNIZED_ROLES, AuthenticationError };
