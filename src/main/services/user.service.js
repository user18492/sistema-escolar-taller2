const userRepository = require('../repositories/user.repository');
const { normalizeEmail, isValidEmail, RECOGNIZED_ROLES } = require('./auth.service');
const { checkPassword, isValidPassword, hashPassword } = require('./password.service');
const profileImageService = require('./profile-image.service');
const sessionService = require('./session.service');

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

// Mismas reglas que field-validation.component.js (person-name, dni, email, birth-date y
// password-repeat) y que los data-min-age y data-max-age del modal de usuario y de Configuración de
// perfil, que el proceso principal no puede importar: si cambian allá, hay que cambiarlas acá.
const REQUIRED_MESSAGE = 'Campo obligatorio.';
const PASSWORD_MISMATCH_MESSAGE = 'Las contraseñas no coinciden.';

// Largo de las columnas usuario.nombre y usuario.apellido.
const NAME_MAX_LENGTH = 100;
const LETTERS = 'A-Za-zÀ-ÖØ-öø-ÿ';
const PERSON_NAME_PATTERN = new RegExp(`^[${LETTERS}]+([ '-][${LETTERS}]+)*$`);
const NOT_PERSON_NAME_CHAR = new RegExp(`[^${LETTERS} '-]`);

// Edad admitida de un usuario, la de su fecha de nacimiento. La de un alumno es otra:
// student.service.js.
const USER_AGE_RANGE = { minAge: 18, maxAge: 80 };

// Al editar, el propio usuario no cuenta como duplicado: el que ya tiene el dato es "otro". Al
// restaurar no hay formulario donde marcar el campo: el mensaje general dice qué se repite.
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
  restore: {
    message: 'Ya hay un usuario vigente con el mismo DNI o email y el mismo rol.',
    dni: 'Ya hay un usuario vigente con este DNI y el mismo rol.',
    email: 'Ya hay un usuario vigente con este email y el mismo rol.',
  },
};

