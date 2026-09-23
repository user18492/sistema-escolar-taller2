const userRepository = require('../repositories/user.repository');
const { normalizeEmail, isValidEmail, RECOGNIZED_ROLES } = require('./auth.service');
const { isValidPassword, hashPassword } = require('./password.service');

// Error previsto, con un mensaje apto para la UI (como AccessError en access.service.js).
// `fieldErrors` ({ campo: mensaje }), si llega, indica qué campos del formulario están mal.
class UserError extends Error {
  constructor(code, message, fieldErrors) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

// ---------- Validación de los datos del formulario ----------

// Mismas reglas que field-validation.component.js (person-name, dni, email y birth-date) y que los
// data-min-age y data-max-age del modal de usuario, que el proceso principal no puede importar: si
// cambian allá, hay que cambiarlas acá.
const REQUIRED_MESSAGE = 'Campo obligatorio.';

// Largo de las columnas usuarios.nombre y usuarios.apellido.
const NAME_MAX_LENGTH = 100;
const LETTERS = 'A-Za-zÀ-ÖØ-öø-ÿ';
const PERSON_NAME_PATTERN = new RegExp(`^[${LETTERS}]+([ '-][${LETTERS}]+)*$`);
const NOT_PERSON_NAME_CHAR = new RegExp(`[^${LETTERS} '-]`);

const BIRTH_DATE_MIN_AGE = 18;
const BIRTH_DATE_MAX_AGE = 80;

const DUPLICATE_MESSAGES = {
  dni: 'Ya existe otro usuario con este DNI.',
  email: 'Ya existe otro usuario con este email.',
};

// Tipográfico → recto, tildes unidas a su letra (NFC) y espacios simples, como al salir del campo.
function normalizeText(value) {
  return value.normalize('NFC').replace(/’/g, "'").trim().replace(/\s+/g, ' ');
}

function checkPersonName(value) {
  if (!value) return REQUIRED_MESSAGE;
  if (value.length > NAME_MAX_LENGTH) return `Máximo ${NAME_MAX_LENGTH} caracteres.`;
  if (NOT_PERSON_NAME_CHAR.test(value)) return 'Solo se admiten letras, espacios, guiones y apóstrofos.';
  return PERSON_NAME_PATTERN.test(value) ? '' : 'Guiones y apóstrofos deben ir entre letras.';
}

// Recibe solo los dígitos, como se guarda en usuarios.dni.
function checkDni(value) {
  if (!value) return REQUIRED_MESSAGE;
  if (!/^\d{7,8}$/.test(value)) return 'El DNI debe tener 7 u 8 dígitos.';
  return value.startsWith('0') ? 'El DNI no puede empezar con 0.' : '';
}

// Recibe el email ya normalizado.
function checkEmail(value) {
  if (!value) return REQUIRED_MESSAGE;
  return isValidEmail(value) ? '' : 'El email no es válido.';
}

function isRealDate(year, month, day) {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// AAAAMMDD como número: compara fechas y calcula edades sin pasar por husos horarios.
function dateKey(year, month, day) {
  return year * 10000 + month * 100 + day;
}

// Recibe 'AAAA-MM-DD'.
function checkBirthDate(value) {
  if (!value) return REQUIRED_MESSAGE;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'La fecha no es válida.';
  const [year, month, day] = match.slice(1).map(Number);
  if (!isRealDate(year, month, day)) return 'La fecha no existe.';

  const today = new Date();
  const birthKey = dateKey(year, month, day);
  const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
  if (birthKey > todayKey) return 'La fecha no puede ser futura.';
  const age = Math.floor((todayKey - birthKey) / 10000);
  if (age < BIRTH_DATE_MIN_AGE || age > BIRTH_DATE_MAX_AGE) {
    return `La edad debe estar entre ${BIRTH_DATE_MIN_AGE} y ${BIRTH_DATE_MAX_AGE} años.`;
  }
  return '';
}

const FIELD_CHECKS = {
  firstName: checkPersonName,
  lastName: checkPersonName,
  dni: checkDni,
  email: checkEmail,
  birthDate: checkBirthDate,
};

// Normaliza los datos del formulario (el controlador ya verificó que sean strings) y devuelve solo
// los campos que se guardan, sin la contraseña. Lanza un UserError INVALID_INPUT: con fieldErrors si
// algún campo no es válido, y sin ellos si no lo son el rol o la contraseña, que no tienen un campo
// de texto donde mostrar el error.
function parseUserData(data) {
  const values = {
    firstName: normalizeText(data.firstName),
    lastName: normalizeText(data.lastName),
    // El formulario muestra el DNI con puntos (35.678.901); la base lo guarda solo con dígitos.
    dni: data.dni.replace(/[.\s]/g, ''),
    email: normalizeEmail(data.email),
    birthDate: data.birthDate.trim(),
    role: data.role,
  };

  const fieldErrors = {};
  Object.entries(FIELD_CHECKS).forEach(([field, check]) => {
    const message = check(values[field]);
    if (message) fieldErrors[field] = message;
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new UserError('INVALID_INPUT', 'Revisá los datos marcados.', fieldErrors);
  }
  if (!RECOGNIZED_ROLES.includes(values.role)) {
    throw new UserError('INVALID_INPUT', 'Elegí un rol válido.');
  }
  if (data.password !== null && !isValidPassword(data.password)) {
    throw new UserError('INVALID_INPUT', 'La contraseña no cumple los requisitos de seguridad.');
  }
  return values;
}

function duplicateError(fields) {
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, DUPLICATE_MESSAGES[field]]));
  return new UserError('DUPLICATE_VALUE', 'Ya existe otro usuario con estos datos.', fieldErrors);
}

