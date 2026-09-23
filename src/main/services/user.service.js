const userRepository = require('../repositories/user.repository');

// Lista explícita de campos, como toPublicUser (auth.service.js): lo que muestra la tabla de Usuarios
// y el id para identificar la fila. `role` es el valor de usuario_roles.nombre.
function toListedUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    dni: user.dni,
    email: user.email,
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