// Mensajes de las reglas que la base aplica al suspender o dar de baja a un usuario (los triggers de
// usuario, db/schema.sql), según de quién sea la cuenta: `other` es la de otro usuario, que un
// administrador maneja desde Usuarios, y `own`, la del usuario de la sesión.
const DISABLE_MESSAGES = {
  other: {
    lastAdmin: 'Es el único administrador activo. La institución no puede quedarse sin administradores.',
    teacherAssignments:
      'El usuario tiene asignaciones docentes vigentes en el ciclo lectivo actual. ' +
      'Reasignalas a otro profesor o eliminalas en Docencia antes de eliminarlo.',
  },
  own: {
    lastAdmin: 'Sos el único administrador activo. La institución no puede quedarse sin administradores.',
    teacherAssignments:
      'Tenés asignaciones docentes vigentes en el ciclo lectivo actual. ' +
      'Pedile a un administrador que las reasigne o las elimine antes de eliminar tu cuenta.',
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

// Recibe 'AAAA-MM-DD' y la edad admitida ({ minAge, maxAge }).
function checkBirthDate(value, { minAge, maxAge }) {
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
  if (age < minAge || age > maxAge) {
    return `La edad debe estar entre ${minAge} y ${maxAge} años.`;
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

// Normaliza los datos personales del formulario (el controlador ya verificó que sean strings).
// `ageRange` ({ minAge, maxAge }) es la edad admitida: solo la usa checkBirthDate. Devuelve
// { values, fieldErrors }: los campos como se guardan y el mensaje de cada uno que no es válido
// ({ campo: mensaje }, vacío si lo son todos). El alta de alumnos también la usa, con su edad.
function parsePersonalData(data, ageRange) {
  const values = {
    firstName: normalizeText(data.firstName),
    lastName: normalizeText(data.lastName),
    // El formulario muestra el DNI con puntos (35.678.901); la base lo guarda solo con dígitos.
    dni: data.dni.replace(/[.\s]/g, ''),
    email: normalizeEmail(data.email),
    birthDate: data.birthDate.trim(),
  };

  const fieldErrors = {};
  Object.entries(FIELD_CHECKS).forEach(([field, check]) => {
    const message = check(values[field], ageRange);
    if (message) fieldErrors[field] = message;
  });
  return { values, fieldErrors };
}

function invalidFieldsError(fieldErrors) {
  return new UserError('INVALID_INPUT', 'Revisá los datos marcados.', fieldErrors);
}

// Normaliza los datos del formulario de usuario y devuelve solo los campos que se guardan, sin la
// contraseña. `operation` es 'create' o 'update': el rol se elige solo en el alta y no cambia
// después, así que al editar no se lee ni se devuelve. Lanza un UserError INVALID_INPUT: con
// fieldErrors si algún campo no es válido, y sin ellos si no lo son el rol o la contraseña, que no
// tienen un campo de texto donde mostrar el error.
function parseUserData(data, operation) {
  const { values, fieldErrors } = parsePersonalData(data, USER_AGE_RANGE);
  if (Object.keys(fieldErrors).length > 0) {
    throw invalidFieldsError(fieldErrors);
  }
  const isCreating = operation === 'create';
  if (isCreating && !RECOGNIZED_ROLES.includes(data.role)) {
    throw new UserError('INVALID_INPUT', 'Elegí un rol válido.');
  }
  if (data.password !== null && !isValidPassword(data.password)) {
    throw new UserError('INVALID_INPUT', 'La contraseña no cumple los requisitos de seguridad.');
  }
  return isCreating ? { ...values, role: data.role } : values;
}

// Cambio de contraseña del perfil: los dos campos vacíos conservan la actual; con alguno escrito,
// la nueva tiene que cumplir las reglas de password.service.js y repetirse igual. Se comparan tal
// cual llegan, con sus espacios y mayúsculas. Devuelve los fieldErrors de los dos campos.
function checkPasswordChange(newPassword, repeatPassword) {
  const fieldErrors = {};
  if (newPassword === '' && repeatPassword === '') return fieldErrors;

  const newPasswordMessage = newPassword === '' ? REQUIRED_MESSAGE : checkPassword(newPassword);
  if (newPasswordMessage) fieldErrors.newPassword = newPasswordMessage;
  if (repeatPassword === '') fieldErrors.repeatPassword = REQUIRED_MESSAGE;
  else if (repeatPassword !== newPassword) fieldErrors.repeatPassword = PASSWORD_MISMATCH_MESSAGE;
  return fieldErrors;
}

// Normaliza los datos del formulario de Configuración de perfil. Devuelve { values, password }: los
// datos personales como se guardan y la contraseña nueva, o null para conservar la actual. A
// diferencia de parseUserData, la contraseña tiene sus campos de texto: lanza un UserError
// INVALID_INPUT con los fieldErrors de todos los campos que no son válidos, también los de la
// contraseña (newPassword, repeatPassword).
function parseProfileData(data) {
  const { values, fieldErrors } = parsePersonalData(data, USER_AGE_RANGE);
  Object.assign(fieldErrors, checkPasswordChange(data.newPassword, data.repeatPassword));
  if (Object.keys(fieldErrors).length > 0) {
    throw invalidFieldsError(fieldErrors);
  }
  return { values, password: data.newPassword === '' ? null : data.newPassword };
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

// `operation` es 'create', 'update' o 'restore'.
function duplicateError(fields, operation) {
  const messages = DUPLICATE_MESSAGES[operation];
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, messages[field]]));
  return new UserError('DUPLICATE_VALUE', messages.message, fieldErrors);
}

// Lanza un UserError DUPLICATE_VALUE si el dni o el email de `values` ya son de un usuario vigente
// de la institución con el rol `role` (un valor de usuario_rol.nombre), distinto de
// `excludedUserId` (null en un alta). No cuentan los dados de baja, los de otro rol ni los de otra
// institución: una persona puede tener una cuenta por rol y por institución, con el mismo dni y el
// mismo email.
async function assertNotTaken(institutionId, role, values, excludedUserId, operation) {
  const takenFields = await userRepository.findTakenFields(institutionId, role, values, excludedUserId);
  if (takenFields.length > 0) throw duplicateError(takenFields, operation);
}

// Ejecuta `save` (el INSERT o el UPDATE). Si otro usuario tomó el dni o el email entre la
// comprobación y el guardado, el índice único de la base lo rechaza y se informa como duplicado.
// La restauración no comprueba antes: la decide el índice.
async function saveUnique(save, operation) {
  try {
    return await save();
  } catch (error) {
    const field = userRepository.duplicateFieldOf(error);
    if (!field) throw error;
    throw duplicateError([field], operation);
  }
}

// Ejecuta `save` (el UPDATE que suspende o da de baja a un usuario). La base no deja a una
// institución sin administradores habilitados ni da de baja a quien tiene asignaciones docentes
// vigentes del ciclo lectivo actual: si rechaza el cambio por eso, se lanza un UserError LAST_ADMIN
// o USER_HAS_TEACHER_ASSIGNMENTS. `account` es 'other' u 'own', como en DISABLE_MESSAGES.
async function saveDisabling(save, account) {
  try {
    return await save();
  } catch (error) {
    const messages = DISABLE_MESSAGES[account];
    if (userRepository.isLastAdminError(error)) {
      throw new UserError('LAST_ADMIN', messages.lastAdmin);
    }
    if (userRepository.isTeacherAssignmentsError(error)) {
      throw new UserError('USER_HAS_TEACHER_ASSIGNMENTS', messages.teacherAssignments);
    }
    throw error;
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
// (null si está vigente, también cuando la consulta no trae la columna: el alta, la edición y la
// restauración solo devuelven usuarios vigentes).
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
// quedó, con los campos de listUsers. Quien tiene asignaciones docentes vigentes del ciclo lectivo
// actual no se da de baja: antes hay que reasignarlas o darlas de baja en Docencia. Las de un ciclo
// cerrado no lo impiden: quedan en el histórico a su nombre. Tampoco se da de baja el único
// administrador de la institución que puede usar el sistema (activo y vigente). Las dos reglas las
// aplica la base, así que valen también para dos bajas simultáneas.
// Lanza un UserError si es el propio usuario de la sesión (CANNOT_DELETE_SELF), si tiene
// asignaciones docentes vigentes del ciclo lectivo actual (USER_HAS_TEACHER_ASSIGNMENTS), si es ese
// administrador (LAST_ADMIN), si no existe en la institución (USER_NOT_FOUND) o si ya estaba dado de
// baja (USER_ALREADY_DELETED).
async function deleteUser(currentUser, userId) {
  // La tabla no ofrece al usuario de la sesión, pero el id llega del renderer: se vuelve a comprobar.
  // Su cuenta se da de baja con deleteOwnAccount, que además cierra la sesión.
  if (userId === currentUser.id) {
    throw new UserError('CANNOT_DELETE_SELF', 'No podés eliminar tu propia cuenta.');
  }
  const deletedUser = await saveDisabling(
    () => userRepository.markAsDeleted(userId, currentUser.institutionId),
    'other'
  );
  if (deletedUser) return toListedUser(deletedUser);

  // No se marcó: si existe en la institución es porque ya estaba dado de baja.
  if (await userRepository.existsInInstitution(userId, currentUser.institutionId)) {
    throw new UserError('USER_ALREADY_DELETED', 'El usuario ya había sido eliminado.');
  }
  throw userNotFoundError();
}

// Restauración de un usuario dado de baja de la institución de `currentUser`: la fila queda sin fecha
// de baja y activa (la baja la había suspendido), vuelve a listarse como vigente y puede iniciar
// sesión con la contraseña que tenía. Devuelve al usuario como quedó, con los campos de listUsers.
// Al volver a estar vigente, su dni y su email cuentan otra vez para la unicidad: si mientras
// estuvo dado de baja se creó otra cuenta con alguno de ellos y su mismo rol, no se restaura.
// Lanza un UserError si ya hay un usuario vigente con su dni o su email y su rol (DUPLICATE_VALUE),
// si no existe en la institución (USER_NOT_FOUND) o si no estaba dado de baja (USER_NOT_DELETED).
async function restoreUser(currentUser, userId) {
  const restoredUser = await saveUnique(
    () => userRepository.restore(userId, currentUser.institutionId),
    'restore'
  );
  if (restoredUser) return toListedUser(restoredUser);

  // No se restauró: si existe en la institución es porque ya estaba vigente.
  if (await userRepository.existsInInstitution(userId, currentUser.institutionId)) {
    throw new UserError('USER_NOT_DELETED', 'El usuario ya había sido restaurado.');
  }
  throw userNotFoundError();
}

// Guarda los datos de un usuario vigente de la institución de `currentUser` y lo devuelve como
// quedó, con los campos de listUsers. `data` trae firstName, lastName, dni, email, birthDate
// ('AAAA-MM-DD'), isActive (false lo suspende: sigue en el listado, pero no puede iniciar sesión),
// password (una contraseña nueva, o null para conservar la actual), image (el PNG del recorte de
// una foto nueva, o null para no cambiarla) y removeImage (true quita la foto). El rol no cambia
// después del alta: si llega, no se usa.
// La foto anterior se borra recién cuando la base confirma el cambio.
// Lanza un UserError si es el propio usuario de la sesión (CANNOT_EDIT_SELF), si algún dato no es
// válido (INVALID_INPUT), si el usuario no existe en la institución o fue dado de baja
// (USER_NOT_FOUND), si el dni o el email ya son de otro usuario vigente de la institución con su
// mismo rol (DUPLICATE_VALUE, con fieldErrors) o si suspende al único administrador de la
// institución que puede usar el sistema (LAST_ADMIN).
async function updateUser(currentUser, userId, data) {
  // La tabla no ofrece al usuario de la sesión, pero el id llega del renderer: se vuelve a comprobar.
  // Sus datos se guardan con updateProfile, que no toca su estado y actualiza la sesión.
  if (userId === currentUser.id) {
    throw new UserError('CANNOT_EDIT_SELF', 'No podés editar tu propia cuenta desde esta vista.');
  }
  const values = parseUserData(data, 'update');
  const { jpeg, removeImage } = parseImageChange(data);

  // El rol es el que tiene en la base: define con quiénes no puede repetir el dni ni el email.
  const role = await userRepository.findNotDeletedRole(userId, currentUser.institutionId);
  if (!role) throw userNotFoundError();
  // Excluye al propio usuario: conservar su dni o su email no es un duplicado.
  await assertNotTaken(currentUser.institutionId, role, values, userId, 'update');

  const passwordHash = data.password === null ? null : await hashPassword(data.password);
  const setImage = Boolean(jpeg) || removeImage;
  const result = await saveWithImage(jpeg, (imageFileName) => saveUnique(
    () => saveDisabling(
      () => userRepository.update(userId, currentUser.institutionId, {
        ...values,
        isActive: data.isActive,
        passwordHash,
        setImage,
        imageFileName,
      }),
      'other'
    ),
    'update'
  ));
  // Se dio de baja entre la comprobación y el guardado.
  if (!result) throw userNotFoundError();
  if (setImage) await profileImageService.discardImage(result.previousImageFileName);
  return toListedUser(result.user);
}

// Crea un usuario en la institución de `currentUser`, siempre activo, y lo devuelve con los campos
// de listUsers. `data` trae los mismos campos que en updateUser, sin isActive (si llega, no se usa),
// con `role` (un valor de usuario_rol.nombre, que la cuenta conserva para siempre) y con `password`
// obligatoria: llega en texto plano y solo se guarda su hash. `image` null crea al usuario sin
// foto; `removeImage` no quita nada, pero tampoco puede venir en true junto con una foto.
// Una persona puede tener una cuenta por rol: el dni y el email solo no se repiten entre los
// usuarios vigentes de la institución con ese rol. Si ese dni ya tuvo una cuenta con ese rol y fue
// dada de baja, no se crea otra: hay que restaurar esa.
// Lanza un UserError si algún dato no es válido o falta la contraseña (INVALID_INPUT), si el dni o
// el email ya son de un usuario vigente de la institución con ese rol (DUPLICATE_VALUE, con
// fieldErrors) o si hay una cuenta dada de baja con ese dni y ese rol (DELETED_USER_EXISTS).
async function createUser(currentUser, data) {
  const values = parseUserData(data, 'create');
  // parseUserData acepta null porque al editar conserva la contraseña actual; un alta la necesita.
  if (data.password === null) {
    throw new UserError('INVALID_INPUT', 'Falta la contraseña del usuario.');
  }
  const { jpeg } = parseImageChange(data);
  await assertNotTaken(currentUser.institutionId, values.role, values, null, 'create');

  const deletedUser = await userRepository.findDeletedByRoleAndDni(
    currentUser.institutionId,
    values.role,
    values.dni
  );
  if (deletedUser) {
    const deletedName = `${deletedUser.firstName} ${deletedUser.lastName}`;
    throw new UserError(
      'DELETED_USER_EXISTS',
      `Ya hay una cuenta eliminada de ${deletedName} con este DNI y este rol. ` +
        'Restaurala desde la pestaña Eliminados en lugar de crear otra.'
    );
  }

  const passwordHash = await hashPassword(data.password);
  const user = await saveWithImage(jpeg, (imageFileName) => saveUnique(
    () => userRepository.create(currentUser.institutionId, { ...values, passwordHash, imageFileName }),
    'create'
  ));
  return toListedUser(user);
}

// ---------- Perfil del usuario de la sesión ----------

// La cuenta de la sesión fue dada de baja después de que se comprobó el acceso: la próxima
// operación protegida cierra la sesión (access.service.js).
function accountNotFoundError() {
  return new UserError('USER_NOT_FOUND', 'Tu cuenta ya no está disponible.');
}

// Lista explícita de campos, como toListedUser: lo que muestra la vista Configuración de perfil.
// Sin el id, el rol ni el estado, que el usuario no cambia desde su perfil.
function toProfile(user) {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    dni: user.dni,
    email: user.email,
    birthDate: toIsoDate(user.birthDate),
    imageUrl: profileImageService.toImageUrl(user.imageFileName),
  };
}

// Datos del perfil de `currentUser` (el de la sesión), leídos de la base: la sesión no guarda el dni
// ni la fecha de nacimiento y puede tener datos viejos si un administrador los editó. Devuelve
// { firstName, lastName, dni, email, birthDate ('AAAA-MM-DD' o null), imageUrl (o null) }. Lanza un
// UserError USER_NOT_FOUND si la cuenta ya no está vigente.
async function getProfile(currentUser) {
  const user = await userRepository.findNotDeletedById(currentUser.id, currentUser.institutionId);
  if (!user) throw accountNotFoundError();
  return toProfile(user);
}

// Guarda los datos que `currentUser` (el de la sesión) cambió en su perfil y los devuelve como
// quedaron, con los campos de getProfile. `data` trae firstName, lastName, dni, email, birthDate
// ('AAAA-MM-DD'), newPassword y repeatPassword (los dos vacíos conservan la contraseña actual; no se
// pide la anterior), image y removeImage (como en updateUser). El rol y el estado no se cambian
// desde el perfil: si llegan, no se usan. Con el cambio guardado, la sesión pasa a tener el nombre, el
// apellido, el email y la foto nuevos.
// Lanza un UserError si algún dato no es válido (INVALID_INPUT, con los fieldErrors de los campos,
// también newPassword y repeatPassword; sin ellos si es la foto), si el dni o el email ya son de otro
// usuario vigente de la institución con su mismo rol (DUPLICATE_VALUE, con fieldErrors), o si la
// cuenta ya no está vigente (USER_NOT_FOUND).
async function updateProfile(currentUser, data) {
  const { values, password } = parseProfileData(data);
  const { jpeg, removeImage } = parseImageChange(data);

  // Excluye al propio usuario: conservar su dni o su email no es un duplicado. El rol de la sesión
  // es el de la base: no cambia después del alta.
  await assertNotTaken(currentUser.institutionId, currentUser.role, values, currentUser.id, 'update');

  const passwordHash = password === null ? null : await hashPassword(password);
  const setImage = Boolean(jpeg) || removeImage;
  const result = await saveWithImage(jpeg, (imageFileName) => saveUnique(
    () => userRepository.updateProfile(currentUser.id, currentUser.institutionId, {
      ...values,
      passwordHash,
      setImage,
      imageFileName,
    }),
    'update'
  ));
  if (!result) throw accountNotFoundError();
  if (setImage) await profileImageService.discardImage(result.previousImageFileName);

  const { user } = result;
  sessionService.updateCurrentUser(currentUser, {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    imageFileName: user.imageFileName,
  });
  return toProfile(user);
}

// Baja lógica de la cuenta de `currentUser` (el de la sesión), como la de deleteUser: la fila queda
// con su fecha de baja y suspendida, no puede iniciar sesión y un administrador la puede restaurar.
// Con la baja hecha, la sesión queda cerrada. El único administrador de la institución que puede
// usar el sistema (activo y vigente) no se puede dar de baja: nadie más podría restaurar su cuenta
// ni administrar las demás. Tampoco un profesor con asignaciones docentes vigentes del ciclo lectivo
// actual: un administrador tiene que reasignarlas o darlas de baja antes. Las de un ciclo cerrado no
// lo impiden. Las dos reglas las aplica la base, como en deleteUser.
// Lanza un UserError si es ese administrador (LAST_ADMIN), si tiene asignaciones docentes vigentes
// del ciclo lectivo actual (USER_HAS_TEACHER_ASSIGNMENTS) o si la cuenta ya no está vigente
// (USER_NOT_FOUND).
async function deleteOwnAccount(currentUser) {
  const user = await saveDisabling(
    () => userRepository.markAsDeleted(currentUser.id, currentUser.institutionId),
    'own'
  );
  if (!user) throw accountNotFoundError();

  // Por id: updateProfile reemplaza el objeto de la sesión. Si la sesión terminó o pasó a ser de otra
  // cuenta mientras se daba de baja, no se toca.
  if (sessionService.getCurrentUser()?.id === currentUser.id) sessionService.logout();
}

module.exports = {
  listUsers,
  deleteUser,
  restoreUser,
  updateUser,
  createUser,
  getProfile,
  updateProfile,
  deleteOwnAccount,
  parsePersonalData,
  normalizeText,
  isRealDate,
  toIsoDate,
  REQUIRED_MESSAGE,
  LETTERS,
  UserError,
};
