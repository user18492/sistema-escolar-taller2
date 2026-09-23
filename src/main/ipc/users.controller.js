// src/main/ipc/users.controller.js
const { crearUsuario, listarUsuarios } = require('../../../db/users.repository');

// Mismo patrón de seguridad que window-controls: solo el frame principal
// de esta ventana puede invocar estos canales.
function registerUsersControls(window) {
    const handle = (channel, action) => {
        window.webContents.ipc.handle(channel, (event, ...args) => {
            if (event.senderFrame !== window.webContents.mainFrame) {
                throw new Error('Origen de control de usuarios no permitido.');
            }
            return action(...args);
        });
    };

    handle('usuarios:crear', (datos) => crearUsuario(datos));
    handle('usuarios:listar', () => listarUsuarios());
}

module.exports = { registerUsersControls };
