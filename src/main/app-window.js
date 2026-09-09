const path = require('node:path');
const { BrowserWindow } = require('electron');
const { registerWindowControls } = require('./ipc/window-controls.controller');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'preload.js');
const ICON_PATH = path.join(__dirname, '..', '..', 'resources', 'icon_app.png');
const DASHBOARD_PATH = path.join(__dirname, '..', '..', 'renderer', 'secretary', 'students', 'index.html');

function createMainWindow() {
  const window = new BrowserWindow({
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

  window.setMenu(null);
  registerWindowControls(window);
  window.loadFile(DASHBOARD_PATH);

  return window;
}

module.exports = { createMainWindow };
