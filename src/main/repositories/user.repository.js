const { query, runInTransaction } = require('../database/connection');
const { User } = require('../models/user.model');

// Compara el email tal como llega: normalizarlo (espacios, mayúsculas) es tarea del servicio.
// Da una fila por institución: quien pertenece a varias tiene una cuenta en cada una, con el mismo
// email. Las cuentas dadas de baja no se encuentran: el login las trata como inexistentes.
const FIND_ALL_BY_EMAIL_SQL = `
  SELECT u.usuario_id,
         u.estado,
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
    FROM usuario u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
    JOIN institucion i ON i.institucion_id = u.institucion_id
   WHERE u.email = $1
     AND u.fecha_eliminacion IS NULL
   ORDER BY i.nombre, u.institucion_id
`;

// Listado de los usuarios de una institución, vigentes y dados de baja (fecha_eliminacion los
// distingue), sin password_hash: los campos que no se seleccionan quedan undefined.
const FIND_BY_INSTITUTION_SQL = `
  SELECT u.usuario_id,
         u.estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         u.imagen_url,
         u.fecha_eliminacion,
         r.nombre AS rol
    FROM usuario u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
   WHERE u.institucion_id = $1
     AND u.usuario_id <> $2
   ORDER BY u.apellido, u.nombre, u.usuario_id
`;

// Usuarios de una institución con un rol que pueden usar el sistema: activos y vigentes, sin los
// suspendidos ni los dados de baja. Solo trae los datos para mostrarlos en una lista: los demás
// campos quedan undefined.
const FIND_ACTIVE_BY_ROLE_SQL = `
  SELECT u.usuario_id,
         u.nombre,
         u.apellido,
         u.email,
         u.imagen_url
    FROM usuario u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
   WHERE u.institucion_id = $1
     AND r.nombre = $2
     AND u.estado
     AND u.fecha_eliminacion IS NULL
   ORDER BY u.apellido, u.nombre, u.usuario_id
`;

// Cantidad de usuarios vigentes de una institución: los activos y los suspendidos, sin los dados de
// baja. No excluye a nadie: cuenta también al usuario de la sesión, que FIND_BY_INSTITUTION_SQL no
// lista.
const COUNT_NOT_DELETED_SQL = `
  SELECT COUNT(*)::INT AS total
    FROM usuario
   WHERE institucion_id = $1
     AND fecha_eliminacion IS NULL
`;

// Baja lógica: la fila se conserva con la fecha de baja y queda suspendida, como exige
// ck_usuario_baja_suspendido (db/schema.sql). Solo marca a un usuario vigente de la institución, así
// una segunda baja (repetida o simultánea) no pisa la fecha de la primera.
// Devuelve la fila como quedó, con el nombre del rol.
const MARK_AS_DELETED_SQL = `
  WITH deleted AS (
    UPDATE usuario
       SET fecha_eliminacion = NOW(),
           estado = FALSE
     WHERE usuario_id = $1
       AND institucion_id = $2
       AND fecha_eliminacion IS NULL
    RETURNING usuario_id, usuario_rol_id, estado, institucion_id, nombre, apellido,
              email, dni, fecha_nacimiento, imagen_url, fecha_eliminacion
  )
  SELECT u.usuario_id,
         u.estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         u.imagen_url,
         u.fecha_eliminacion,
         r.nombre AS rol
    FROM deleted u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
`;

// Usuarios de una institución con un rol que pueden usar el sistema (activos y vigentes, como
// FIND_ACTIVE_BY_ROLE_SQL), con sus filas bloqueadas hasta el fin de la transacción: ninguno puede
// dejar de serlo mientras tanto. Siempre en el mismo orden, para que dos transacciones no se
// esperen entre sí.
const LOCK_ACTIVE_BY_ROLE_SQL = `
  SELECT usuario_id
    FROM usuario
   WHERE institucion_id = $1
     AND usuario_rol_id = (SELECT usuario_rol_id FROM usuario_rol WHERE nombre = $2)
     AND estado
     AND fecha_eliminacion IS NULL
   ORDER BY usuario_id
     FOR UPDATE
`;

