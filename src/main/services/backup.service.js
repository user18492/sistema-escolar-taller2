const path = require('node:path');
const { dialog } = require('electron');
const backupRepository = require('../repositories/backup.repository');
const backupFileRepository = require('../repositories/backup-file.repository');

// Error previsto, con un mensaje apto para la UI (como CourseError en course.service.js).
class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

// Formatos de compresión aceptados: 'zip' y 'tar.gz'.
const { FORMATS } = backupFileRepository;

// Versión del contenido de backup.json: cambia si cambia su forma, para que el restore rechace los
// archivos que no sabe leer.
const FORMAT_VERSION = 2;

// ---------- Una operación a la vez ----------

// Una operación a la vez en este proceso (un backup, la elección del archivo a restaurar o un
// restore): mientras corre una, otra se rechaza con BACKUP_IN_PROGRESS en vez de esperar.
let operationInProgress = false;

async function runExclusive(operation) {
  if (operationInProgress) {
    throw new BackupError(
      'BACKUP_IN_PROGRESS',
      'Ya hay un backup o una restauración en curso. Esperá a que termine e intentá nuevamente.'
    );
  }
  operationInProgress = true;
  try {
    return await operation();
  } finally {
    operationInProgress = false;
  }
}

// ---------- Nombre del archivo ----------

const pad = (value) => String(value).padStart(2, '0');

