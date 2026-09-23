const path = require('node:path');
const { BrowserWindow } = require('electron');
const { registerWindowControls } = require('./ipc/window.controller');
const { registerAuthHandlers } = require('./ipc/auth.controller');
const { registerUserHandlers } = require('./ipc/user.controller');
const { guardNavigation, showEntryView } = require('./navigation-guard');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'preload.js');
const ICON_PATH = path.join(__dirname, '..', '..', 'resources', 'icon_app.png');

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    icon: ICON_PATH,
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);
  registerWindowControls(mainWindow);
  registerAuthHandlers(mainWindow);
  registerUserHandlers(mainWindow);
  guardNavigation(mainWindow);
  showEntryView(mainWindow);

  return mainWindow;
}

module.exports = { createMainWindow };
