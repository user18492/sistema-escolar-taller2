const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const backupService = require('../services/backup.service');
const sessionService = require('../services/session.service');
const { showRestoredLogin } = require('../navigation-guard');

const { BackupError } = backupService;

// Nunca rechaza: si la consulta falla, devuelve un mensaje genérico con el detalle en la consola.
async function listBackups(currentUser) {
  try {
    return { ok: true, backups: await backupService.list(currentUser) };
  } catch (error) {
    console.error('Error al listar los backups:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo cargar el historial de backups. Intentá nuevamente.');
  }
}

// Nunca rechaza: los errores previstos llevan su mensaje y el resto, uno genérico con el detalle en
// la consola.
async function createBackup(currentUser, format) {
  if (!backupService.FORMATS.includes(format)) {
    return failure('INVALID_INPUT', 'Elegí un formato de compresión válido.');
  }
  try {
    return { ok: true, backup: await backupService.create(currentUser, format) };
  } catch (error) {
    if (error instanceof BackupError) {
      return failure(error.code, error.message);
    }
    console.error('Error al realizar el backup:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo realizar el backup. Intentá nuevamente.');
  }
}

// Nunca rechaza, como createBackup. El diálogo se abre sobre `browserWindow`; el renderer no envía
// ninguna ruta.
async function selectRestoreFile(browserWindow, currentUser) {
  try {
    return { ok: true, file: await backupService.selectFile(currentUser, browserWindow) };
  } catch (error) {
    if (error instanceof BackupError) {
      return failure(error.code, error.message);
    }
    console.error('Error al elegir el backup a restaurar:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo leer el backup elegido. Intentá nuevamente.');
  }
}

// Nunca rechaza, como createBackup. Si el restore sale bien, cierra la sesión (los datos de la
// sesión pueden no ser los del backup) y la ventana vuelve al login, que avisa el motivo.
async function restoreBackup(browserWindow, currentUser) {
  try {
    await backupService.restore(currentUser);
  } catch (error) {
    if (error instanceof BackupError) {
      return failure(error.code, error.message);
    }
    console.error('Error al restaurar el backup:', error);
    return failure('UNEXPECTED_ERROR', 'No se pudo restaurar el backup. Intentá nuevamente.');
  }
  sessionService.logout();
  if (!browserWindow.isDestroyed()) showRestoredLogin(browserWindow);
  return { ok: true };
}

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerBackupHandlers(browserWindow) {
  handleProtected(browserWindow, 'backups:list', ['ADMIN'], listBackups);
  handleProtected(browserWindow, 'backups:create', ['ADMIN'], createBackup);
  // Sin argumentos del renderer: los que envíe se ignoran
  handleProtected(browserWindow, 'backups:select-file', ['ADMIN'], (currentUser) => selectRestoreFile(browserWindow, currentUser));
  handleProtected(browserWindow, 'backups:restore', ['ADMIN'], (currentUser) => restoreBackup(browserWindow, currentUser));
}

module.exports = { registerBackupHandlers };
