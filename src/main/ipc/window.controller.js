const { handleTrusted } = require('./trusted-sender');

// Los canales pertenecen únicamente al contenido de esta ventana.
function registerWindowControls(browserWindow) {
  const handle = (channel, action) => handleTrusted(browserWindow, channel, action);

  handle('window:minimize', () => browserWindow.minimize());
  handle('window:toggle-maximize', () => {
    if (browserWindow.isMaximized()) browserWindow.unmaximize();
    else browserWindow.maximize();
    return browserWindow.isMaximized();
  });
  handle('window:close', () => browserWindow.close());
  handle('window:is-maximized', () => browserWindow.isMaximized());

  const sendMaximizedState = () => {
    browserWindow.webContents.send('window:maximized-change', browserWindow.isMaximized());
  };
  browserWindow.on('maximize', sendMaximizedState);
  browserWindow.on('unmaximize', sendMaximizedState);
}

module.exports = { registerWindowControls };
