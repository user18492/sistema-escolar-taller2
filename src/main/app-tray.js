const path = require('node:path');
const { app, Menu, Tray } = require('electron');

const ICON_PATH = path.join(__dirname, '..', '..', 'resources', 'icon_app.png');

function createAppTray(showWindow) {
  const tray = new Tray(ICON_PATH);
  tray.setToolTip('Sistema Escolar');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar aplicación', click: showWindow },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);

  return tray;
}

module.exports = { createAppTray };
