const path = require('node:path');
const { fileURLToPath } = require('node:url');

const RENDERER_PATH = path.join(__dirname, '..', '..', '..', 'renderer');

// Solo se atiende al marco principal de la ventana y mientras muestra una vista propia de renderer/.
function isTrustedSender(event, browserWindow) {
  const frame = event.senderFrame;
  if (!frame || frame !== browserWindow.webContents.mainFrame) return false;

  let filePath;
  try {
    filePath = fileURLToPath(frame.url);
  } catch {
    // No es una URL file://: la ventana navegó fuera de la aplicación.
    return false;
  }

  const relativePath = path.relative(RENDERER_PATH, filePath);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

// Registra `channel` solo para el contenido de esta ventana. `action` recibe los argumentos
// enviados por el renderer, sin el evento.
function handleTrusted(browserWindow, channel, action) {
  browserWindow.webContents.ipc.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event, browserWindow)) {
      throw new Error('Origen de la solicitud no permitido.');
    }
    return action(...args);
  });
}

module.exports = { handleTrusted };
