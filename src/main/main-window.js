const path = require('node:path');
const { BrowserWindow } = require('electron');
const { registerWindowControls } = require('./ipc/window.controller');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'preload.js');
const ICON_PATH = path.join(__dirname, '..', '..', 'resources', 'icon_app.png');
const LOGIN_PATH = path.join(__dirname, '..', '..', 'renderer', 'auth', 'login', 'index.html');

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
  mainWindow.loadFile(LOGIN_PATH);

  return mainWindow;
}

module.exports = { createMainWindow };
