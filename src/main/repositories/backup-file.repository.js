const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const tar = require('tar');

// Los archivos de backup se guardan en la carpeta de datos de la aplicación (userData), como las
// fotos de perfil: cada PC ve solo los backups realizados desde ella. Dentro, cada institución tiene
// su subcarpeta, backups/<institucion_id>/: varias instituciones gestionadas desde la misma PC no
// mezclan sus archivos. Ordena los archivos, no los protege: el restore acepta cualquier ruta y
// rechaza los de otra institución por su contenido (validateContent en backup.service.js).
const DIRECTORY_NAME = 'backups';

// Única entrada de cada archivo: el JSON que arma backup.service.js.
const ENTRY_NAME = 'backup.json';

// Formatos de compresión aceptados, con la extensión de su archivo.
const EXTENSIONS = { zip: '.zip', 'tar.gz': '.tar.gz' };
const FORMATS = Object.keys(EXTENSIONS);

// Prefijo de la carpeta temporal donde se arma un TAR.GZ, dentro de la carpeta temporal del sistema
// (como en pdf.service.js).
const TEMP_DIRECTORY_PREFIX = 'backup-';

// Extensión del archivo a medio escribir: recién completo se renombra al nombre definitivo.
const PARTIAL_SUFFIX = '.tmp';

// La carpeta de backups de la institución `institutionId`. El id forma parte de la ruta: si no es
// un entero positivo, lanza un error en vez de armar una ruta fuera de la carpeta de backups.
function getDirectory(institutionId) {
  if (!Number.isInteger(institutionId) || institutionId <= 0) {
    throw new Error(`Id de institución inválido para la carpeta de backups: ${institutionId}`);
  }
  return path.join(app.getPath('userData'), DIRECTORY_NAME, String(institutionId));
}

