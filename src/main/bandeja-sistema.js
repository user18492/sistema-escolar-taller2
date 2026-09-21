const path = require('node:path');
const { app, Menu, Tray } = require('electron');

const RUTA_ICONO = path.join(__dirname, '..', '..', 'resources', 'icon_app.png');

function crearBandejaSistema(mostrarVentana) {
  const bandeja = new Tray(RUTA_ICONO);
  bandeja.setToolTip('Sistema Escolar');
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar aplicación', click: mostrarVentana },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
  bandeja.on('click', mostrarVentana);

  return bandeja;
}

module.exports = { crearBandejaSistema };
