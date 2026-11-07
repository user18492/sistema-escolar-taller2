const { query, runInTransaction } = require('../database/connection');
const { Backup } = require('../models/backup.model');
const { finalizeActiveInClosedSchoolYears } = require('./enrollment.repository');

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

const INSTITUTION_TABLE_NAMES = INSTITUTION_TABLES.map((table) => table.name);
const CATALOG_TABLE_NAMES = CATALOG_TABLES.map((table) => table.name);

// Por cada tabla de INSTITUTION_TABLES, los nombres de sus columnas en el orden de la tabla.
async function readColumns(runQuery) {
  const { rows } = await runQuery(COLUMNS_SQL, [INSTITUTION_TABLE_NAMES]);
  const columnsByTable = new Map(rows.map((row) => [row.table_name, row.columns]));
  return Object.fromEntries(INSTITUTION_TABLE_NAMES.map((name) => [name, columnsByTable.get(name) ?? []]));
}

// Las filas completas de cada catálogo de CATALOG_TABLES.
async function readCatalogs(runQuery) {
  const catalogs = {};
  for (const name of CATALOG_TABLE_NAMES) {
    const { rows } = await runQuery(CATALOG_TABLE_SQL[name]);
    catalogs[name] = rows[0].rows;
  }
  return catalogs;
}

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

    const columns = await readColumns(transactionQuery);
    const catalogs = await readCatalogs(transactionQuery);

    const tables = {};
    for (const name of INSTITUTION_TABLE_NAMES) {
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

// ---------- Restore ----------

// La institución $1, para comparar la del backup con la de la sesión.
const INSTITUTION_SQL = `
  SELECT institucion_id, cuit, nombre
    FROM institucion
   WHERE institucion_id = $1
`;

// Lo que el restore compara con un backup antes de cargarlo: { institution, columns, catalogs },
// con la institución $1 ({ id, cuit, name }, o null si no existe) y las columnas y los catálogos
// actuales, en la misma forma que readInstitutionSnapshot. `runQuery` es `query` o la función de una
// transacción.
async function readRestoreReference(institutionId, runQuery = query) {
  const { rows } = await runQuery(INSTITUTION_SQL, [institutionId]);
  const institution = rows.length > 0 ? { id: rows[0].institucion_id, cuit: rows[0].cuit, name: rows[0].nombre } : null;
  return { institution, columns: await readColumns(runQuery), catalogs: await readCatalogs(runQuery) };
}

// Si otra sesión tiene bloqueada alguna de las tablas (o filas que hay que borrar), el restore la
// espera hasta 10 segundos y después se cancela con el código 55P03 (isLockTimeoutError).
const LOCK_TIMEOUT_SQL = `SET LOCAL lock_timeout = '10s'`;
const LOCK_NOT_AVAILABLE = '55P03';

// Los nombres de tabla son las constantes de INSTITUTION_TABLES, nunca datos recibidos.
const DISABLE_TRIGGERS_SQL = Object.fromEntries(INSTITUTION_TABLE_NAMES.map((name) => [name, `ALTER TABLE ${name} DISABLE TRIGGER USER`]));
const ENABLE_TRIGGERS_SQL = Object.fromEntries(INSTITUTION_TABLE_NAMES.map((name) => [name, `ALTER TABLE ${name} ENABLE TRIGGER USER`]));

// Borra las filas de la institución $1, con la misma condición que las lee el backup.
const DELETE_SQL = Object.fromEntries(INSTITUTION_TABLES.map(({ name, where }) => [name, `DELETE FROM ${name} t WHERE ${where}`]));

// Carga las filas $1 (un arreglo JSON con las columnas de la tabla, como las guarda el backup) con
// sus ids: OVERRIDING SYSTEM VALUE deja fijar las claves GENERATED ALWAYS AS IDENTITY.
const INSERT_SQL = Object.fromEntries(INSTITUTION_TABLE_NAMES.map((name) => [name, `
  INSERT INTO ${name} OVERRIDING SYSTEM VALUE
  SELECT * FROM json_populate_recordset(NULL::${name}, $1::JSON)
`]));

// Resguardo: deja la secuencia de la clave en el mayor id de la tabla, sin hacerla retroceder.
// setval es estricta: si la tabla está vacía y la secuencia nunca se usó, GREATEST da NULL y no la
// cambia.
const RESET_SEQUENCE_SQL = Object.fromEntries(INSTITUTION_TABLES.map(({ name, idColumn }) => [name, `
  SELECT setval(seq.name, GREATEST((SELECT MAX(t.${idColumn}) FROM ${name} t), s.last_value))
    FROM (SELECT pg_get_serial_sequence('${name}', '${idColumn}')::REGCLASS AS name) seq
    LEFT JOIN pg_sequences s ON format('%I.%I', s.schemaname, s.sequencename)::REGCLASS = seq.name
`]));

// Reemplaza los datos de la institución $1 en las 7 tablas de INSTITUTION_TABLES por los de `data`
// (el contenido de un backup: data.tables, en la forma de readInstitutionSnapshot), todo en una sola
// transacción: cualquier error la deshace por completo, incluido el DISABLE TRIGGER. `validate`
// recibe lo que devuelve readRestoreReference, leído dentro de la transacción, y lanza un error si
// el backup ya no se puede cargar en esta base: así la comprobación es la del momento del restore y
// no la de cuando se eligió el archivo. Al terminar, pasa a FINALIZADA las inscripciones activas de
// los ciclos ya cerrados, como al iniciar la aplicación. La tabla respaldo no se toca.
// Lanza el error de PostgreSQL tal cual: isLockTimeoutError y isPrimaryKeyError reconocen los
// previstos.
async function replaceInstitutionData(institutionId, data, validate) {
  return runInTransaction(async (transactionQuery) => {
    await transactionQuery(LOCK_TIMEOUT_SQL);
    validate(await readRestoreReference(institutionId, transactionQuery));

    // Los triggers de usuario de las 7 tablas se deshabilitan mientras dura la carga: los del ciclo
    // lectivo y los de coherencia rechazarían el historial (cursos de ciclos cerrados, inscripciones
    // finalizadas, asignaciones de profesores suspendidos o dados de baja, filas dadas de baja), que
    // ya los cumplía cuando se hizo el backup. DISABLE TRIGGER USER no toca los triggers internos de
    // las claves foráneas, así que estas, los CHECK y los índices únicos siguen validando cada fila.
    // Requisitos y efectos: DB_USER tiene que ser el dueño de las tablas (db/setup-db crea el esquema
    // con ese usuario); el cambio es parte de la transacción (un error lo deshace), y su bloqueo
    // (SHARE ROW EXCLUSIVE) deja en espera las escrituras de las otras instituciones en esas tablas
    // hasta que termina el restore. Ninguna de las tablas tiene triggers de DELETE.
    for (const name of INSTITUTION_TABLE_NAMES) await transactionQuery(DISABLE_TRIGGERS_SQL[name]);

    // Las que referencian a otras primero, y la carga en el orden inverso
    for (const name of [...INSTITUTION_TABLE_NAMES].reverse()) await transactionQuery(DELETE_SQL[name], [institutionId]);
    for (const name of INSTITUTION_TABLE_NAMES) await transactionQuery(INSERT_SQL[name], [JSON.stringify(data.tables[name])]);

    // Los ids del backup se conservan: las secuencias nunca retroceden y las filas no cambian de
    // institución, así que la otra institución no puede tener esos ids, salvo que la base se haya
    // recreado (la clave primaria lo rechaza: isPrimaryKeyError).
    for (const name of INSTITUTION_TABLE_NAMES) await transactionQuery(RESET_SEQUENCE_SQL[name]);

    for (const name of INSTITUTION_TABLE_NAMES) await transactionQuery(ENABLE_TRIGGERS_SQL[name]);

    // Un backup de un ciclo que ya cerró deja inscripciones activas en ese ciclo
    await finalizeActiveInClosedSchoolYears(transactionQuery);
  });
}

// true si `error` es el vencimiento de LOCK_TIMEOUT_SQL: otra sesión tenía bloqueado lo que el
// restore necesitaba.
function isLockTimeoutError(error) {
  return error?.code === LOCK_NOT_AVAILABLE;
}

// true si `error` es una clave primaria repetida (pk_* en db/schema.sql) al cargar las filas de un
// backup: otra institución ya tiene ese id.
function isPrimaryKeyError(error) {
  return error?.code === '23505' && typeof error.constraint === 'string' && error.constraint.startsWith('pk_');
}

module.exports = {
  INSTITUTION_TABLE_NAMES,
  CATALOG_TABLE_NAMES,
  findAllByInstitution,
  create,
  readInstitutionSnapshot,
  readRestoreReference,
  replaceInstitutionData,
  isLockTimeoutError,
  isPrimaryKeyError,
};
