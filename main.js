const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { app, dialog } = require('electron');
const { createMainWindow } = require('./src/main/main-window');
const { createSystemTray } = require('./src/main/system-tray');
const { checkConnection, closeConnection } = require('./src/main/database/connection');

let mainWindow;
let tray;
let isQuitting = false;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Solo los errores de configuración más comunes tienen un mensaje propio; el resto se detalla en la consola.
function describeConnectionError(error) {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER } = process.env;

  switch (error.code) {
    // Falta el .env o alguna variable: el mensaje de connection.js ya dice cuáles y cómo corregirlo.
    case 'INCOMPLETE_CONFIGURATION':
      return error.message;
    case 'ECONNREFUSED':
      return `PostgreSQL no está en ejecución o no responde en ${DB_HOST}:${DB_PORT}. ` +
        'Iniciá el servicio o corregí DB_HOST y DB_PORT en el archivo .env.';
    case '28P01':
      return `El usuario '${DB_USER}' o la contraseña son incorrectos. ` +
        'Corregí DB_USER y DB_PASSWORD en el archivo .env.';
    case '3D000':
      return `La base '${DB_NAME}' no existe. Ejecutá "npm run db:setup" para crearla.`;
    default:
      return 'Ocurrió un error inesperado al conectar con la base de datos. ' +
        'El detalle se muestra en la consola.';
  }
}

app.whenReady().then(async () => {
  try {
    await checkConnection();
  } catch (error) {
    console.error('No se pudo conectar a la base de datos:', error);
    dialog.showErrorBox('Error de conexión con la base de datos', describeConnectionError(error));
    app.quit();
    return;
  }

  showMainWindow();
  tray = createSystemTray(showMainWindow);

  app.on('activate', showMainWindow);
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (tray) tray.destroy();
  // No se espera el cierre: la app termina igual, pero un fallo no debe quedar como promesa sin manejar.
  closeConnection().catch((error) => {
    console.error('Error al cerrar la conexión con la base de datos:', error);
  });
});
