const { query } = require('../database/connection');
const { Student } = require('../models/student.model');

// Listado de los alumnos de una institución, vigentes y dados de baja (fecha_eliminacion los
// distingue), con el nombre de su estado.
// El orden es total: el apellido y el nombre; alumno_id mantiene juntos los datos de dos alumnos
// que se llaman igual, así dos consultas sobre los mismos datos dan siempre el mismo orden.
const FIND_BY_INSTITUTION_SQL = `
  SELECT a.alumno_id,
         a.institucion_id,
         a.nombre,
         a.apellido,
         a.email,
         a.telefono,
         a.direccion_calle,
         a.direccion_altura,
         a.dni,
         a.fecha_nacimiento,
         a.fecha_eliminacion,
         e.nombre AS estado
    FROM alumno a
    JOIN alumno_estado e ON e.alumno_estado_id = a.alumno_estado_id
   WHERE a.institucion_id = $1
   ORDER BY a.apellido, a.nombre, a.alumno_id
`;

// Si el alumno $1 está vigente en la institución $2.
const EXISTS_NOT_DELETED_SQL = `
  SELECT 1
    FROM alumno
   WHERE alumno_id = $1
     AND institucion_id = $2
     AND fecha_eliminacion IS NULL
`;

// Si $2 (dni) y $3 (email) ya los tiene un alumno vigente de la institución distinto de $4 (null en
// un alta). Los dados de baja no cuentan, aunque uq_alumno_institucion_dni y
// uq_alumno_institucion_email sí: ver duplicateFieldOf.
// alumno no tiene un CHECK de minúsculas como usuario: el email se compara en minúsculas, como
// llega normalizado.
const FIND_TAKEN_FIELDS_SQL = `
  SELECT COALESCE(BOOL_OR(dni = $2), FALSE)          AS dni_taken,
         COALESCE(BOOL_OR(LOWER(email) = $3), FALSE) AS email_taken
    FROM alumno
   WHERE institucion_id = $1
     AND fecha_eliminacion IS NULL
     AND alumno_id IS DISTINCT FROM $4
     AND (dni = $2 OR LOWER(email) = $3)
`;

// Alta: el alumno nace vigente y ACTIVO. Devuelve la fila creada con los campos y el estado de
// FIND_BY_INSTITUTION_SQL, salvo fecha_eliminacion: está vigente.
const CREATE_SQL = `
  WITH created AS (
    INSERT INTO alumno (institucion_id, alumno_estado_id, nombre, apellido, email, telefono,
                        direccion_calle, direccion_altura, dni, fecha_nacimiento)
    VALUES ($1, (SELECT alumno_estado_id FROM alumno_estado WHERE nombre = 'ACTIVO'),
            $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING alumno_id, institucion_id, alumno_estado_id, nombre, apellido, email, telefono,
              direccion_calle, direccion_altura, dni, fecha_nacimiento
  )
  SELECT a.alumno_id,
         a.institucion_id,
         a.nombre,
         a.apellido,
         a.email,
         a.telefono,
         a.direccion_calle,
         a.direccion_altura,
         a.dni,
         a.fecha_nacimiento,
         e.nombre AS estado
    FROM created a
    JOIN alumno_estado e ON e.alumno_estado_id = a.alumno_estado_id
`;

// Solo modifica a un alumno vigente de la institución, sin tocar su institución ni su
// fecha_eliminacion. El estado llega como un valor de alumno_estado.nombre ($3). Devuelve la fila
// como quedó, con los campos y el estado de FIND_BY_INSTITUTION_SQL salvo fecha_eliminacion (sigue
// vigente), o ninguna si el alumno no está vigente en la institución.
const UPDATE_SQL = `
  WITH updated AS (
    UPDATE alumno
       SET alumno_estado_id = (SELECT alumno_estado_id FROM alumno_estado WHERE nombre = $3),
           nombre = $4,
           apellido = $5,
           email = $6,
           telefono = $7,
           direccion_calle = $8,
           direccion_altura = $9,
           dni = $10,
           fecha_nacimiento = $11
     WHERE alumno_id = $1
       AND institucion_id = $2
       AND fecha_eliminacion IS NULL
    RETURNING alumno_id, institucion_id, alumno_estado_id, nombre, apellido, email, telefono,
              direccion_calle, direccion_altura, dni, fecha_nacimiento
  )
  SELECT a.alumno_id,
         a.institucion_id,
         a.nombre,
         a.apellido,
         a.email,
         a.telefono,
         a.direccion_calle,
         a.direccion_altura,
         a.dni,
         a.fecha_nacimiento,
         e.nombre AS estado
    FROM updated a
    JOIN alumno_estado e ON e.alumno_estado_id = a.alumno_estado_id
`;

// Baja lógica del alumno $1 de la institución $2 y cancelación de sus inscripciones activas, todo o
// nada: lo hace sp_alumno_dar_de_baja (db/schema.sql). Su parámetro OUT se pasa como NULL y vuelve
// en la única fila del resultado.
const MARK_AS_DELETED_SQL = `
  CALL sp_alumno_dar_de_baja($1, $2, NULL)
`;

// Errores previstos de sp_alumno_dar_de_baja, por su código de condición de PostgreSQL.
const STUDENT_NOT_FOUND_CODE = 'P0002'; // no_data_found
const STUDENT_ALREADY_DELETED_CODE = '55000'; // object_not_in_prerequisite_state

