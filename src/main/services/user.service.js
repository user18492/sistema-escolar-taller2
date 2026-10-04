const userRepository = require('../repositories/user.repository');
const { normalizeEmail, isValidEmail, RECOGNIZED_ROLES } = require('./auth.service');
const { isValidPassword, hashPassword } = require('./password.service');
const profileImageService = require('./profile-image.service');

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

// Largo de las columnas usuario.nombre y usuario.apellido.
const NAME_MAX_LENGTH = 100;
const LETTERS = 'A-Za-zÀ-ÖØ-öø-ÿ';
const PERSON_NAME_PATTERN = new RegExp(`^[${LETTERS}]+([ '-][${LETTERS}]+)*$`);
const NOT_PERSON_NAME_CHAR = new RegExp(`[^${LETTERS} '-]`);

const BIRTH_DATE_MIN_AGE = 18;
const BIRTH_DATE_MAX_AGE = 80;

// Al editar, el propio usuario no cuenta como duplicado: el que ya tiene el dato es "otro".
const DUPLICATE_MESSAGES = {
  create: {
    message: 'Ya existe un usuario con estos datos.',
    dni: 'Ya existe un usuario con este DNI.',
    email: 'Ya existe un usuario con este email.',
  },
  update: {
    message: 'Ya existe otro usuario con estos datos.',
    dni: 'Ya existe otro usuario con este DNI.',
    email: 'Ya existe otro usuario con este email.',
  },
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

// Recibe solo los dígitos, como se guarda en usuario.dni.
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

// Cambio de foto de perfil de `data` (el controlador ya verificó que `image` sea un Uint8Array o
// null y `removeImage` un booleano). Devuelve { jpeg, removeImage }: jpeg es la foto nueva, lista
// para guardar, o null si no hay una. Lanza un UserError INVALID_INPUT, sin fieldErrors como el rol y
// la contraseña, si la imagen no es válida o si piden a la vez una foto nueva y quitar la actual.
function parseImageChange(data) {
  const invalidImageError = () =>
    new UserError('INVALID_INPUT', 'La foto de perfil no es válida. Elegí otra imagen.');

  if (data.image === null) return { jpeg: null, removeImage: data.removeImage };
  if (data.removeImage) throw invalidImageError();

  const jpeg = profileImageService.prepareImage(data.image);
  if (!jpeg) throw invalidImageError();
  return { jpeg, removeImage: false };
}

// `operation` es 'create' o 'update'.
function duplicateError(fields, operation) {
  const messages = DUPLICATE_MESSAGES[operation];
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, messages[field]]));
  return new UserError('DUPLICATE_VALUE', messages.message, fieldErrors);
}

// Lanza un UserError DUPLICATE_VALUE si el dni o el email de `values` ya son de un usuario de la
// institución distinto de `excludedUserId` (null en un alta). Los de otra institución no cuentan:
// quien pertenece a varias tiene una cuenta en cada una, con el mismo dni y el mismo email.
async function assertNotTaken(institutionId, values, excludedUserId, operation) {
  const takenFields = await userRepository.findTakenFields(institutionId, values, excludedUserId);
  if (takenFields.length > 0) throw duplicateError(takenFields, operation);
}

// Ejecuta `save` (el INSERT o el UPDATE). Si otro usuario tomó el dni o el email entre la
// comprobación y el guardado, la restricción UNIQUE de la base lo rechaza y se informa como
// duplicado.
async function saveUnique(save, operation) {
  try {
    return await save();
  } catch (error) {
    const field = userRepository.duplicateFieldOf(error);
    if (!field) throw error;
    throw duplicateError([field], operation);
  }
}

// Guarda el archivo de `jpeg` (si hay una foto nueva) y llama a `save` (el INSERT o el UPDATE) con su
// nombre, o con null. Si `save` falla o devuelve null (el usuario ya no existe), el archivo se borra:
// la base no lo usa. Devuelve lo mismo que `save`.
async function saveWithImage(jpeg, save) {
  const imageFileName = jpeg ? await profileImageService.storeImage(jpeg) : null;
  let result;
  try {
    result = await save(imageFileName);
  } catch (error) {
    await profileImageService.discardImage(imageFileName);
    throw error;
  }
  if (result === null) await profileImageService.discardImage(imageFileName);
  return result;
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
// y el modal de edición, y el id para identificar la fila. `role` es el valor de usuario_rol.nombre,
// `imageUrl` la URL de su foto (null si no tiene) y `deletedAt` el instante de su baja en ISO 8601
// (null si está vigente, también cuando la consulta no trae la columna: el alta y la edición solo
// devuelven usuarios vigentes).
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
    imageUrl: profileImageService.toImageUrl(user.imageFileName),
    deletedAt: user.deletedAt instanceof Date ? user.deletedAt.toISOString() : null,
  };
}

// Usuarios de la institución de `currentUser` (el de la sesión), vigentes y dados de baja, sin él
// mismo.
async function listUsers(currentUser) {
  const users = await userRepository.findByInstitution(currentUser.institutionId, currentUser.id);
  return users.map(toListedUser);
}

