const rememberedAccountRepository = require('../repositories/remembered-account.repository');
const { normalizeEmail, isValidEmail } = require('./auth.service');

// "Recordar mi cuenta" guarda solo el email, nunca la contraseña ni su hash. Es una preferencia
// independiente de la sesión: cerrar sesión no la borra y tenerla guardada no inicia sesión.

// Devuelve el email recordado, o null si no hay uno válido.
async function getRememberedEmail() {
  const email = normalizeEmail(await rememberedAccountRepository.findEmail());
  return isValidEmail(email) ? email : null;
}

async function rememberEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error('El email a recordar no es válido.');
  }
  await rememberedAccountRepository.saveEmail(normalizedEmail);
}

async function forgetEmail() {
  await rememberedAccountRepository.deleteEmail();
}

module.exports = { getRememberedEmail, rememberEmail, forgetEmail };
