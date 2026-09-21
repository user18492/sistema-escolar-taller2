// Los canales pertenecen únicamente al contenido de esta ventana.
function registrarControlesVentana(ventana) {
  const manejar = (canal, accion) => {
    ventana.webContents.ipc.handle(canal, (evento) => {
      if (evento.senderFrame !== ventana.webContents.mainFrame) {
        throw new Error('Origen de control de ventana no permitido.');
      }
      return accion();
    });
  };

  manejar('ventana:minimizar', () => ventana.minimize());
  manejar('ventana:alternar-maximizado', () => {
    if (ventana.isMaximized()) ventana.unmaximize();
    else ventana.maximize();
    return ventana.isMaximized();
  });
  manejar('ventana:cerrar', () => ventana.close());
  manejar('ventana:esta-maximizada', () => ventana.isMaximized());

  const enviarEstadoMaximizado = () => {
    ventana.webContents.send('ventana:cambio-maximizado', ventana.isMaximized());
  };
  ventana.on('maximize', enviarEstadoMaximizado);
  ventana.on('unmaximize', enviarEstadoMaximizado);
}

module.exports = { registrarControlesVentana };
