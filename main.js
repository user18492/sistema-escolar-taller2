const { app } = require('electron');
const { createMainWindow } = require('./src/main/app-window');
const { createAppTray } = require('./src/main/app-tray');

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

app.whenReady().then(() => {
  showMainWindow();
  tray = createAppTray(showMainWindow);

  app.on('activate', showMainWindow);
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (tray) tray.destroy();
});
