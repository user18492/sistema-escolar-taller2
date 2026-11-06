const { handleProtected } = require('./protected-handler');
const { failure } = require('./ipc-response');
const backupService = require('../services/backup.service');

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

// Sin sesión, con otro rol o con la cuenta suspendida, handleProtected responde UNAUTHENTICATED,
// FORBIDDEN o ACCOUNT_SUSPENDED sin llamar a la acción.
function registerBackupHandlers(browserWindow) {
  handleProtected(browserWindow, 'backups:list', ['ADMIN'], listBackups);
  handleProtected(browserWindow, 'backups:create', ['ADMIN'], createBackup);
}

module.exports = { registerBackupHandlers };
