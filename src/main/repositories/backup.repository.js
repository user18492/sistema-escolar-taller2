const { query, runInTransaction } = require('../database/connection');
const { Backup } = require('../models/backup.model');

// ---------- Historial (tabla respaldo) ----------

// Los backups de la institución $1, del más nuevo al más viejo; respaldo_id desempata, así dos
// consultas sobre los mismos datos dan siempre el mismo orden.
const FIND_ALL_BY_INSTITUTION_SQL = `
  SELECT respaldo_id,
         institucion_id,
         usuario_id,
         usuario_nombre,
         usuario_apellido,
         fecha
    FROM respaldo
   WHERE institucion_id = $1
   ORDER BY fecha DESC, respaldo_id DESC
`;

// Registra un backup de la institución $1, realizado por el usuario $2 ($3 y $4, su nombre y su
// apellido, que se copian: respaldo.usuario_id no tiene clave foránea) en la fecha $5, la de la
// instantánea que guarda el archivo. Devuelve la fila creada.
const CREATE_SQL = `
  INSERT INTO respaldo (institucion_id, usuario_id, usuario_nombre, usuario_apellido, fecha)
  VALUES ($1, $2, $3, $4, $5::TIMESTAMPTZ)
  RETURNING respaldo_id, institucion_id, usuario_id, usuario_nombre, usuario_apellido, fecha
`;

function toBackup(row) {
  return new Backup({
    id: row.respaldo_id,
    institutionId: row.institucion_id,
    userId: row.usuario_id,
    userFirstName: row.usuario_nombre,
    userLastName: row.usuario_apellido,
    createdAt: row.fecha,
  });
}

async function findAllByInstitution(institutionId) {
  const { rows } = await query(FIND_ALL_BY_INSTITUTION_SQL, [institutionId]);
  return rows.map(toBackup);
}

// `user` es { id, firstName, lastName } y `createdAt`, la fecha de la instantánea tal como la
// devuelve readInstitutionSnapshot (texto ISO 8601, con microsegundos y zona horaria).
async function create({ institutionId, user, createdAt }) {
  const { rows } = await query(CREATE_SQL, [institutionId, user.id, user.firstName, user.lastName, createdAt]);
  return toBackup(rows[0]);
}

// ---------- Instantánea de los datos de una institución ----------

// Las tablas que entran en el backup, en el orden en que se cargan (cada una referencia solo a las
// anteriores o a los catálogos), con su clave primaria, que ordena las filas, y la condición que
// las deja en la institución $1. Las que no tienen institucion_id se filtran por su cadena hasta el
// curso: ningún trigger deja referencias entre instituciones (ck_*_misma_institucion, db/schema.sql),
// así que todas sus filas son de la institución de su curso.
const INSTITUTION_TABLES = [
  { name: 'usuario', idColumn: 'usuario_id', where: 't.institucion_id = $1' },
  { name: 'alumno', idColumn: 'alumno_id', where: 't.institucion_id = $1' },
  { name: 'curso', idColumn: 'curso_id', where: 't.institucion_id = $1' },
  {
    name: 'asignacion_docente',
    idColumn: 'asignacion_docente_id',
    where: 't.curso_id IN (SELECT c.curso_id FROM curso c WHERE c.institucion_id = $1)',
  },
  {
    name: 'inscripcion',
    idColumn: 'inscripcion_id',
    where: 't.curso_id IN (SELECT c.curso_id FROM curso c WHERE c.institucion_id = $1)',
  },
  {
    name: 'evaluacion',
    idColumn: 'evaluacion_id',
    where: `t.asignacion_docente_id IN (SELECT a.asignacion_docente_id
                                         FROM asignacion_docente a
                                         JOIN curso c ON c.curso_id = a.curso_id
                                        WHERE c.institucion_id = $1)`,
  },
  {
    name: 'calificacion',
    idColumn: 'calificacion_id',
    where: `t.evaluacion_id IN (SELECT e.evaluacion_id
                                 FROM evaluacion e
                                 JOIN asignacion_docente a ON a.asignacion_docente_id = e.asignacion_docente_id
                                 JOIN curso c ON c.curso_id = a.curso_id
                                WHERE c.institucion_id = $1)`,
  },
];

