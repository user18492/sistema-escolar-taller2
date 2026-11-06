// Vista Backup y restauración del Administrador: la tabla muestra el historial de backups de la
// institución (backups.list), del más nuevo al más viejo, paginado en memoria, 10 por página, con
// <table-pagination>.
// Backup abre el modal "Nuevo backup", donde se elige el formato de compresión (ZIP o TAR.GZ), y
// "Realizar backup" lo realiza (backups.create). Restore pide confirmación antes de reemplazar los
// datos de la institución por los de un backup (confirm-modal.component.js, variante "overwrite").
// Por ahora el Restore es solo visual: el archivo que se restaura es un dato de prueba y la
// confirmación no llama al proceso principal (solo cierra el modal).

// Dato de prueba: lo reemplaza el archivo que elige el administrador para restaurar (parte 02 del
// plan plans/backups).
const MOCK_RESTORE_FILE = {
  fileName: 'backup-2026-11-03-1842.zip',
  createdAt: '2026-11-03T18:42:00-03:00',
  userName: 'Carlos Fernández',
};

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  const { closeAllDropdowns } = setupDropdowns();

  // ---------- Tabla: historial de backups ----------

  const table = document.querySelector('.backups-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('backupRowTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.backups-card table-pagination');

  // createdAt llega en ISO 8601 y se muestra en la hora local como DD/MM/AAAA hh:mm
  const dateTimeFormat = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const formatDateTime = (isoDateTime) => {
    const parts = Object.fromEntries(
      dateTimeFormat.formatToParts(new Date(isoDateTime)).map(({ type, value }) => [type, value])
    );
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
  };

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el historial de backups. Intentá nuevamente.';

  // Historial en memoria, del más nuevo al más viejo, como lo devuelve el proceso principal
  let backups = [];
  // false mientras carga o si la carga falló: la tabla muestra ese mensaje
  let isLoaded = false;

  // Cargando, error o sin backups, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Los datos se asignan siempre con textContent, nunca como HTML. La fila lleva el id del backup
  // en data-backup-id.
  const createRow = (backup) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.backupId = String(backup.id);
    row.querySelector('.col-user .text-truncate').textContent = backup.userName;
    row.cells[1].textContent = formatDateTime(backup.createdAt);
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) del historial (10 por página, en memoria)
  const renderRows = ({ page } = {}) => {
    const pageBackups = pagination.slice(backups, { page });
    if (pageBackups.length) tbody.replaceChildren(...pageBackups.map(createRow));
    else showMessage('Todavía no se realizó ningún backup');
  };

  // Pide el historial; si no llega, la tabla muestra el error
  async function loadBackups() {
    isLoaded = false;
    showMessage('Cargando backups…');
    let response;
    try {
      response = await window.api?.backups?.list();
    } catch (error) {
      console.error('Error al cargar los backups:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    backups = response.backups;
    isLoaded = true;
    renderRows();
  }

  // El backup recién realizado es el más nuevo: va primero, y la tabla pasa a la página 1. Si el
  // historial no había cargado, se vuelve a pedir, ya con él
  const insertBackup = (backup) => {
    if (!isLoaded) {
      loadBackups();
      return;
    }
    backups = [backup, ...backups];
    renderRows({ page: 1 });
  };

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadBackups();

  // ---------- Modal: Nuevo backup ----------

  const backupOverlay = document.getElementById('newBackupOverlay');
  const backupModal = backupOverlay.querySelector('.modal');
  const backupModalBody = backupOverlay.querySelector('.modal-body');
  const openBackupModalBtn = document.getElementById('openNewBackupModalBtn');
  const cancelBackupBtn = document.getElementById('cancelNewBackupBtn');
  const createBackupBtn = document.getElementById('createBackupBtn');
  const formatDropdown = backupOverlay.querySelector('[data-filter="new-backup-format"]');
  const DEFAULT_FORMAT = 'zip';
  const SUBMIT_TEXT = createBackupBtn.textContent;
  const SAVING_TEXT = 'Realizando backup…';
  let isSaving = false;

  const selectedFormat = () => formatDropdown.querySelector('.dropdown-option.selected')?.dataset.value;

  // Mientras se espera la respuesta, el cuerpo del modal (el dropdown del formato) queda inerte, así
  // lo enviado coincide con lo que se ve. Los botones del pie quedan con aria-disabled y no con
  // disabled: conservan el foco, como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    backupModalBody.inert = saving;
    backupModal.setAttribute('aria-busy', String(saving));
    [cancelBackupBtn, createBackupBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    createBackupBtn.textContent = saving ? SAVING_TEXT : SUBMIT_TEXT;
  };

  // Los mensajes de los errores previstos (BACKUP_IN_PROGRESS, BACKUP_FILE_EXISTS,
  // BACKUP_WRITE_FAILED…) llegan listos para mostrar; el de uno inesperado, no.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // Elige en el dropdown la opción con ese data-value, como si se la pulsara:
  // dropdown.component.js la marca y la muestra en la etiqueta
  const selectFormat = (value) =>
    Array.from(formatDropdown.querySelectorAll('.dropdown-option')).find((option) => option.dataset.value === value)?.click();

  // Cada apertura empieza con el formato por defecto, ZIP
  const openBackupModal = () => {
    closeAllDropdowns();
    selectFormat(DEFAULT_FORMAT);
    backupOverlay.classList.add('is-open');
    formatDropdown.querySelector('.dropdown-toggle').focus();
  };

  const closeBackupModal = () => {
    backupOverlay.classList.remove('is-open');
    closeAllDropdowns();
    openBackupModalBtn.focus();
  };

  // Realiza el backup en el formato elegido. Si sale bien, cierra el modal, avisa el nombre del
  // archivo y suma la fila al historial; si no, el modal sigue abierto y un toast da el motivo.
  const createBackup = async () => {
    closeAllDropdowns();
    setSaving(true);
    let response;
    try {
      response = await window.api?.backups?.create(selectedFormat());
    } catch (error) {
      console.error('Error al realizar el backup:', error);
    }
    setSaving(false);

    if (response?.ok) {
      insertBackup(response.backup);
      closeBackupModal();
      showToast({
        type: 'success',
        title: 'Backup realizado',
        description: `Se guardó el archivo ${response.backup.fileName}.`,
      });
      return;
    }
    showToast({ type: 'error', title: 'No se pudo realizar el backup', description: errorDescription(response?.error) });
  };

  openBackupModalBtn.addEventListener('click', openBackupModal);
  cancelBackupBtn.addEventListener('click', () => {
    if (!isSaving) closeBackupModal();
  });
  createBackupBtn.addEventListener('click', () => {
    if (!isSaving) createBackup();
  });

  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control. Mientras se realiza el backup, ni Escape ni Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backupOverlay.classList.contains('is-open') && !isSaving) closeBackupModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // ---------- Confirmación: Restaurar backup ----------

  const restoreBtn = document.getElementById('openRestoreBtn');

  // Componente compartido confirm-modal.component.js, variante "overwrite": no está en las filas,
  // así que lo abre Restore desde código, y al cerrarse el foco vuelve a ese botón. Por ahora
  // confirmar solo lo cierra: la restauración la realiza la parte 02 del plan.
  const restoreConfirm = setupConfirmModal(document.getElementById('overwriteBackupOverlay'), {
    beforeOpen: closeAllDropdowns,
    describe: () => {
      const { fileName, createdAt, userName } = MOCK_RESTORE_FILE;
      return `Se reemplazarán todos los datos actuales de la institución por los del backup del ${formatDateTime(createdAt)}, realizado por ${userName} (${fileName}). Los cambios posteriores a ese backup se perderán y la sesión se cerrará.`;
    },
  });

  restoreBtn.addEventListener('click', () => restoreConfirm.open(restoreBtn));
});
