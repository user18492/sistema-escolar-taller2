const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { app, dialog } = require('electron');
const { createMainWindow } = require('./src/main/main-window');
const { createSystemTray } = require('./src/main/system-tray');
const { checkConnection, closeConnection } = require('./src/main/database/connection');
const schoolYearService = require('./src/main/services/school-year.service');
const { registerProfileImageScheme, handleProfileImageRequests } = require('./src/main/profile-image-protocol');

// Electron exige registrar los esquemas propios antes de que la aplicación esté lista.
registerProfileImageScheme();

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
    // Falta una función o un procedimiento de db/schema.sql (p. ej., el del cierre de los ciclos
    // lectivos): la base se creó con una versión anterior del esquema.
    case '42883':
      return 'La base de datos no está actualizada. Borrala y ejecutá "npm run db:setup" para recrearla.';
    default:
      return 'Ocurrió un error inesperado al conectar con la base de datos. ' +
        'El detalle se muestra en la consola.';
  }
}

app.whenReady().then(async () => {
  try {
    await checkConnection();
    // Antes de abrir la ventana, las inscripciones activas de los ciclos lectivos ya cerrados pasan
    // a finalizadas. Es idempotente: en los arranques siguientes ya no encuentra ninguna.
    await schoolYearService.closePastSchoolYears();
  } catch (error) {
    console.error('No se pudo conectar a la base de datos:', error);
    dialog.showErrorBox('Error de conexión con la base de datos', describeConnectionError(error));
    app.quit();
    return;
  }

  // Una sola vez, fuera de createMainWindow: la ventana se puede volver a crear.
  handleProfileImageRequests();
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
