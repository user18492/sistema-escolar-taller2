const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { app, dialog } = require('electron');
const { crearVentanaPrincipal } = require('./src/main/ventana-principal');
const { crearBandejaSistema } = require('./src/main/bandeja-sistema');
const { verificarConexion, cerrarConexion } = require('./src/main/base-datos/conexion');

let ventanaPrincipal;
let bandeja;
let estaSaliendo = false;

function mostrarVentanaPrincipal() {
  if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) {
    ventanaPrincipal = crearVentanaPrincipal();
    ventanaPrincipal.on('close', (evento) => {
      if (!estaSaliendo) {
        evento.preventDefault();
        ventanaPrincipal.hide();
      }
    });
  }

  if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
  ventanaPrincipal.show();
  ventanaPrincipal.focus();
}

// Solo los errores de configuración más comunes tienen un mensaje propio; el resto se detalla en la consola.
function describirErrorConexion(error) {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER } = process.env;

  switch (error.code) {
    // Falta el .env o alguna variable: el mensaje de conexion.js ya dice cuáles y cómo corregirlo.
    case 'CONFIGURACION_INCOMPLETA':
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
    await verificarConexion();
  } catch (error) {
    console.error('No se pudo conectar a la base de datos:', error);
    dialog.showErrorBox('Error de conexión con la base de datos', describirErrorConexion(error));
    app.quit();
    return;
  }

  mostrarVentanaPrincipal();
  bandeja = crearBandejaSistema(mostrarVentanaPrincipal);

  app.on('activate', mostrarVentanaPrincipal);
});

app.on('before-quit', () => {
  estaSaliendo = true;
});

app.on('will-quit', () => {
  if (bandeja) bandeja.destroy();
  // No se espera el cierre: la app termina igual, pero un fallo no debe quedar como promesa sin manejar.
  cerrarConexion().catch((error) => {
    console.error('Error al cerrar la conexión con la base de datos:', error);
  });
});
