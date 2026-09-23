const { query } = require('../database/connection');
const { User } = require('../models/user.model');

// Compara el email tal como llega: normalizarlo (espacios, mayúsculas) es tarea del servicio.
// Los usuarios dados de baja no se encuentran: el login los trata como un email inexistente.
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
     AND u.deleted_at IS NULL
`;

// Listado de los usuarios vigentes de una institución, sin password_hash: los campos que no se
// seleccionan quedan undefined.
const FIND_BY_INSTITUTION_SQL = `
  SELECT u.usuario_id,
         u.usuario_estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         r.nombre AS rol
    FROM usuarios u
    JOIN usuario_roles r ON r.usuario_rol_id = u.usuario_rol_id
   WHERE u.institucion_id = $1
     AND u.usuario_id <> $2
     AND u.deleted_at IS NULL
   ORDER BY u.apellido, u.nombre, u.usuario_id
`;

// Baja lógica: la fila se conserva con la fecha de baja. Solo marca a un usuario vigente de la
// institución, así una segunda baja (repetida o simultánea) no pisa la fecha de la primera.
const MARK_AS_DELETED_SQL = `
  UPDATE usuarios
     SET deleted_at = NOW()
   WHERE usuario_id = $1
     AND institucion_id = $2
     AND deleted_at IS NULL
`;

// Cuenta también a los dados de baja.
const EXISTS_IN_INSTITUTION_SQL = `
  SELECT 1
    FROM usuarios
   WHERE usuario_id = $1
     AND institucion_id = $2
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

// Usuarios vigentes de la institución ordenados por apellido y nombre, sin el de `excludedUserId`.
async function findByInstitution(institutionId, excludedUserId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId, excludedUserId]);
  return rows.map(toUser);
}

// Devuelve true si dio de baja al usuario; false si no existe en la institución o ya estaba dado de baja.
async function markAsDeleted(userId, institutionId) {
  const { rowCount } = await query(MARK_AS_DELETED_SQL, [userId, institutionId]);
  return rowCount > 0;
}

// true si el usuario pertenece a la institución, esté vigente o dado de baja.
async function existsInInstitution(userId, institutionId) {
  const { rows } = await query(EXISTS_IN_INSTITUTION_SQL, [userId, institutionId]);
  return rows.length > 0;
}

module.exports = { findByEmail, findByInstitution, markAsDeleted, existsInInstitution };