// Restauración: la fila vuelve a estar vigente (sin fecha de baja) y activa, porque la baja la había
// dejado suspendida. Solo modifica a un usuario dado de baja de la institución, así no le cambia el
// estado a uno vigente que está suspendido.
// Devuelve la fila como quedó, con el nombre del rol.
const RESTORE_SQL = `
  WITH restored AS (
    UPDATE usuario
       SET fecha_eliminacion = NULL,
           estado = TRUE
     WHERE usuario_id = $1
       AND institucion_id = $2
       AND fecha_eliminacion IS NOT NULL
    RETURNING usuario_id, usuario_rol_id, estado, institucion_id, nombre, apellido,
              email, dni, fecha_nacimiento, imagen_url
  )
  SELECT u.usuario_id,
         u.estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         u.imagen_url,
         r.nombre AS rol
    FROM restored u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
`;

// Cuenta también a los dados de baja.
const EXISTS_IN_INSTITUTION_SQL = `
  SELECT 1
    FROM usuario
   WHERE usuario_id = $1
     AND institucion_id = $2
`;

const EXISTS_NOT_DELETED_SQL = `
  SELECT 1
    FROM usuario
   WHERE usuario_id = $1
     AND institucion_id = $2
     AND fecha_eliminacion IS NULL
`;

const EXISTS_ACTIVE_SQL = `
  SELECT 1
    FROM usuario
   WHERE usuario_id = $1
     AND estado
     AND fecha_eliminacion IS NULL
`;

// Compara con los demás usuarios de la institución, también los dados de baja, como las
// restricciones UNIQUE de dni y email: los de otra institución no cuentan, porque quien pertenece a
// varias tiene una cuenta en cada una con el mismo dni y el mismo email. El email se compara sin
// distinguir mayúsculas.
// Con $4 null (un alta) no excluye a nadie: `<>` daría NULL y descartaría todas las filas.
const FIND_TAKEN_FIELDS_SQL = `
  SELECT COALESCE(BOOL_OR(dni = $2), FALSE)          AS dni_taken,
         COALESCE(BOOL_OR(LOWER(email) = $3), FALSE) AS email_taken
    FROM usuario
   WHERE institucion_id = $1
     AND usuario_id IS DISTINCT FROM $4
     AND (dni = $2 OR LOWER(email) = $3)
`;

// Alta en la institución: el usuario queda activo (estado TRUE, sin depender del valor por defecto
// de la columna) y vigente (fecha_eliminacion NULL). imagen_url es null sin foto. Devuelve la fila
// creada, con el nombre del rol.
const CREATE_SQL = `
  WITH created AS (
    INSERT INTO usuario (usuario_rol_id, institucion_id, estado, nombre, apellido, dni, email,
                         fecha_nacimiento, password_hash, imagen_url)
    VALUES ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = $7), $1, TRUE, $2, $3, $4, $5, $6, $8, $9)
    RETURNING usuario_id, usuario_rol_id, estado, institucion_id, nombre, apellido,
              email, dni, fecha_nacimiento, imagen_url
  )
  SELECT u.usuario_id,
         u.estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         u.imagen_url,
         r.nombre AS rol
    FROM created u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
`;

// Foto actual de un usuario vigente de la institución, con la fila bloqueada hasta el fin de la
// transacción: así se sabe qué archivo reemplaza el UPDATE que sigue.
const LOCK_FOR_UPDATE_SQL = `
  SELECT imagen_url
    FROM usuario
   WHERE usuario_id = $1
     AND institucion_id = $2
     AND fecha_eliminacion IS NULL
     FOR UPDATE
`;

