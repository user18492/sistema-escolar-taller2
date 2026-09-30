const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

// Las fotos de perfil se guardan como archivos en la carpeta de datos de la aplicación (userData),
// como la cuenta recordada, y usuarios.imagen_url guarda solo el nombre del archivo. Si varias PCs
// usan la misma base, cada una ve solo las fotos subidas desde ella.
const DIRECTORY_NAME = 'profile-images';

// Nombre que genera save(): un UUID en minúsculas con extensión .jpg. Cualquier otro valor de
// imagen_url no se resuelve ni se borra.
const STORED_FILE_NAME_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jpg$/;

function getDirectory() {
  return path.join(app.getPath('userData'), DIRECTORY_NAME);
}

function isStoredFileName(name) {
  return typeof name === 'string' && STORED_FILE_NAME_PATTERN.test(name);
}

// Ruta absoluta del archivo, o null si el nombre no es uno generado por save().
function getFilePath(fileName) {
  return isStoredFileName(fileName) ? path.join(getDirectory(), fileName) : null;
}

// Guarda `buffer` (un JPEG) con un nombre nuevo y lo devuelve. Nunca sobrescribe: cada foto tiene
// su propio archivo, así una URL nueva no muestra la foto anterior desde la caché.
async function save(buffer) {
  const fileName = `${crypto.randomUUID()}.jpg`;
  await fs.mkdir(getDirectory(), { recursive: true });
  await fs.writeFile(path.join(getDirectory(), fileName), buffer, { flag: 'wx' });
  return fileName;
}

// No falla si el archivo ya no existe. Ignora los nombres que no genera save().
async function remove(fileName) {
  const filePath = getFilePath(fileName);
  if (filePath) await fs.rm(filePath, { force: true });
}

module.exports = { getDirectory, isStoredFileName, getFilePath, save, remove };
