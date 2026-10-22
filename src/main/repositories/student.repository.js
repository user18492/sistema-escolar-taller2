const { query } = require('../database/connection');
const { Student } = require('../models/student.model');

// Listado de todos los alumnos de una institución, con el nombre de su estado. fecha_eliminacion
// todavía no interviene en ninguna regla (db/schema.sql), así que tampoco filtra el listado.
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
         e.nombre AS estado
    FROM alumno a
    JOIN alumno_estado e ON e.alumno_estado_id = a.alumno_estado_id
   WHERE a.institucion_id = $1
   ORDER BY a.apellido, a.nombre, a.alumno_id
`;

// Si $2 (dni) y $3 (email) ya los tiene un alumno vigente de la institución. Los dados de baja no
// cuentan, aunque uq_alumno_institucion_dni y uq_alumno_institucion_email sí: ver duplicateFieldOf.
// alumno no tiene un CHECK de minúsculas como usuario: el email se compara en minúsculas, como
// llega normalizado.
const FIND_TAKEN_FIELDS_SQL = `
  SELECT COALESCE(BOOL_OR(dni = $2), FALSE)          AS dni_taken,
         COALESCE(BOOL_OR(LOWER(email) = $3), FALSE) AS email_taken
    FROM alumno
   WHERE institucion_id = $1
     AND fecha_eliminacion IS NULL
     AND (dni = $2 OR LOWER(email) = $3)
`;

// Alta: el alumno nace vigente y ACTIVO. Devuelve la fila creada con los campos y el estado de
// FIND_BY_INSTITUTION_SQL.
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

// Valores de alumno_estado.nombre, con los códigos del sistema.
const STATUS_BY_COLUMN_VALUE = {
  ACTIVO: 'ACTIVE',
  EGRESADO: 'GRADUATED',
};

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
  });
}

// Alumnos de la institución, ordenados por apellido y nombre.
async function findByInstitution(institutionId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId]);
  return rows.map(toStudent);
}

// Campos ('dni', 'email') cuyo valor ya tiene un alumno vigente de la institución. Espera el dni
// solo con dígitos y el email normalizado, como se guardan.
async function findTakenFields(institutionId, { dni, email }) {
  const { rows } = await query(FIND_TAKEN_FIELDS_SQL, [institutionId, dni, email]);
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

// Campo ('dni' o 'email') cuyo valor repetido causó `error`, si es una violación de una restricción
// UNIQUE de alumno; si no, null.
function duplicateFieldOf(error) {
  if (error?.code !== '23505') return null;
  return UNIQUE_CONSTRAINT_FIELDS[error.constraint] ?? null;
}

module.exports = { findByInstitution, findTakenFields, create, duplicateFieldOf };
