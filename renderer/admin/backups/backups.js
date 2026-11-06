// Vista Backup y restauración del Administrador: la tabla muestra el historial de backups de la
// institución, del más nuevo al más viejo, paginado en memoria, 10 por página, con
// <table-pagination>.
// Backup abre el modal "Nuevo backup", donde se elige el formato de compresión (ZIP o TAR.GZ), y
// Restore pide confirmación antes de reemplazar los datos de la institución por los de un backup
// (confirm-modal.component.js, variante "overwrite").
// Por ahora la vista es solo visual: el historial y el archivo que se restaura son datos de prueba,
// y ni "Realizar backup" ni la confirmación del Restore llaman al proceso principal (solo cierran
// sus modales).

// Datos de prueba: los reemplazan el historial que devuelve el proceso principal (parte 01 del plan
// plans/backups) y el archivo que elige el administrador para restaurar (parte 02).
const MOCK_BACKUPS = [
  { id: 12, userName: 'Mariana Gómez', createdAt: '2026-11-06T09:15:00-03:00' },
  { id: 11, userName: 'Carlos Fernández', createdAt: '2026-11-03T18:42:00-03:00' },
  { id: 10, userName: 'Mariana Gómez', createdAt: '2026-10-30T12:05:00-03:00' },
  { id: 9, userName: 'María Fernanda Rodríguez Castellanos', createdAt: '2026-10-24T08:30:00-03:00' },
  { id: 8, userName: 'Carlos Fernández', createdAt: '2026-10-17T19:10:00-03:00' },
  { id: 7, userName: 'Mariana Gómez', createdAt: '2026-10-09T10:48:00-03:00' },
  { id: 6, userName: 'Carlos Fernández', createdAt: '2026-09-30T16:20:00-03:00' },
  { id: 5, userName: 'Mariana Gómez', createdAt: '2026-09-15T11:00:00-03:00' },
  { id: 4, userName: 'María Fernanda Rodríguez Castellanos', createdAt: '2026-08-28T09:55:00-03:00' },
  { id: 3, userName: 'Carlos Fernández', createdAt: '2026-07-31T17:35:00-03:00' },
  { id: 2, userName: 'Mariana Gómez', createdAt: '2026-06-30T13:12:00-03:00' },
  { id: 1, userName: 'Carlos Fernández', createdAt: '2026-03-02T08:00:00-03:00' },
];

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

  // Del más nuevo al más viejo; el id desempata
  const backups = MOCK_BACKUPS.toSorted(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id
  );

  // Sin backups, en una única fila de todo el ancho
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

  // Muestra la página actual del historial (10 por página, en memoria)
  const renderRows = () => {
    const pageBackups = pagination.slice(backups);
    if (pageBackups.length) tbody.replaceChildren(...pageBackups.map(createRow));
    else showMessage('Todavía no se realizó ningún backup');
  };

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', renderRows);

  renderRows();

  // ---------- Modal: Nuevo backup ----------

  const backupOverlay = document.getElementById('newBackupOverlay');
  const openBackupModalBtn = document.getElementById('openNewBackupModalBtn');
  const cancelBackupBtn = document.getElementById('cancelNewBackupBtn');
  const createBackupBtn = document.getElementById('createBackupBtn');
  const formatDropdown = backupOverlay.querySelector('[data-filter="new-backup-format"]');
  const DEFAULT_FORMAT = 'zip';

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

  openBackupModalBtn.addEventListener('click', openBackupModal);
  cancelBackupBtn.addEventListener('click', closeBackupModal);
  // Por ahora solo cierra el modal: el backup lo realiza la parte 01 del plan
  createBackupBtn.addEventListener('click', closeBackupModal);

  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backupOverlay.classList.contains('is-open')) closeBackupModal();
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
