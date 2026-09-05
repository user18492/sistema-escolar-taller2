// Los canales pertenecen únicamente al contenido de esta ventana.
function registerWindowControls(window) {
  const handle = (channel, action) => {
    window.webContents.ipc.handle(channel, (event) => {
      if (event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Origen de control de ventana no permitido.');
      }
      return action();
    });
  };

  handle('window:minimize', () => window.minimize());
  handle('window:toggle-maximize', () => {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  handle('window:close', () => window.close());
  handle('window:is-maximized', () => window.isMaximized());

  const sendMaximizedState = () => {
    window.webContents.send('window:maximized-changed', window.isMaximized());
  };
  window.on('maximize', sendMaximizedState);
  window.on('unmaximize', sendMaximizedState);
}

module.exports = { registerWindowControls };
