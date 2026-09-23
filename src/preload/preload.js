const { contextBridge, ipcRenderer } = require('electron');

// Se exponen acciones concretas, sin dar acceso directo al IPC desde la UI.
contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => {
      const handler = (_event, maximized) => callback(maximized);
      ipcRenderer.on('window:maximized-change', handler);
      return () => ipcRenderer.removeListener('window:maximized-change', handler);
    },
  },
  auth: {
    // Resuelve { ok: true, user } o { ok: false, error: { code, message } }, con el mensaje listo para mostrar.
    // Con un acceso exitoso, `rememberAccount` guarda el email para el próximo inicio o lo olvida.
    login: (email, password, rememberAccount) => ipcRenderer.invoke('auth:login', { email, password, rememberAccount }),
    // Resuelve { firstName, lastName, role, imageUrl, institutionName }, o null si no hay sesión iniciada.
    getCurrentUser: () => ipcRenderer.invoke('auth:get-current-user'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    // Resuelve el email recordado, o null si no hay ninguno.
    getRememberedEmail: () => ipcRenderer.invoke('auth:get-remembered-email'),
    forgetRememberedEmail: () => ipcRenderer.invoke('auth:forget-remembered-email'),
  },
  users: {
    // Solo ADMIN. Resuelve { ok: true, users } con los demás usuarios de su institución, ordenados por apellido
    // y nombre ({ id, firstName, lastName, dni, email, isActive, role }), o { ok: false, error: { code, message } }.
    list: () => ipcRenderer.invoke('users:list'),
  },
});
