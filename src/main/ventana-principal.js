const path = require('node:path');
const { BrowserWindow } = require('electron');
const { registrarControlesVentana } = require('./ipc/ventana.controlador');

const RUTA_PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const RUTA_ICONO = path.join(__dirname, '..', '..', 'resources', 'icon_app.png');
const RUTA_INICIO_SESION = path.join(__dirname, '..', '..', 'renderer', 'auth', 'login', 'index.html');

function crearVentanaPrincipal() {
  const ventana = new BrowserWindow({
    icon: RUTA_ICONO,
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    webPreferences: {
      preload: RUTA_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ventana.setMenu(null);
  registrarControlesVentana(ventana);
  ventana.loadFile(RUTA_INICIO_SESION);

  return ventana;
}

module.exports = { crearVentanaPrincipal };
