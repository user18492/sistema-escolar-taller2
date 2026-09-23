const bcrypt = require('bcrypt');

// Único lugar que hashea contraseñas. No genera contraseñas: las genera el renderer
// (password-generator.component.js) y llegan acá en texto plano por IPC, desde el alta y la edición de usuarios.
// Si cambian estas reglas, revisar las del generador: toda contraseña que genera tiene que cumplirlas.
// El renderer no puede importar este archivo, así que las reglas están escritas en los dos.

// El mismo costo de db/seed.sql y de DUMMY_PASSWORD_HASH (auth.service.js).
const BCRYPT_COST = 10;

const PASSWORD_MIN_LENGTH = 12;

// bcrypt ignora los bytes que siguen al 72 (README de bcrypt): una contraseña más larga se aceptaría con solo su comienzo.
const PASSWORD_MAX_BYTES = 72;

// Más amplia que el generador, para servir también a contraseñas escritas a mano: 12 caracteres o más,
// 72 bytes UTF-8 o menos, y al menos una mayúscula, una minúscula, un dígito y un símbolo.
function isValidPassword(password) {
  return (
    typeof password === 'string' &&
    [...password].length >= PASSWORD_MIN_LENGTH &&
    Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

// Quien llama valida antes con isValidPassword y responde con su propio error previsto: una contraseña
// inválida en este punto es un error de programación. El mensaje nunca incluye la contraseña.
async function hashPassword(password) {
  if (!isValidPassword(password)) {
    throw new Error('hashPassword recibió una contraseña que no cumple los requisitos de seguridad.');
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

module.exports = { isValidPassword, hashPassword };
