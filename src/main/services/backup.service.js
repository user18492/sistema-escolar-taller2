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
const FORMAT_VERSION = 1;

// Largo máximo del nombre de la institución en el nombre del archivo.
const SLUG_MAX_LENGTH = 40;

// ---------- Una operación a la vez ----------

// Un backup (o, más adelante, un restore) a la vez en este proceso: mientras corre uno, otro se
// rechaza con BACKUP_IN_PROGRESS en vez de esperar.
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

// El nombre de la institución en minúsculas, sin tildes y con cada tramo de caracteres que no sean
// [a-z0-9] reemplazado por un guion, recortado a SLUG_MAX_LENGTH caracteres y sin guiones en los
// extremos: "Colegio Manuel Belgrano" da "colegio-manuel-belgrano".
function slugify(name) {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug || 'institucion';
}

// <slug>_<cuit>_<AAAA-MM-DD>_<HH-mm-ss>.<zip|tar.gz>, con la fecha y la hora locales de `createdAt`
// (la de la instantánea). Por ejemplo: colegio-manuel-belgrano_30-12345678-9_2026-11-06_15-30-00.zip
function buildFileName(institution, createdAt, format) {
  const date = new Date(createdAt);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${slugify(institution.name)}_${institution.cuit}_${day}_${time}${backupFileRepository.EXTENSIONS[format]}`;
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
async function writeFile(fileName, buffer, format) {
  try {
    await backupFileRepository.write(fileName, buffer, format);
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
// escribe el archivo en la carpeta de backups y lo registra en el historial, con la fecha de la
// instantánea. Si el registro falla, borra el archivo. Devuelve el backup como en list, con el
// nombre del archivo en `fileName`. Lanza un BackupError BACKUP_IN_PROGRESS si ya hay uno en curso,
// y los de writeFile.
async function create(user, format) {
  return runExclusive(async () => {
    const snapshot = await backupRepository.readInstitutionSnapshot(user.institutionId);
    if (!snapshot) throw new Error(`No existe la institución ${user.institutionId}`);

    const createdBy = creatorOf(user, snapshot);
    const fileName = buildFileName(snapshot.institution, snapshot.createdAt, format);
    const buffer = Buffer.from(JSON.stringify(buildContent(snapshot, createdBy)), 'utf8');
    await writeFile(fileName, buffer, format);

    let backup;
    try {
      backup = await backupRepository.create({
        institutionId: user.institutionId,
        user: createdBy,
        createdAt: snapshot.createdAt,
      });
    } catch (error) {
      await backupFileRepository.remove(fileName).catch((removeError) => {
        console.error('Error al borrar el archivo de un backup que no se pudo registrar:', removeError);
      });
      throw error;
    }
    return { ...toListedBackup(backup), fileName };
  });
}

module.exports = { BackupError, FORMATS, list, create };