// Solo modifica a un usuario vigente de la institución. password_hash cambia solo si llega uno:
// con $9 null se conserva el actual. imagen_url cambia a $11 (null quita la foto) solo con $10 true.
// estado es $12: true = activo, false = suspendido.
// Devuelve la fila como quedó, con el nombre del rol.
const UPDATE_SQL = `
  WITH updated AS (
    UPDATE usuario
       SET nombre = $3,
           apellido = $4,
           dni = $5,
           email = $6,
           fecha_nacimiento = $7,
           usuario_rol_id = (SELECT usuario_rol_id FROM usuario_rol WHERE nombre = $8),
           password_hash = COALESCE($9, password_hash),
           imagen_url = CASE WHEN $10 THEN $11 ELSE imagen_url END,
           estado = $12
     WHERE usuario_id = $1
       AND institucion_id = $2
       AND fecha_eliminacion IS NULL
    RETURNING usuario_id, usuario_rol_id, estado, institucion_id, nombre, apellido,
              email, dni, fecha_nacimiento, imagen_url
  )
  SELECT u.usuario_id,
         u.estado,
         u.institucion_id,
         u.nombre,
         u.apellido,
         u.email,
         u.dni,
         u.fecha_nacimiento,
         u.imagen_url,
         r.nombre AS rol
    FROM updated u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
`;

// Datos del perfil de un usuario vigente de la institución, sin password_hash ni el rol: los campos
// que no se seleccionan quedan undefined.
const FIND_NOT_DELETED_BY_ID_SQL = `
  SELECT usuario_id,
         institucion_id,
         nombre,
         apellido,
         email,
         dni,
         fecha_nacimiento,
         imagen_url
    FROM usuario
   WHERE usuario_id = $1
     AND institucion_id = $2
     AND fecha_eliminacion IS NULL
`;

// Como UPDATE_SQL, pero sin el rol ni el estado: son los datos que un usuario cambia en su propio
// perfil. password_hash cambia solo si llega uno ($8) e imagen_url pasa a $10 solo con $9 true.
// Devuelve la fila como quedó, con los campos de FIND_NOT_DELETED_BY_ID_SQL.
const UPDATE_PROFILE_SQL = `
  UPDATE usuario
     SET nombre = $3,
         apellido = $4,
         dni = $5,
         email = $6,
         fecha_nacimiento = $7,
         password_hash = COALESCE($8, password_hash),
         imagen_url = CASE WHEN $9 THEN $10 ELSE imagen_url END
   WHERE usuario_id = $1
     AND institucion_id = $2
     AND fecha_eliminacion IS NULL
  RETURNING usuario_id, institucion_id, nombre, apellido, email, dni, fecha_nacimiento, imagen_url
`;

// Restricciones UNIQUE de usuario (con los nombres que les da db/schema.sql) y el campo que protege
// cada una.
const UNIQUE_CONSTRAINT_FIELDS = {
  uq_usuario_institucion_dni: 'dni',
  uq_usuario_institucion_email: 'email',
};

function toUser(row) {
  return new User({
    id: row.usuario_id,
    role: row.rol,
    isActive: row.estado,
    institutionId: row.institucion_id,
    institutionName: row.institucion_nombre,
    firstName: row.nombre,
    lastName: row.apellido,
    email: row.email,
    passwordHash: row.password_hash,
    dni: row.dni,
    birthDate: row.fecha_nacimiento,
    imageFileName: row.imagen_url,
    deletedAt: row.fecha_eliminacion,
  });
}

// Cuentas vigentes con ese email, una por institución y ordenadas por el nombre de la institución.
// Devuelve una lista vacía si no hay ninguna.
async function findAllByEmail(email) {
  const { rows } = await query(FIND_ALL_BY_EMAIL_SQL, [email]);
  return rows.map(toUser);
}

// Usuarios de la institución, vigentes y dados de baja (con `deletedAt`), ordenados por apellido y
// nombre, sin el de `excludedUserId`.
async function findByInstitution(institutionId, excludedUserId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId, excludedUserId]);
  return rows.map(toUser);
}

