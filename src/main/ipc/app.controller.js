const { handleTrusted } = require('./trusted-sender');
const { failure } = require('./ipc-response');
const { setUnsavedChanges, confirmQuit } = require('../quit-guard');

// Canales del cierre de la aplicación con cambios sin guardar (quit-guard.js). Como los de
// window.controller.js, pertenecen únicamente al contenido de esta ventana y no piden sesión.
function registerAppHandlers(browserWindow) {
  const handle = (channel, action) => handleTrusted(browserWindow, channel, action);

  // La vista informa si tiene cambios sin guardar cada vez que cambia
  handle('app:set-unsaved-changes', (value) => {
    if (typeof value !== 'boolean') {
      return failure('INVALID_INPUT', 'Los datos enviados no son válidos.');
    }
    setUnsavedChanges(value);
    return { ok: true };
  });
  // "Salir sin guardar" del modal que pidió app:quit-requested: cierra sin volver a preguntar
  handle('app:quit', () => {
    confirmQuit();
  });
}

module.exports = { registerAppHandlers };