// Baja lógica de un usuario de la institución de `currentUser`: la fila queda con su fecha de baja y
// suspendida, pasa a listarse como dada de baja y no puede iniciar sesión. Devuelve al usuario como
// quedó, con los campos de listUsers. Lanza un UserError si es el propio usuario de la sesión
// (CANNOT_DELETE_SELF), si no existe en la institución (USER_NOT_FOUND) o si ya estaba dado de baja
// (USER_ALREADY_DELETED).
async function deleteUser(currentUser, userId) {
  // La tabla no ofrece al usuario de la sesión, pero el id llega del renderer: se vuelve a comprobar.
  if (userId === currentUser.id) {
    throw new UserError('CANNOT_DELETE_SELF', 'No podés eliminar tu propia cuenta.');
  }
  const deletedUser = await userRepository.markAsDeleted(userId, currentUser.institutionId);
  if (deletedUser) return toListedUser(deletedUser);

  // No se marcó: si existe en la institución es porque ya estaba dado de baja.
  if (await userRepository.existsInInstitution(userId, currentUser.institutionId)) {
    throw new UserError('USER_ALREADY_DELETED', 'El usuario ya había sido eliminado.');
  }
  throw userNotFoundError();
}

// Guarda los datos de un usuario vigente de la institución de `currentUser` y lo devuelve como
// quedó, con los campos de listUsers. `data` trae firstName, lastName, dni, email, birthDate
// ('AAAA-MM-DD'), role, isActive (false lo suspende: sigue en el listado, pero no puede iniciar
// sesión), password (una contraseña nueva, o null para conservar la actual), image (el PNG del
// recorte de una foto nueva, o null para no cambiarla) y removeImage (true quita la foto).
// La foto anterior se borra recién cuando la base confirma el cambio.
// Lanza un UserError si es el propio usuario de la sesión (CANNOT_EDIT_SELF), si algún dato no es
// válido (INVALID_INPUT), si el usuario no existe en la institución o fue dado de baja
// (USER_NOT_FOUND) o si el dni o el email ya son de otro usuario de la institución, aunque esté dado
// de baja (DUPLICATE_VALUE, con fieldErrors).
async function updateUser(currentUser, userId, data) {
  // La tabla no ofrece al usuario de la sesión, pero el id llega del renderer: se vuelve a comprobar.
  // Su sesión guarda sus datos en memoria y no se actualizaría.
  if (userId === currentUser.id) {
    throw new UserError('CANNOT_EDIT_SELF', 'No podés editar tu propia cuenta desde esta vista.');
  }
  const values = parseUserData(data);
  const { jpeg, removeImage } = parseImageChange(data);

  if (!(await userRepository.existsNotDeleted(userId, currentUser.institutionId))) {
    throw userNotFoundError();
  }
  // Excluye al propio usuario: conservar su dni o su email no es un duplicado.
  await assertNotTaken(currentUser.institutionId, values, userId, 'update');

  const passwordHash = data.password === null ? null : await hashPassword(data.password);
  const setImage = Boolean(jpeg) || removeImage;
  const result = await saveWithImage(jpeg, (imageFileName) => saveUnique(
    () => userRepository.update(userId, currentUser.institutionId, {
      ...values,
      isActive: data.isActive,
      passwordHash,
      setImage,
      imageFileName,
    }),
    'update'
  ));
  // Se dio de baja entre la comprobación y el guardado.
  if (!result) throw userNotFoundError();
  if (setImage) await profileImageService.discardImage(result.previousImageFileName);
  return toListedUser(result.user);
}

// Crea un usuario en la institución de `currentUser`, siempre activo, y lo devuelve con los campos
// de listUsers. `data` trae los mismos campos que en updateUser, sin isActive (si llega, no se usa)
// y con `password` obligatoria: llega en texto plano y solo se guarda su hash. `image` null crea al
// usuario sin foto; `removeImage` no quita nada, pero tampoco puede venir en true junto con una
// foto. Lanza un UserError si algún dato no es válido o falta la contraseña (INVALID_INPUT) o si el
// dni o el email ya son de otro usuario de la institución, aunque esté dado de baja
// (DUPLICATE_VALUE, con fieldErrors).
async function createUser(currentUser, data) {
  const values = parseUserData(data);
  // parseUserData acepta null porque al editar conserva la contraseña actual; un alta la necesita.
  if (data.password === null) {
    throw new UserError('INVALID_INPUT', 'Falta la contraseña del usuario.');
  }
  const { jpeg } = parseImageChange(data);
  await assertNotTaken(currentUser.institutionId, values, null, 'create');

  const passwordHash = await hashPassword(data.password);
  const user = await saveWithImage(jpeg, (imageFileName) => saveUnique(
    () => userRepository.create(currentUser.institutionId, { ...values, passwordHash, imageFileName }),
    'create'
  ));
  return toListedUser(user);
}

module.exports = { listUsers, deleteUser, updateUser, createUser, UserError };
