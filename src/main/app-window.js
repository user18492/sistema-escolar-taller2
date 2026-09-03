const path = require('node:path');
const { BrowserWindow } = require('electron');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'preload.js');
const DASHBOARD_PATH = path.join(__dirname, '..', '..', 'renderer', 'admin', 'dashboard', 'index.html');

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(DASHBOARD_PATH);

  return window;
}

module.exports = { createMainWindow };
