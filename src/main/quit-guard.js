const { app } = require('electron');

// Aviso de cambios sin guardar al cerrar la aplicación: con cambios sin guardar en la vista abierta
// (hoy, las calificaciones de la vista Calificaciones del Profesor), "Salir" de la bandeja y el
// apagado, el reinicio o el cierre de sesión de Windows no cierran la aplicación: muestran la
// ventana y la vista pide confirmación en su modal ("Cancelar" / "Salir sin guardar").
// La ✕ del titlebar no pasa por acá: oculta la ventana y conserva los cambios (main.js). El
// Administrador de tareas y las demás terminaciones forzadas no se pueden interceptar.
// El proceso principal no puede preguntarle a la vista en el momento (query-session-end decide en
// el acto), así que la vista le informa cada cambio con app:set-unsaved-changes (app.controller.js).

// Estado de la ventana principal: la vista abierta tiene cambios sin guardar, y el usuario ya
// confirmó salir sin guardarlos.
let hasUnsavedChanges = false;
let quitConfirmed = false;

function setUnsavedChanges(value) {
  hasUnsavedChanges = value;
}

// Muestra la ventana, aunque esté oculta en la bandeja o minimizada, y le pide a la vista el modal
// de confirmación (app:quit-requested). La vista decide: si ya no tiene cambios, cierra enseguida.
function requestQuitConfirmation(browserWindow) {
  if (browserWindow.isMinimized()) browserWindow.restore();
  browserWindow.show();
  browserWindow.focus();
  browserWindow.webContents.send('app:quit-requested');
}

// Para before-quit (main.js) y query-session-end: si la vista tiene cambios sin guardar y el cierre
// no se confirmó, lo cancela, pide la confirmación y devuelve true.
function blockQuitIfUnsaved(event, browserWindow) {
  if (quitConfirmed || !hasUnsavedChanges || !browserWindow || browserWindow.isDestroyed()) return false;
  event.preventDefault();
  requestQuitConfirmation(browserWindow);
  return true;
}

// "Salir sin guardar" del modal: el cierre ya no vuelve a preguntar.
function confirmQuit() {
  quitConfirmed = true;
  app.quit();
}

function registerQuitGuard(browserWindow) {
  const { webContents } = browserWindow;
  // Ventana nueva, o vista nueva o recargada: todavía no informó cambios
  hasUnsavedChanges = false;
  const reset = () => {
    hasUnsavedChanges = false;
  };
  webContents.on('did-navigate', reset);
  webContents.on('render-process-gone', reset);

  // Apagado, reinicio o cierre de sesión de Windows (solo win32). Cancelarlo hace que Windows
  // muestre su pantalla "Esta app impide el apagado", con "Apagar de todos modos" o "Cancelar"; si
  // el usuario cancela, encuentra la ventana con el modal. Un apagado crítico no se puede bloquear.
  browserWindow.on('query-session-end', (event) => {
    blockQuitIfUnsaved(event, browserWindow);
  });
}

module.exports = { registerQuitGuard, blockQuitIfUnsaved, setUnsavedChanges, confirmQuit };