// Usuarios activos y vigentes de la institución con ese rol (un valor de usuario_rol.nombre),
// ordenados por apellido y nombre. Solo traen id, nombre, apellido, email y foto.
async function findActiveByRole(institutionId, role) {
  const { rows } = await query(FIND_ACTIVE_BY_ROLE_SQL, [institutionId, role]);
  return rows.map(toUser);
}

// Cantidad de usuarios vigentes de la institución (activos y suspendidos, sin los dados de baja),
// con el de la sesión incluido.
async function countNotDeleted(institutionId) {
  const { rows } = await query(COUNT_NOT_DELETED_SQL, [institutionId]);
  return rows[0].total;
}

// Da de baja al usuario, que queda además suspendido. Devuelve el usuario como quedó, sin
// password_hash; null si no existe en la institución o ya estaba dado de baja.
async function markAsDeleted(userId, institutionId) {
  const { rows } = await query(MARK_AS_DELETED_SQL, [userId, institutionId]);
  return rows.length > 0 ? toUser(rows[0]) : null;
}

// Como markAsDeleted, salvo que el usuario sea el único de la institución con el rol `role` (un
// valor de usuario_rol.nombre) que puede usar el sistema, activo y vigente: entonces no lo da de
// baja. El rol es el que tiene en la base. Devuelve { user, isLastWithRole }: `user` es el usuario
// como quedó, o null si no se dio de baja, e `isLastWithRole` indica que fue por ser el único.
async function markAsDeletedUnlessLastWithRole(userId, institutionId, role) {
  // En una transacción, con los usuarios de ese rol bloqueados: si dos se dan de baja a la vez, el
  // segundo espera al primero y ya no lo cuenta.
  return runInTransaction(async (transactionQuery) => {
    const locked = await transactionQuery(LOCK_ACTIVE_BY_ROLE_SQL, [institutionId, role]);
    if (locked.rows.length === 1 && locked.rows[0].usuario_id === userId) {
      return { user: null, isLastWithRole: true };
    }

    const { rows } = await transactionQuery(MARK_AS_DELETED_SQL, [userId, institutionId]);
    return { user: rows.length > 0 ? toUser(rows[0]) : null, isLastWithRole: false };
  });
}