// Crea la carpeta de backups de la institución `institutionId` si no existe y devuelve su ruta.
async function ensureDirectory(institutionId) {
  const directory = getDirectory(institutionId);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Error del sistema de archivos con el código de Node `EEXIST`, como el de fs.writeFile con
// flag 'wx', para que backup.service.js lo reconozca con isFileExistsError.
function fileExistsError(filePath) {
  const error = new Error(`Ya existe el archivo ${filePath}`);
  error.code = 'EEXIST';
  error.path = filePath;
  return error;
}

function isFileExistsError(error) {
  return error?.code === 'EEXIST';
}

// Un error del sistema de archivos (permiso denegado, disco lleno, carpeta inaccesible…), como los
// que lanza fs: traen la llamada que falló en `syscall`.
function isFileSystemError(error) {
  return typeof error?.syscall === 'string' || isFileExistsError(error);
}

async function writeZip(partialPath, buffer) {
  const zip = new AdmZip();
  zip.addFile(ENTRY_NAME, buffer);
  await fs.writeFile(partialPath, zip.toBuffer());
}

// tar empaqueta archivos del disco: el JSON se escribe en una carpeta temporal propia, que se borra
// al terminar, salga bien o mal.
async function writeTarGz(partialPath, buffer) {
  const directory = await fs.mkdtemp(path.join(app.getPath('temp'), TEMP_DIRECTORY_PREFIX));
  try {
    await fs.writeFile(path.join(directory, ENTRY_NAME), buffer);
    await tar.c({ gzip: true, file: partialPath, cwd: directory }, [ENTRY_NAME]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const WRITERS = { zip: writeZip, 'tar.gz': writeTarGz };

// Guarda `buffer` (el contenido de backup.json) comprimido en `format` (uno de FORMATS) como
// `fileName` en la carpeta de backups de la institución `institutionId`, que se crea si no existe,
// y devuelve la ruta del archivo.
// Escribe primero `<fileName>.tmp` y lo renombra al terminar: un fallo no deja un archivo a medias
// con un nombre válido. Nunca reemplaza un backup: si `fileName` ya existe, lanza un error que
// reconoce isFileExistsError. Los errores del disco salen como los lanza fs (isFileSystemError).
async function write(institutionId, fileName, buffer, format) {
  const directory = await ensureDirectory(institutionId);
  const filePath = path.join(directory, fileName);
  const partialPath = filePath + PARTIAL_SUFFIX;

  if (await exists(filePath)) throw fileExistsError(filePath);

  try {
    await WRITERS[format](partialPath, buffer);
    // fs.rename reemplaza el destino sin avisar: se vuelve a comprobar justo antes.
    if (await exists(filePath)) throw fileExistsError(filePath);
    await fs.rename(partialPath, filePath);
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    throw error;
  }
  return filePath;
}

// Borra el backup `fileName` de la carpeta de backups de la institución `institutionId`. No falla
// si ya no existe.
async function remove(institutionId, fileName) {
  await fs.rm(path.join(getDirectory(institutionId), fileName), { force: true });
}

// ---------- Lectura ----------

// Tamaño máximo de backup.json sin descomprimir: un archivo más grande no se lee (no es un backup
// del sistema, o es uno armado para agotar la memoria).
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

// El archivo no se pudo leer como un backup: no es un ZIP ni un TAR.GZ válido, no tiene
// backup.json, este pasa de MAX_ENTRY_BYTES o no es un JSON. Lo lanza read.
class BackupFileReadError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'BackupFileReadError';
  }
}

// La ruta de una entrada de un TAR, sin el "./" inicial que agregan algunas herramientas.
const entryPath = (name) => name.replace(/^\.\//, '');

// adm-zip lee el índice del ZIP sin descomprimir nada: el tamaño declarado se comprueba antes, y el
// descomprimido, después, por si el índice miente.
async function readZipEntry(filePath) {
  const zip = new AdmZip(await fs.readFile(filePath));
  const entry = zip.getEntries().find((zipEntry) => !zipEntry.isDirectory && zipEntry.entryName === ENTRY_NAME);
  if (!entry) return null;
  if (entry.header.size > MAX_ENTRY_BYTES) throw new BackupFileReadError(`${ENTRY_NAME} pasa de ${MAX_ENTRY_BYTES} bytes`);
  const buffer = entry.getData();
  if (buffer.length > MAX_ENTRY_BYTES) throw new BackupFileReadError(`${ENTRY_NAME} pasa de ${MAX_ENTRY_BYTES} bytes`);
  return buffer;
}

// tar.t recorre las entradas sin escribir nada en el disco: solo se juntan en memoria los datos de
// backup.json, y se dejan de juntar si pasan de MAX_ENTRY_BYTES. `strict` convierte en errores las
// advertencias de un archivo dañado, que si no se ignorarían.
async function readTarGzEntry(filePath) {
  let chunks = null;
  let size = 0;
  let tooLarge = false;
  await tar.t({
    file: filePath,
    strict: true,
    onReadEntry: (entry) => {
      if (entry.type !== 'File' || entryPath(entry.path) !== ENTRY_NAME || chunks) return;
      if (entry.size > MAX_ENTRY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks = [];
      entry.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_ENTRY_BYTES) tooLarge = true;
        else chunks.push(chunk);
      });
    },
  });
  if (tooLarge) throw new BackupFileReadError(`${ENTRY_NAME} pasa de ${MAX_ENTRY_BYTES} bytes`);
  return chunks ? Buffer.concat(chunks) : null;
}

const READERS = { zip: readZipEntry, 'tar.gz': readTarGzEntry };

// El formato del archivo `filePath` por su extensión (sin distinguir mayúsculas), o null si no es
// la de ninguno de FORMATS.
function formatOf(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return FORMATS.find((format) => name.endsWith(EXTENSIONS[format])) ?? null;
}

// Lee el backup `filePath` (cualquier ruta, no solo de la carpeta de backups): según su extensión,
// lo descomprime como ZIP o como TAR.GZ, toma solo la entrada backup.json (el resto se ignora) y
// devuelve su contenido ya interpretado como JSON, sin comprobar su forma. Cualquier fallo, incluido
// el de leer el archivo del disco, lanza un BackupFileReadError, con el error original en `cause`.
async function read(filePath) {
  const format = formatOf(filePath);
  if (!format) throw new BackupFileReadError(`La extensión de ${filePath} no es la de un backup`);
  let buffer;
  try {
    buffer = await READERS[format](filePath);
  } catch (error) {
    if (error instanceof BackupFileReadError) throw error;
    throw new BackupFileReadError(`No se pudo leer ${filePath}`, error);
  }
  if (!buffer) throw new BackupFileReadError(`${filePath} no tiene ${ENTRY_NAME}`);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new BackupFileReadError(`${ENTRY_NAME} no es un JSON válido`, error);
  }
}

module.exports = {
  FORMATS,
  EXTENSIONS,
  ENTRY_NAME,
  BackupFileReadError,
  getDirectory,
  ensureDirectory,
  write,
  remove,
  read,
  isFileExistsError,
  isFileSystemError,
};
