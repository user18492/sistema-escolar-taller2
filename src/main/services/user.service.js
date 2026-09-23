const userRepository = require('../repositories/user.repository');

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

module.exports = { listUsers };
