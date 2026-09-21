const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { app } = require('electron');
const { crearVentanaPrincipal } = require('./src/main/ventana-principal');
const { crearBandejaSistema } = require('./src/main/bandeja-sistema');

let ventanaPrincipal;
let bandeja;
let estaSaliendo = false;

function mostrarVentanaPrincipal() {
  if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) {
    ventanaPrincipal = crearVentanaPrincipal();
    ventanaPrincipal.on('close', (evento) => {
      if (!estaSaliendo) {
        evento.preventDefault();
        ventanaPrincipal.hide();
      }
    });
  }

  if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
  ventanaPrincipal.show();
  ventanaPrincipal.focus();
}

app.whenReady().then(() => {
  mostrarVentanaPrincipal();
  bandeja = crearBandejaSistema(mostrarVentanaPrincipal);

  app.on('activate', mostrarVentanaPrincipal);
});

app.on('before-quit', () => {
  estaSaliendo = true;
});

app.on('will-quit', () => {
  if (bandeja) bandeja.destroy();
});
