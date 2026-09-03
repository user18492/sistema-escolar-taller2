const { contextBridge } = require('electron');

// Todavía no hay IPC ni lógica de negocio conectada (ver CLAUDE.md, sección 10):
// se expone un objeto vacío para dejar contextIsolation activo desde el inicio,
// siguiendo la arquitectura definida antes de implementar los canales reales.
contextBridge.exposeInMainWorld('api', {});