function userNotFoundError() {
  return new UserError('USER_NOT_FOUND', 'El usuario ya no existe.');
}

// pg entrega las columnas DATE como un Date a la medianoche local: 'AAAA-MM-DD' se arma con los
// getters locales, porque toISOString pasa a UTC y puede correr el día. null si no hay fecha.
function toIsoDate(date) {
  if (!(date instanceof Date)) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Lista explícita de campos, como toPublicUser (auth.service.js): lo que muestran la tabla de Usuarios
// y el modal de edición, y el id para identificar la fila. `role` es el valor de usuario_roles.nombre.
function toListedUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    dni: user.dni,
    email: user.email,
    birthDate: toIsoDate(user.birthDate),
    isActive: user.isActive,
    role: user.role,
  };
}

// Usuarios de la institución de `currentUser` (el de la sesión), sin él mismo.
async function listUsers(currentUser) {
  const users = await userRepository.findByInstitution(currentUser.institutionId, currentUser.id);
  return users.map(toListedUser);
}

// Baja lógica de un usuario de la institución de `currentUser`: la fila queda con su fecha de baja,
// deja de listarse y no puede iniciar sesión. Lanza un UserError si es el propio usuario de la sesión
// (CANNOT_DELETE_SELF), si no existe en la institución (USER_NOT_FOUND) o si ya estaba dado de baja
// (USER_ALREADY_DELETED).
async function deleteUser(currentUser, userId) {
  // La tabla no ofrece al usuario de la sesión, pero el id llega del renderer: se vuelve a comprobar.
  if (userId === currentUser.id) {
    throw new UserError('CANNOT_DELETE_SELF', 'No podés eliminar tu propia cuenta.');
  }
  if (await userRepository.markAsDeleted(userId, currentUser.institutionId)) return;

  // No se marcó: si existe en la institución es porque ya estaba dado de baja.
  if (await userRepository.existsInInstitution(userId, currentUser.institutionId)) {
    throw new UserError('USER_ALREADY_DELETED', 'El usuario ya había sido eliminado.');
  }
  throw userNotFoundError();
}

// Guarda los datos de un usuario vigente de la institución de `currentUser` y lo devuelve como
// quedó, con los campos de listUsers. `data` trae firstName, lastName, dni, email, birthDate
// ('AAAA-MM-DD'), role y password: una contraseña nueva, o null para conservar la actual.
// Lanza un UserError si es el propio usuario de la sesión (CANNOT_EDIT_SELF), si algún dato no es
// válido (INVALID_INPUT), si el usuario no existe en la institución o fue dado de baja
// (USER_NOT_FOUND) o si el dni o el email ya son de otro usuario (DUPLICATE_VALUE, con fieldErrors).
async function updateUser(currentUser, userId, data) {
  // La tabla no ofrece al usuario de la sesión, pero el id llega del renderer: se vuelve a comprobar.
  // Su sesión guarda sus datos en memoria y no se actualizaría.
  if (userId === currentUser.id) {
    throw new UserError('CANNOT_EDIT_SELF', 'No podés editar tu propia cuenta desde esta vista.');
  }
  const values = parseUserData(data);

  if (!(await userRepository.existsNotDeleted(userId, currentUser.institutionId))) {
    throw userNotFoundError();
  }
  // Excluye al propio usuario: conservar su dni o su email no es un duplicado.
  const takenFields = await userRepository.findTakenFields(values, userId);
  if (takenFields.length > 0) throw duplicateError(takenFields);

  const passwordHash = data.password === null ? null : await hashPassword(data.password);
  let user;
  try {
    user = await userRepository.update(userId, currentUser.institutionId, { ...values, passwordHash });
  } catch (error) {
    // Otro usuario tomó el dni o el email entre la comprobación y el guardado: la restricción
    // UNIQUE de la base lo rechaza.
    const field = userRepository.duplicateFieldOf(error);
    if (!field) throw error;
    throw duplicateError([field]);
  }
  // Se dio de baja entre la comprobación y el guardado.
  if (!user) throw userNotFoundError();
  return toListedUser(user);
}

module.exports = { listUsers, deleteUser, updateUser, UserError };