// Los catálogos globales, que no se respaldan: el archivo lleva una copia para que el restore
// compruebe que la base los tiene iguales.
const CATALOG_TABLES = [
  { name: 'usuario_rol', idColumn: 'usuario_rol_id' },
  { name: 'grado', idColumn: 'grado_id' },
  { name: 'materia', idColumn: 'materia_id' },
  { name: 'grado_materia', idColumn: 'grado_materia_id' },
  { name: 'alumno_estado', idColumn: 'alumno_estado_id' },
  { name: 'inscripcion_estado', idColumn: 'inscripcion_estado_id' },
];

// Todas las columnas de cada fila, en un arreglo JSON ordenado por la clave primaria ('[]' si la
// tabla no tiene ninguna). PostgreSQL serializa las fechas y los TIMESTAMPTZ como texto ISO 8601
// (los TIMESTAMPTZ, con su zona horaria) y los NUMERIC como números JSON, sin conversiones de pg:
// json_populate_recordset los vuelve a leer igual. Los nombres de tabla y de columna son las
// constantes de arriba, nunca datos recibidos.
const rowsSql = ({ name, idColumn, where }) => `
  SELECT COALESCE(json_agg(t ORDER BY t.${idColumn}), '[]') AS rows
    FROM ${name} t
  ${where ? `WHERE ${where}` : ''}
`;

const INSTITUTION_TABLE_SQL = Object.fromEntries(INSTITUTION_TABLES.map((table) => [table.name, rowsSql(table)]));
const CATALOG_TABLE_SQL = Object.fromEntries(CATALOG_TABLES.map((table) => [table.name, rowsSql(table)]));

// Una instantánea coherente: todas las lecturas ven los mismos datos, aunque otra sesión escriba
// en el medio. SET TRANSACTION tiene que ser la primera sentencia de la transacción.
const SNAPSHOT_TRANSACTION_SQL = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY';

// La fecha de la instantánea (NOW() es el inicio de la transacción), como texto ISO 8601 con
// microsegundos y zona horaria, y la institución $1.
const SNAPSHOT_HEADER_SQL = `
  SELECT to_json(NOW()) #>> '{}' AS created_at,
         institucion_id,
         cuit,
         nombre
    FROM institucion
   WHERE institucion_id = $1
`;

// Los nombres de las columnas de las tablas $1, en el orden de la tabla: el restore los compara
// para rechazar un backup de otro esquema.
const COLUMNS_SQL = `
  SELECT table_name,
         json_agg(column_name::TEXT ORDER BY ordinal_position) AS columns
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name = ANY($1)
   GROUP BY table_name
`;

// Lee, en una sola transacción REPEATABLE READ de solo lectura, todo lo que guarda el backup de la
// institución: { createdAt, institution: { id, cuit, name }, columns, catalogs, tables }.
// `columns` lleva, por cada tabla de INSTITUTION_TABLES, los nombres de sus columnas; `catalogs` y
// `tables`, las filas completas de cada catálogo y las de la institución en cada tabla, con todas
// sus columnas (también las dadas de baja y los ids), con los nombres de la base.
// Devuelve null si la institución no existe.
async function readInstitutionSnapshot(institutionId) {
  return runInTransaction(async (transactionQuery) => {
    await transactionQuery(SNAPSHOT_TRANSACTION_SQL);

    const { rows: headerRows } = await transactionQuery(SNAPSHOT_HEADER_SQL, [institutionId]);
    if (headerRows.length === 0) return null;
    const header = headerRows[0];

    const tableNames = INSTITUTION_TABLES.map((table) => table.name);
    const { rows: columnRows } = await transactionQuery(COLUMNS_SQL, [tableNames]);
    const columnsByTable = new Map(columnRows.map((row) => [row.table_name, row.columns]));
    const columns = Object.fromEntries(tableNames.map((name) => [name, columnsByTable.get(name) ?? []]));

    const catalogs = {};
    for (const { name } of CATALOG_TABLES) {
      const { rows } = await transactionQuery(CATALOG_TABLE_SQL[name]);
      catalogs[name] = rows[0].rows;
    }

    const tables = {};
    for (const name of tableNames) {
      const { rows } = await transactionQuery(INSTITUTION_TABLE_SQL[name], [institutionId]);
      tables[name] = rows[0].rows;
    }

    return {
      createdAt: header.created_at,
      institution: { id: header.institucion_id, cuit: header.cuit, name: header.nombre },
      columns,
      catalogs,
      tables,
    };
  });
}

module.exports = { findAllByInstitution, create, readInstitutionSnapshot };
