const { toRendererPath } = require('../renderer-path');

// Solo se atiende al marco principal de la ventana y mientras muestra una vista propia de renderer/.
function isTrustedSender(event, browserWindow) {
  const frame = event.senderFrame;
  if (!frame || frame !== browserWindow.webContents.mainFrame) return false;

  // Fuera de renderer/, la ventana navegó fuera de la aplicación.
  return toRendererPath(frame.url) !== null;
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
