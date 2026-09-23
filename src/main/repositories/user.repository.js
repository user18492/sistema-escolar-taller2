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

const EXISTS_NOT_DELETED_SQL = `
  SELECT 1
    FROM usuarios
   WHERE usuario_id = $1
     AND institucion_id = $2
     AND deleted_at IS NULL
`;

// Compara con todos los demás usuarios, también los de otras instituciones y los dados de baja,
// como las restricciones UNIQUE de dni y email. El email se compara sin distinguir mayúsculas.
// Con $3 null (un alta) no excluye a nadie: `<>` daría NULL y descartaría todas las filas.
const FIND_TAKEN_FIELDS_SQL = `
  SELECT COALESCE(BOOL_OR(dni = $1), FALSE)          AS dni_taken,
         COALESCE(BOOL_OR(LOWER(email) = $2), FALSE) AS email_taken
    FROM usuarios
   WHERE usuario_id IS DISTINCT FROM $3
     AND (dni = $1 OR LOWER(email) = $2)
`;

// Alta en la institución: usuario_estado toma su valor por defecto (activo) y deleted_at queda
// NULL (vigente). Devuelve la fila creada, con el nombre del rol.
const CREATE_SQL = `
  WITH created AS (
    INSERT INTO usuarios (usuario_rol_id, institucion_id, nombre, apellido, dni, email,
                          fecha_nacimiento, password_hash)
    VALUES ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = $7), $1, $2, $3, $4, $5, $6, $8)
    RETURNING usuario_id, usuario_rol_id, usuario_estado, institucion_id, nombre, apellido,
              email, dni, fecha_nacimiento
  )
  SELECT u.usuario_id,
         u.usuario_estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         r.nombre AS rol
    FROM created u
    JOIN usuario_roles r ON r.usuario_rol_id = u.usuario_rol_id
`;

// Solo modifica a un usuario vigente de la institución. password_hash cambia solo si llega uno:
// con $9 null se conserva el actual. Devuelve la fila como quedó, con el nombre del rol.
const UPDATE_SQL = `
  WITH updated AS (
    UPDATE usuarios
       SET nombre = $3,
           apellido = $4,
           dni = $5,
           email = $6,
           fecha_nacimiento = $7,
           usuario_rol_id = (SELECT usuario_rol_id FROM usuario_roles WHERE nombre = $8),
           password_hash = COALESCE($9, password_hash)
     WHERE usuario_id = $1
       AND institucion_id = $2
       AND deleted_at IS NULL
    RETURNING usuario_id, usuario_rol_id, usuario_estado, institucion_id, nombre, apellido,
              email, dni, fecha_nacimiento
  )
  SELECT u.usuario_id,
         u.usuario_estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         r.nombre AS rol
    FROM updated u
    JOIN usuario_roles r ON r.usuario_rol_id = u.usuario_rol_id
`;

// Restricciones UNIQUE de usuarios (nombres que les da PostgreSQL según db/schema.sql) y el campo
// que protege cada una.
const UNIQUE_CONSTRAINT_FIELDS = {
  usuarios_dni_key: 'dni',
  usuarios_email_key: 'email',
};

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

// true si el usuario pertenece a la institución y no está dado de baja.
async function existsNotDeleted(userId, institutionId) {
  const { rows } = await query(EXISTS_NOT_DELETED_SQL, [userId, institutionId]);
  return rows.length > 0;
}

// Campos ('dni', 'email') cuyo valor ya tiene un usuario distinto de `excludedUserId` (null en un
// alta, para comparar con todos). Espera el dni solo con dígitos y el email normalizado, como se
// guardan.
async function findTakenFields({ dni, email }, excludedUserId) {
  const { rows } = await query(FIND_TAKEN_FIELDS_SQL, [dni, email, excludedUserId]);
  const fields = [];
  if (rows[0].dni_taken) fields.push('dni');
  if (rows[0].email_taken) fields.push('email');
  return fields;
}

// Crea un usuario vigente y activo en la institución. Recibe los datos como update, con
// `passwordHash` obligatorio. Devuelve el usuario creado, sin password_hash. Si el dni o el email ya
// son de otro usuario, PostgreSQL rechaza el alta: ver duplicateFieldOf.
async function create(institutionId, { firstName, lastName, dni, email, birthDate, role, passwordHash }) {
  const { rows } = await query(CREATE_SQL, [
    institutionId,
    firstName,
    lastName,
    dni,
    email,
    birthDate,
    role,
    passwordHash,
  ]);
  return toUser(rows[0]);
}

// Reemplaza los datos de un usuario vigente de la institución. `birthDate` es 'AAAA-MM-DD', `role`
// un valor de usuario_roles.nombre y `passwordHash` null para conservar la contraseña actual.
// Devuelve el usuario como quedó, sin password_hash, o null si no hay uno vigente con ese id en la
// institución. Si el dni o el email ya son de otro usuario, PostgreSQL rechaza el cambio: ver
// duplicateFieldOf.
async function update(userId, institutionId, { firstName, lastName, dni, email, birthDate, role, passwordHash }) {
  const { rows } = await query(UPDATE_SQL, [
    userId,
    institutionId,
    firstName,
    lastName,
    dni,
    email,
    birthDate,
    role,
    passwordHash,
  ]);
  return rows.length > 0 ? toUser(rows[0]) : null;
}

// Campo ('dni' o 'email') cuyo valor repetido causó `error`, si es una violación de una restricción
// UNIQUE de usuarios; si no, null.
function duplicateFieldOf(error) {
  if (error?.code !== '23505') return null;
  return UNIQUE_CONSTRAINT_FIELDS[error.constraint] ?? null;
}

module.exports = {
  findByEmail,
  findByInstitution,
  markAsDeleted,
  existsInInstitution,
  existsNotDeleted,
  findTakenFields,
  create,
  update,
  duplicateFieldOf,
};
