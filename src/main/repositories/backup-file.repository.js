const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const tar = require('tar');

// Los archivos de backup se guardan en la carpeta de datos de la aplicación (userData), como las
// fotos de perfil: cada PC ve solo los backups realizados desde ella.
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

function getDirectory() {
  return path.join(app.getPath('userData'), DIRECTORY_NAME);
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
// `fileName` en la carpeta de backups, que se crea si no existe, y devuelve la ruta del archivo.
// Escribe primero `<fileName>.tmp` y lo renombra al terminar: un fallo no deja un archivo a medias
// con un nombre válido. Nunca reemplaza un backup: si `fileName` ya existe, lanza un error que
// reconoce isFileExistsError. Los errores del disco salen como los lanza fs (isFileSystemError).
async function write(fileName, buffer, format) {
  const directory = getDirectory();
  const filePath = path.join(directory, fileName);
  const partialPath = filePath + PARTIAL_SUFFIX;

  await fs.mkdir(directory, { recursive: true });
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

// Borra el backup `fileName` de la carpeta de backups. No falla si ya no existe.
async function remove(fileName) {
  await fs.rm(path.join(getDirectory(), fileName), { force: true });
}

module.exports = {
  FORMATS,
  EXTENSIONS,
  ENTRY_NAME,
  getDirectory,
  write,
  remove,
  isFileExistsError,
  isFileSystemError,
};
