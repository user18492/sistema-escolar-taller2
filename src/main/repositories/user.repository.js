const { query } = require('../database/connection');
const { User } = require('../models/user.model');

// Compara el email tal como llega: normalizarlo (espacios, mayúsculas) es tarea del servicio.
const FIND_BY_EMAIL_SQL = `
  SELECT u.usuario_id,
         u.usuario_estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.password_hash,
         u.dni,
         u.fecha_nacimiento,
         u.imagen_url,
         r.nombre AS rol,
         i.nombre AS institucion_nombre
    FROM usuarios u
    JOIN usuario_roles r ON r.usuario_rol_id = u.usuario_rol_id
    JOIN instituciones i ON i.institucion_id = u.institucion_id
   WHERE u.email = $1
`;

// Listado de usuarios de una institución, sin password_hash: los campos que no se seleccionan quedan undefined.
const FIND_BY_INSTITUTION_SQL = `
  SELECT u.usuario_id,
         u.usuario_estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         r.nombre AS rol
    FROM usuarios u
    JOIN usuario_roles r ON r.usuario_rol_id = u.usuario_rol_id
   WHERE u.institucion_id = $1
     AND u.usuario_id <> $2
   ORDER BY u.apellido, u.nombre, u.usuario_id
`;

function toUser(row) {
  return new User({
    id: row.usuario_id,
    role: row.rol,
    isActive: row.usuario_estado,
    institutionId: row.institucion_id,
    institutionName: row.institucion_nombre,
    firstName: row.nombre,
    lastName: row.apellido,
    email: row.email,
    passwordHash: row.password_hash,
    dni: row.dni,
    birthDate: row.fecha_nacimiento,
    imageUrl: row.imagen_url,
  });
}

// Devuelve null si no hay un usuario con ese email.
async function findByEmail(email) {
  const { rows } = await query(FIND_BY_EMAIL_SQL, [email]);
  return rows.length > 0 ? toUser(rows[0]) : null;
}

// Usuarios de la institución ordenados por apellido y nombre, sin el de `excludedUserId`.
async function findByInstitution(institutionId, excludedUserId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId, excludedUserId]);
  return rows.map(toUser);
}

module.exports = { findByEmail, findByInstitution };