// <institucion_id>_<usuario_id>_<AAAA-MM-DD>_<HH-mm-ss>.<zip|tar.gz>, con los ids de la institución
// y de quien lo realiza, y la fecha y la hora locales de `createdAt` (la de la instantánea). Por
// ejemplo: 2_15_2026-11-07_15-30-00.zip. Sin el nombre ni el CUIT de la institución ni el nombre del
// usuario: mirar la carpeta no revela qué instituciones hay ni datos personales (quién lo realizó se
// ve en el historial y en backup.json). El id de la institución repite el de la subcarpeta, pero
// identifica el archivo si se lo mueve de lugar.
function buildFileName(institutionId, userId, createdAt, format) {
  const date = new Date(createdAt);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${institutionId}_${userId}_${day}_${time}${backupFileRepository.EXTENSIONS[format]}`;
}

// ---------- Contenido del archivo ----------

// Quien realiza el backup, con el nombre y el apellido de la instantánea (los de la sesión, si por
// algún motivo no estuviera en ella).
function creatorOf(user, snapshot) {
  const row = snapshot.tables.usuario.find((usuario) => usuario.usuario_id === user.id);
  return {
    id: user.id,
    firstName: row?.nombre ?? user.firstName,
    lastName: row?.apellido ?? user.lastName,
  };
}

function buildContent(snapshot, createdBy) {
  return {
    formatVersion: FORMAT_VERSION,
    createdAt: snapshot.createdAt,
    institution: snapshot.institution,
    createdBy,
    columns: snapshot.columns,
    catalogs: snapshot.catalogs,
    tables: snapshot.tables,
  };
}

// ---------- Historial ----------

// Lista explícita de campos, como toListedCourse (course.service.js): lo que se muestra de un backup.
function toListedBackup(backup) {
  return {
    id: backup.id,
    userName: `${backup.userFirstName} ${backup.userLastName}`,
    createdAt: backup.createdAt.toISOString(),
  };
}

// Los backups de la institución de `user`, del más nuevo al más viejo.
async function list(user) {
  const backups = await backupRepository.findAllByInstitution(user.institutionId);
  return backups.map(toListedBackup);
}

// Escribe el archivo y traduce los errores del disco: BACKUP_FILE_EXISTS si ya hay un backup con ese
// nombre (dos en el mismo segundo) y BACKUP_WRITE_FAILED si no se pudo escribir en la carpeta.
async function writeFile(institutionId, fileName, buffer, format) {
  try {
    await backupFileRepository.write(institutionId, fileName, buffer, format);
  } catch (error) {
    if (backupFileRepository.isFileExistsError(error)) {
      throw new BackupError(
        'BACKUP_FILE_EXISTS',
        'Ya existe un backup con el mismo nombre. Esperá unos segundos e intentá nuevamente.'
      );
    }
    if (backupFileRepository.isFileSystemError(error)) {
      console.error('Error al escribir el archivo del backup:', error);
      throw new BackupError(
        'BACKUP_WRITE_FAILED',
        'No se pudo guardar el archivo del backup. Revisá el espacio disponible en el disco e intentá nuevamente.'
      );
    }
    throw error;
  }
}

// Backup completo de la institución de `user` en `format` (uno de FORMATS): lee la instantánea,
// escribe el archivo en la carpeta de backups de la institución y lo registra en el historial, con la fecha de la
// instantánea. Si el registro falla, borra el archivo. Devuelve el backup como en list, con el
// nombre del archivo en `fileName`. Lanza un BackupError BACKUP_IN_PROGRESS si ya hay uno en curso,
// y los de writeFile.
async function create(user, format) {
  return runExclusive(async () => {
    const snapshot = await backupRepository.readInstitutionSnapshot(user.institutionId);
    if (!snapshot) throw new Error(`No existe la institución ${user.institutionId}`);

    const createdBy = creatorOf(user, snapshot);
    const fileName = buildFileName(user.institutionId, user.id, snapshot.createdAt, format);
    const buffer = Buffer.from(JSON.stringify(buildContent(snapshot, createdBy)), 'utf8');
    await writeFile(user.institutionId, fileName, buffer, format);

    let backup;
    try {
      backup = await backupRepository.create({
        institutionId: user.institutionId,
        user: createdBy,
        createdAt: snapshot.createdAt,
      });
    } catch (error) {
      await backupFileRepository.remove(user.institutionId, fileName).catch((removeError) => {
        console.error('Error al borrar el archivo de un backup que no se pudo registrar:', removeError);
      });
      throw error;
    }
    return { ...toListedBackup(backup), fileName };
  });
}

// ---------- Restore: validación del archivo ----------

const INVALID_FILE_MESSAGE = 'El archivo elegido no es un backup válido del sistema.';
const INCOMPATIBLE_MESSAGE = 'El backup es de otra versión del sistema o de otra base de datos.';
const OTHER_INSTITUTION_MESSAGE = 'El backup pertenece a otra institución.';

const invalidFile = (message = INVALID_FILE_MESSAGE) => new BackupError('BACKUP_INVALID_FILE', message);
const incompatible = () => new BackupError('BACKUP_INCOMPATIBLE', INCOMPATIBLE_MESSAGE);

const { INSTITUTION_TABLE_NAMES, CATALOG_TABLE_NAMES } = backupRepository;

// Valor de usuario_rol.nombre de los administradores.
const ADMIN_ROLE = 'ADMIN';

// Las tablas del backup que llevan institucion_id: todas sus filas tienen que ser de la institución
// del archivo.
const TABLES_WITH_INSTITUTION = ['usuario', 'alumno', 'curso'];

// Las referencias entre las tablas del backup: cada fila de `table` apunta, con `column`, a una fila
// de `target` que también está en el archivo. Sin esto, un archivo modificado a mano podría cargar
// filas que apunten a otra institución: mientras dura la carga, los triggers que lo impiden están
// deshabilitados y las claves foráneas solo comprueban que la fila exista.
const REFERENCES = [
  { table: 'asignacion_docente', column: 'usuario_id', target: 'usuario' },
  { table: 'asignacion_docente', column: 'curso_id', target: 'curso' },
  { table: 'inscripcion', column: 'alumno_id', target: 'alumno' },
  { table: 'inscripcion', column: 'curso_id', target: 'curso' },
  { table: 'evaluacion', column: 'asignacion_docente_id', target: 'asignacion_docente' },
  { table: 'calificacion', column: 'evaluacion_id', target: 'evaluacion' },
  { table: 'calificacion', column: 'inscripcion_id', target: 'inscripcion' },
  { table: 'seguimiento_alumno', column: 'asignacion_docente_id', target: 'asignacion_docente' },
  { table: 'seguimiento_alumno', column: 'inscripcion_id', target: 'inscripcion' },
];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRowList = (value) => Array.isArray(value) && value.every(isPlainObject);
const isText = (value) => typeof value === 'string' && value.length > 0;
const hasAll = (object, names, isValid) => isPlainObject(object) && names.every((name) => isValid(object[name]));
const isColumnList = (value) => Array.isArray(value) && value.every(isText);
const idColumnOf = (table) => `${table}_id`;
const includedTables = ({ formatVersion }) => formatVersion === 1
  ? INSTITUTION_TABLE_NAMES.filter((name) => name !== 'seguimiento_alumno')
  : INSTITUTION_TABLE_NAMES;

// Regla 1: el formato es el que escribe create, con todas sus claves.
function hasBackupShape(content) {
  return (
    isPlainObject(content)
    && [1, FORMAT_VERSION].includes(content.formatVersion)
    && isText(content.createdAt) && !Number.isNaN(Date.parse(content.createdAt))
    && isPlainObject(content.institution) && Number.isInteger(content.institution.id) && isText(content.institution.cuit)
    && isText(content.institution.name)
    && isPlainObject(content.createdBy) && Number.isInteger(content.createdBy.id) && typeof content.createdBy.firstName === 'string'
    && typeof content.createdBy.lastName === 'string'
    && hasAll(content.columns, includedTables(content), isColumnList)
    && hasAll(content.catalogs, CATALOG_TABLE_NAMES, isRowList)
    && hasAll(content.tables, includedTables(content), isRowList)
  );
}

// Las filas de las tablas son de la institución del archivo y solo se referencian entre ellas
// (parte de la regla 1).
function hasConsistentRows(content) {
  const { tables } = content;
  const tableNames = includedTables(content);
  const idsOf = new Map(tableNames.map((table) => [table, new Set(tables[table].map((row) => row[idColumnOf(table)]))]));
  return (
    tableNames.every((table) => tables[table].every((row) => Number.isInteger(row[idColumnOf(table)])))
    && TABLES_WITH_INSTITUTION.every((table) => tables[table].every((row) => row.institucion_id === content.institution.id))
    && REFERENCES.every(({ table, column, target }) =>
      !idsOf.has(table) || tables[table].every((row) => idsOf.get(target).has(row[column])))
  );
}

// Dos filas de un catálogo, con las mismas columnas y los mismos valores.
function isSameRow(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.hasOwn(b, key) && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

// Regla 3: las columnas de las tablas incluidas son las de la base, tabla por tabla y en orden, y cada fila
// de los catálogos del archivo está igual en la base (la base puede tener filas de más).
function isCompatible(content, reference) {
  const sameColumns = includedTables(content).every((table) => {
    const current = reference.columns[table];
    const fromFile = content.columns[table];
    return current.length === fromFile.length && current.every((column, index) => column === fromFile[index]);
  });
  if (!sameColumns) return false;
  return CATALOG_TABLE_NAMES.every((table) => {
    const idColumn = idColumnOf(table);
    const currentById = new Map(reference.catalogs[table].map((row) => [row[idColumn], row]));
    return content.catalogs[table].every((row) => currentById.has(row[idColumn]) && isSameRow(row, currentById.get(row[idColumn])));
  });
}

// Regla 4: hay al menos un administrador activo y vigente, para poder ingresar después del restore.
// El rol se busca en el catálogo de la base, que ya se comprobó igual al del archivo.
function hasActiveAdmin(content, reference) {
  const adminRole = reference.catalogs.usuario_rol.find((row) => row.nombre === ADMIN_ROLE);
  return Boolean(adminRole) && content.tables.usuario.some((row) =>
    row.usuario_rol_id === adminRole.usuario_rol_id && row.estado === true && row.fecha_eliminacion === null);
}

// Comprueba que el contenido de un backup (`content`, el backup.json ya interpretado) se puede
// restaurar en la institución de `reference` (lo que devuelve backupRepository.readRestoreReference
// para la institución de la sesión), con las reglas en orden: el formato (BACKUP_INVALID_FILE), la
// institución (BACKUP_OTHER_INSTITUTION, con un mensaje genérico), el esquema y los
// catálogos (BACKUP_INCOMPATIBLE), las filas de la institución del archivo y referenciadas entre
// ellas (BACKUP_INVALID_FILE) y un administrador activo y vigente (BACKUP_INVALID_FILE). Lanza
// el BackupError de la primera que no se cumple. La usan selectFile y, otra vez dentro de la
// transacción, restore.
function validateContent(content, reference) {
  if (!hasBackupShape(content)) throw invalidFile();
  const { institution } = reference;
  if (!institution) throw new Error('No existe la institución de la sesión');
  if (content.institution.id !== institution.id || content.institution.cuit !== institution.cuit) {
    // Sin el nombre ni el CUIT de la institución del archivo: el mensaje no confirma datos de otra
    // institución a quien eligió el archivo.
    throw new BackupError('BACKUP_OTHER_INSTITUTION', OTHER_INSTITUTION_MESSAGE);
  }
  if (!isCompatible(content, reference)) throw incompatible();
  if (!hasConsistentRows(content)) throw invalidFile();
  if (!hasActiveAdmin(content, reference)) {
    throw invalidFile('El backup no tiene ningún administrador activo: después de restaurarlo nadie podría ingresar.');
  }
}

// ---------- Restore: elección del archivo y carga ----------

// El backup elegido con selectFile, que restore carga: { userId, data }, con el usuario de la sesión
// que lo eligió y el contenido ya validado. null si no hay ninguno. Vive en memoria del proceso
// principal: cada elección reemplaza a la anterior.
let pendingSelection = null;

const DIALOG_OPTIONS = {
  title: 'Elegí el backup a restaurar',
  properties: ['openFile'],
  filters: [{ name: 'Backups', extensions: ['zip', 'gz'] }],
};

// Lee y valida el backup `filePath` para la institución de `user`, y lo deja como la selección
// pendiente. Devuelve { fileName, createdAt, userName }: el nombre del archivo, la fecha de la
// instantánea (ISO 8601) y el nombre y el apellido de quien lo realizó. Lanza los BackupError de
// validateContent.
async function selectPath(user, filePath) {
  let content;
  try {
    content = await backupFileRepository.read(filePath);
  } catch (error) {
    if (error instanceof backupFileRepository.BackupFileReadError) throw invalidFile();
    throw error;
  }
  validateContent(content, await backupRepository.readRestoreReference(user.institutionId));
  pendingSelection = { userId: user.id, data: content };
  return {
    fileName: path.basename(filePath),
    createdAt: content.createdAt,
    userName: `${content.createdBy.firstName} ${content.createdBy.lastName}`.trim(),
  };
}

// Abre sobre `browserWindow` el diálogo para elegir un backup, en la carpeta de backups de la
// institución de `user`, y lo lee y lo valida (selectPath). El diálogo permite subir a otra carpeta:
// un archivo de otra institución lo rechaza validateContent. Devuelve null si se cancela, y si no, lo que devuelve selectPath. Una
// elección nueva, aunque se cancele o falle, descarta la anterior. Lanza un BackupError
// BACKUP_IN_PROGRESS si ya hay un backup o una restauración en curso, y los de selectPath.
async function selectFile(user, browserWindow) {
  return runExclusive(async () => {
    pendingSelection = null;
    const defaultPath = await backupFileRepository.ensureDirectory(user.institutionId);
    const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow, { ...DIALOG_OPTIONS, defaultPath });
    if (canceled || !filePaths?.length) return null;
    return selectPath(user, filePaths[0]);
  });
}

// Reemplaza los datos de la institución de `user` por los del backup que eligió con selectFile,
// validándolo otra vez contra la base dentro de la transacción. Si sale bien, descarta la selección;
// la sesión la cierra quien llama. No se registra en el historial. Lanza un BackupError:
// BACKUP_IN_PROGRESS; BACKUP_NO_SELECTION si no hay un backup elegido por este usuario;
// BACKUP_BUSY si otra sesión tiene bloqueadas las tablas más de 10 segundos; BACKUP_INCOMPATIBLE si
// otra institución ya tiene alguno de sus ids (la base se recreó), y los de validateContent.
async function restore(user) {
  return runExclusive(async () => {
    const selection = pendingSelection;
    if (!selection || selection.userId !== user.id) {
      throw new BackupError('BACKUP_NO_SELECTION', 'No hay un backup elegido para restaurar. Elegí el archivo nuevamente.');
    }
    try {
      await backupRepository.replaceInstitutionData(user.institutionId, selection.data, (reference) =>
        validateContent(selection.data, reference));
    } catch (error) {
      if (backupRepository.isLockTimeoutError(error)) {
        throw new BackupError('BACKUP_BUSY', 'La base está en uso, intentá nuevamente en unos segundos.');
      }
      if (backupRepository.isPrimaryKeyError(error)) throw incompatible();
      throw error;
    }
    if (pendingSelection === selection) pendingSelection = null;
  });
}

module.exports = { BackupError, FORMATS, list, create, selectFile, restore };