// Valores de alumno_estado.nombre, con los códigos del sistema.
const STATUS_BY_COLUMN_VALUE = {
  ACTIVO: 'ACTIVE',
  EGRESADO: 'GRADUATED',
};

const COLUMN_VALUE_BY_STATUS = Object.fromEntries(
  Object.entries(STATUS_BY_COLUMN_VALUE).map(([columnValue, status]) => [status, columnValue])
);

// Restricciones UNIQUE de alumno (con los nombres que les da db/schema.sql) y el campo que protege
// cada una entre los alumnos de una institución, vigentes y dados de baja.
const UNIQUE_CONSTRAINT_FIELDS = {
  uq_alumno_institucion_dni: 'dni',
  uq_alumno_institucion_email: 'email',
};

function toStudent(row) {
  return new Student({
    id: row.alumno_id,
    institutionId: row.institucion_id,
    firstName: row.nombre,
    lastName: row.apellido,
    dni: row.dni,
    email: row.email,
    phone: row.telefono,
    street: row.direccion_calle,
    streetNumber: row.direccion_altura,
    birthDate: row.fecha_nacimiento,
    status: STATUS_BY_COLUMN_VALUE[row.estado],
    deletedAt: row.fecha_eliminacion,
  });
}

// Alumnos de la institución, vigentes y dados de baja (con `deletedAt`), ordenados por apellido y
// nombre.
async function findByInstitution(institutionId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId]);
  return rows.map(toStudent);
}

// true si el alumno con ese id es de la institución y no está dado de baja.
async function existsNotDeleted(studentId, institutionId) {
  const { rows } = await query(EXISTS_NOT_DELETED_SQL, [studentId, institutionId]);
  return rows.length > 0;
}

// Campos ('dni', 'email') cuyo valor ya tiene un alumno vigente de la institución distinto de
// `excludedStudentId` (null en un alta, para comparar con todos). Espera el dni solo con dígitos y
// el email normalizado, como se guardan.
async function findTakenFields(institutionId, { dni, email }, excludedStudentId) {
  const { rows } = await query(FIND_TAKEN_FIELDS_SQL, [institutionId, dni, email, excludedStudentId]);
  const fields = [];
  if (rows[0].dni_taken) fields.push('dni');
  if (rows[0].email_taken) fields.push('email');
  return fields;
}

// Crea un alumno vigente y activo en la institución. `birthDate` es 'AAAA-MM-DD' y `street` y
// `streetNumber`, la calle y la altura de la dirección. Devuelve el alumno creado. Si el dni o el
// email ya son de otro alumno de la institución, vigente o dado de baja, PostgreSQL rechaza el alta:
// ver duplicateFieldOf.
async function create(
  institutionId,
  { firstName, lastName, dni, email, phone, street, streetNumber, birthDate }
) {
  const { rows } = await query(CREATE_SQL, [
    institutionId,
    firstName,
    lastName,
    email,
    phone,
    street,
    streetNumber,
    dni,
    birthDate,
  ]);
  return toStudent(rows[0]);
}

// Modifica los datos y el estado (ACTIVE o GRADUATED) del alumno vigente con ese id en la
// institución, con los mismos campos que create. Devuelve el alumno como quedó, o null si no existe
// en la institución o fue dado de baja. Si el dni o el email ya son de otro alumno de la
// institución, vigente o dado de baja, PostgreSQL rechaza el cambio: ver duplicateFieldOf.
async function update(
  studentId,
  institutionId,
  { firstName, lastName, dni, email, phone, street, streetNumber, birthDate, status }
) {
  const { rows } = await query(UPDATE_SQL, [
    studentId,
    institutionId,
    COLUMN_VALUE_BY_STATUS[status],
    firstName,
    lastName,
    email,
    phone,
    street,
    streetNumber,
    dni,
    birthDate,
  ]);
  return rows.length > 0 ? toStudent(rows[0]) : null;
}

// Da de baja al alumno vigente con ese id en la institución y cancela sus inscripciones activas, en
// una sola llamada a sp_alumno_dar_de_baja. Devuelve cuántas inscripciones canceló. Si el alumno no
// existe en la institución o ya estaba dado de baja, el procedimiento falla sin cambiar nada: ver
// isNotFoundError e isAlreadyDeletedError.
async function markAsDeleted(studentId, institutionId) {
  const { rows } = await query(MARK_AS_DELETED_SQL, [studentId, institutionId]);
  return rows[0].p_inscripciones_canceladas;
}

// Campo ('dni' o 'email') cuyo valor repetido causó `error`, si es una violación de una restricción
// UNIQUE de alumno; si no, null.
function duplicateFieldOf(error) {
  if (error?.code !== '23505') return null;
  return UNIQUE_CONSTRAINT_FIELDS[error.constraint] ?? null;
}

// true si `error` es el de sp_alumno_dar_de_baja para un alumno que no existe en la institución.
function isNotFoundError(error) {
  return error?.code === STUDENT_NOT_FOUND_CODE;
}

// true si `error` es el de sp_alumno_dar_de_baja para un alumno que ya estaba dado de baja.
function isAlreadyDeletedError(error) {
  return error?.code === STUDENT_ALREADY_DELETED_CODE;
}

module.exports = {
  findByInstitution,
  existsNotDeleted,
  findTakenFields,
  create,
  update,
  markAsDeleted,
  duplicateFieldOf,
  isNotFoundError,
  isAlreadyDeletedError,
};