// Restaura al usuario dado de baja, que queda vigente y activo. Devuelve el usuario como quedó, sin
// password_hash; null si no existe en la institución o no estaba dado de baja.
async function restore(userId, institutionId) {
  const { rows } = await query(RESTORE_SQL, [userId, institutionId]);
  return rows.length > 0 ? toUser(rows[0]) : null;
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

// true si el usuario está activo y no está dado de baja: es la cuenta que puede usar el sistema.
async function existsActive(userId) {
  const { rows } = await query(EXISTS_ACTIVE_SQL, [userId]);
  return rows.length > 0;
}

// Campos ('dni', 'email') cuyo valor ya tiene un usuario de la institución distinto de
// `excludedUserId` (null en un alta, para comparar con todos). Espera el dni solo con dígitos y el
// email normalizado, como se guardan.
async function findTakenFields(institutionId, { dni, email }, excludedUserId) {
  const { rows } = await query(FIND_TAKEN_FIELDS_SQL, [institutionId, dni, email, excludedUserId]);
  const fields = [];
  if (rows[0].dni_taken) fields.push('dni');
  if (rows[0].email_taken) fields.push('email');
  return fields;
}

// Crea un usuario vigente y activo en la institución. Recibe los datos como update, con
// `passwordHash` obligatorio y sin setImage: `imageFileName` es el archivo de su foto, o null sin
// foto. Devuelve el usuario creado, sin password_hash. Si el dni o el email ya son de otro usuario
// de la institución, PostgreSQL rechaza el alta: ver duplicateFieldOf.
async function create(
  institutionId,
  { firstName, lastName, dni, email, birthDate, role, passwordHash, imageFileName }
) {
  const { rows } = await query(CREATE_SQL, [
    institutionId,
    firstName,
    lastName,
    dni,
    email,
    birthDate,
    role,
    passwordHash,
    imageFileName,
  ]);
  return toUser(rows[0]);
}

// Reemplaza los datos de un usuario vigente de la institución. `birthDate` es 'AAAA-MM-DD', `role`
// un valor de usuario_rol.nombre, `isActive` false para suspenderlo y `passwordHash` null para
// conservar la contraseña actual. Con `setImage` true, la foto pasa a ser `imageFileName` (null la
// quita); con false se conserva.
// Devuelve { user, previousImageFileName }: el usuario como quedó, sin password_hash, y el archivo de
// la foto que tenía antes del cambio (null si no tenía). Devuelve null si no hay uno vigente con ese
// id en la institución. Si el dni o el email ya son de otro usuario de la institución, PostgreSQL
// rechaza el cambio: ver duplicateFieldOf.
async function update(
  userId,
  institutionId,
  { firstName, lastName, dni, email, birthDate, role, isActive, passwordHash, setImage, imageFileName }
) {
  // En una transacción, y no con RETURNING OLD (PostgreSQL 18), para funcionar con cualquier versión.
  return runInTransaction(async (transactionQuery) => {
    const locked = await transactionQuery(LOCK_FOR_UPDATE_SQL, [userId, institutionId]);
    if (locked.rows.length === 0) return null;

    const { rows } = await transactionQuery(UPDATE_SQL, [
      userId,
      institutionId,
      firstName,
      lastName,
      dni,
      email,
      birthDate,
      role,
      passwordHash,
      setImage,
      imageFileName,
      isActive,
    ]);
    return { user: toUser(rows[0]), previousImageFileName: locked.rows[0].imagen_url };
  });
}

// Usuario vigente con ese id en la institución, con los datos de su perfil (nombre, apellido, dni,
// email, fecha de nacimiento y foto), o null si no existe o fue dado de baja.
async function findNotDeletedById(userId, institutionId) {
  const { rows } = await query(FIND_NOT_DELETED_BY_ID_SQL, [userId, institutionId]);
  return rows.length > 0 ? toUser(rows[0]) : null;
}

// Reemplaza los datos del perfil de un usuario vigente de la institución, sin tocar su rol ni su
// estado. Recibe los datos como update, sin `role` ni `isActive`, y devuelve lo mismo:
// { user, previousImageFileName }, con los campos de findNotDeletedById en `user`, o null si no hay
// uno vigente con ese id en la institución. Si el dni o el email ya son de otro usuario de la
// institución, PostgreSQL rechaza el cambio: ver duplicateFieldOf.
async function updateProfile(
  userId,
  institutionId,
  { firstName, lastName, dni, email, birthDate, passwordHash, setImage, imageFileName }
) {
  // En una transacción, como update: la foto anterior se lee con la fila bloqueada.
  return runInTransaction(async (transactionQuery) => {
    const locked = await transactionQuery(LOCK_FOR_UPDATE_SQL, [userId, institutionId]);
    if (locked.rows.length === 0) return null;

    const { rows } = await transactionQuery(UPDATE_PROFILE_SQL, [
      userId,
      institutionId,
      firstName,
      lastName,
      dni,
      email,
      birthDate,
      passwordHash,
      setImage,
      imageFileName,
    ]);
    return { user: toUser(rows[0]), previousImageFileName: locked.rows[0].imagen_url };
  });
}

// Campo ('dni' o 'email') cuyo valor repetido causó `error`, si es una violación de una restricción
// UNIQUE de usuario; si no, null.
function duplicateFieldOf(error) {
  if (error?.code !== '23505') return null;
  return UNIQUE_CONSTRAINT_FIELDS[error.constraint] ?? null;
}

module.exports = {
  findAllByEmail,
  findByInstitution,
  findActiveByRole,
  countNotDeleted,
  markAsDeleted,
  markAsDeletedUnlessLastWithRole,
  restore,
  existsInInstitution,
  existsNotDeleted,
  existsActive,
  findTakenFields,
  create,
  update,
  findNotDeletedById,
  updateProfile,
  duplicateFieldOf,
};
