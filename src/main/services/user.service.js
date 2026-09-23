const userRepository = require('../repositories/user.repository');

// Error previsto, con un mensaje apto para la UI (como AccessError en access.service.js).
class UserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
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
  throw new UserError('USER_NOT_FOUND', 'El usuario ya no existe.');
}

module.exports = { listUsers, deleteUser, UserError };
