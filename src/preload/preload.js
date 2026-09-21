const { contextBridge, ipcRenderer } = require('electron');

// Se exponen acciones concretas, sin dar acceso directo al IPC desde la UI.
contextBridge.exposeInMainWorld('api', {
  ventana: {
    minimizar: () => ipcRenderer.invoke('ventana:minimizar'),
    alternarMaximizado: () => ipcRenderer.invoke('ventana:alternar-maximizado'),
    cerrar: () => ipcRenderer.invoke('ventana:cerrar'),
    estaMaximizada: () => ipcRenderer.invoke('ventana:esta-maximizada'),
    alCambiarMaximizado: (callback) => {
      const manejador = (_evento, maximizada) => callback(maximizada);
      ipcRenderer.on('ventana:cambio-maximizado', manejador);
      return () => ipcRenderer.removeListener('ventana:cambio-maximizado', manejador);
    },
  },
});
