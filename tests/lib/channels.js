// Canales IPC que el preload expone al renderer: los ipcRenderer.invoke de src/preload/preload.js,
// con la ruta de window.api que lleva a cada uno. Es la API que usa la interfaz, así que es la
// referencia para comprobar que todo canal tiene su handler y para la cobertura.
const fs = require('node:fs');
const { PATHS } = require('../config');

function exposedChannels() {
  const source = fs.readFileSync(PATHS.preload, 'utf8');
  return [...new Set([...source.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((match) => match[1]))].sort();
}

// Canales que el proceso principal envía al renderer (ipcRenderer.on): no tienen handler.
function pushedChannels() {
  const source = fs.readFileSync(PATHS.preload, 'utf8');
  return [...new Set([...source.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)].map((match) => match[1]))].sort();
}

module.exports = { exposedChannels, pushedChannels };
