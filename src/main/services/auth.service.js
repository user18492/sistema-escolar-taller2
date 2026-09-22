const bcrypt = require('bcrypt');
const userRepository = require('../repositories/user.repository');

// Valores de usuario_roles.nombre con acceso al sistema.
const RECOGNIZED_ROLES = ['ADMIN', 'SECRETARIO', 'PROFESOR'];

// Mismo largo que la columna usuarios.email.
const EMAIL_MAX_LENGTH = 150;
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
    imageUrl: user.imageUrl,
  };
}

// Devuelve el usuario sin datos sensibles. Si las credenciales no permiten el acceso, lanza un AuthenticationError
// (INVALID_INPUT, INVALID_CREDENTIALS, INACTIVE_USER, UNRECOGNIZED_ROLE).
async function authenticate(credentials) {
  const { email, password } = credentials ?? {};
  const normalizedEmail = normalizeEmail(email);
  validateCredentials(normalizedEmail, password);

  const user = await userRepository.findByEmail(normalizedEmail);

  // Se compara aunque el usuario no exista o no tenga contraseña (bcrypt lanza un error con un hash null).
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
  if (!user?.passwordHash || !passwordMatches) {
    throw new AuthenticationError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
  }

  // El estado de la cuenta se informa recién con la contraseña verificada.
  if (!user.isActive) {
    throw new AuthenticationError('INACTIVE_USER', 'Tu cuenta está suspendida. Contactá al administrador.');
  }
  if (!RECOGNIZED_ROLES.includes(user.role)) {
    throw new AuthenticationError('UNRECOGNIZED_ROLE', 'Tu cuenta no tiene un rol habilitado. Contactá al administrador.');
  }

  return toPublicUser(user);
}

module.exports = { authenticate, normalizeEmail, isValidEmail, AuthenticationError };
