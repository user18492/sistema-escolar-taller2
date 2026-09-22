const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

// La cuenta recordada es una preferencia de este equipo, no un dato de la institución: se guarda en
// un archivo JSON de la carpeta de datos de la aplicación (userData) y no en PostgreSQL.
const FILE_NAME = 'remembered-account.json';

// Las operaciones se encadenan: un guardado y un borrado seguidos terminan en el orden en que se pidieron.
let lastOperation = Promise.resolve();

function enqueue(operation) {
  const result = lastOperation.then(operation);
  lastOperation = result.catch(() => {});
  return result;
}

function getFilePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

// Devuelve el email guardado tal como está en el archivo, o null si no hay ninguno.
function findEmail() {
  return enqueue(async () => {
    let content;
    try {
      content = await fs.readFile(getFilePath(), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }

    const email = JSON.parse(content)?.email;
    return typeof email === 'string' ? email : null;
  });
}

// El archivo guarda únicamente el email.
function saveEmail(email) {
  return enqueue(async () => {
    const filePath = getFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ email }), 'utf8');
  });
}

function deleteEmail() {
  return enqueue(() => fs.rm(getFilePath(), { force: true }));
}

module.exports = { findEmail, saveEmail, deleteEmail };
