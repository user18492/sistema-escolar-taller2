// Vista Alumnos del Secretario — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  const { closeAllDropdowns } = setupDropdowns();

  // Los filtros de Nombre / Email / Teléfono / DNI / Estado viven en los encabezados
  // de la tabla y los gestiona el componente compartido column-filter.js.

  // Los textos truncados (Nombre / Email / Dirección) muestran su tooltip con el
  // componente compartido text-truncate.component.js.

  // ---------- Modal: Nuevo alumno / Editar alumno ----------

  const overlay = document.getElementById('newStudentOverlay');
  const openModalBtn = document.getElementById('openNewStudentModalBtn');
  const cancelBtn = document.getElementById('cancelNewStudentBtn');
  const createBtn = document.getElementById('createStudentBtn');
  const modalTitle = document.getElementById('newStudentTitle');
  const modalDescription = overlay.querySelector('.modal-header p');

  const textInputs = overlay.querySelectorAll(
    '.modal-body input[type="text"], .modal-body input[type="email"], .modal-body input[type="tel"]'
  );
  const statusDropdown = overlay.querySelector('.dropdown');
  const statusLabel = statusDropdown.querySelector('.dropdown-label');
  const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');

  const firstNameInput = document.getElementById('newStudentFirstName');
  const lastNameInput = document.getElementById('newStudentLastName');
  const dniInput = document.getElementById('newStudentDni');
  const birthdateInput = document.getElementById('newStudentBirthdate');
  const emailInput = document.getElementById('newStudentEmail');
  const phoneInput = document.getElementById('newStudentPhone');
  const streetInput = document.getElementById('newStudentStreet');
  const streetNumberInput = document.getElementById('newStudentStreetNumber');

  const MONTH_ABBREVIATIONS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

  let modalTrigger = openModalBtn;

  // Máscaras, formato y errores de los campos de texto: componente compartido
  // field-validation.component.js, según el data-validate de cada campo.

  function updateCreateButtonState() {
    const hasAllTextInputs = Array.from(textInputs).every((input) => input.value.trim().length > 0);
    const hasStatus = Boolean(statusDropdown.querySelector('.dropdown-option.selected'));
    createBtn.disabled = !(hasAllTextInputs && hasStatus);
  }

  // Marca la opción de estado cuyo texto coincide, replicando lo que hace el
  // listener del dropdown al elegirla con el ratón.
  function selectStatus(optionLabel) {
    statusOptions.forEach((option) => {
      const selected = option.textContent.trim() === optionLabel;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) statusLabel.textContent = option.textContent.trim();
    });
    statusLabel.classList.remove('placeholder');
  }

  function resetForm() {
    textInputs.forEach((input) => (input.value = ''));
    clearFieldErrors(overlay);
    statusOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    statusLabel.textContent = 'Seleccionar estado';
    statusLabel.classList.add('placeholder');
    updateCreateButtonState();
  }

  function openModal(row = null, trigger = openModalBtn) {
    const isEditing = Boolean(row);
    modalTrigger = trigger;
    resetForm();

    modalTitle.textContent = isEditing ? 'Editar alumno' : 'Nuevo alumno';
    modalDescription.textContent = isEditing
      ? 'Modifica los datos del alumno.'
      : 'Completa los datos para registrar un nuevo alumno.';
    createBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear alumno';

    if (row) {
      const [lastName, firstName] = row.querySelector('.student-name').textContent.trim().split(', ');
      firstNameInput.value = firstName;
      lastNameInput.value = lastName;
      emailInput.value = row.cells[1].textContent.trim();
      phoneInput.value = row.cells[2].textContent.trim();
      // La tabla muestra la dirección completa: se separa la altura final de la calle.
      const address = row.cells[3].textContent.trim();
      const addressParts = address.match(/^(.*\S)\s+(\d+\S*)$/);
      streetInput.value = addressParts ? addressParts[1] : address;
      streetNumberInput.value = addressParts ? addressParts[2] : '';
      dniInput.value = row.cells[4].textContent.trim();
      // La tabla muestra la fecha como "DD MMM AAAA"; el campo la espera como DD/MM/AAAA.
      const [day, month, year] = row.cells[5].textContent.trim().split(' ');
      const monthNumber = String(MONTH_ABBREVIATIONS.indexOf(month) + 1).padStart(2, '0');
      birthdateInput.value = `${day}/${monthNumber}/${year}`;
      selectStatus(row.cells[6].textContent.trim());
    }

    updateCreateButtonState();
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    overlay.classList.add('is-open');
    overlay.querySelector('.modal').scrollTop = 0;
    firstNameInput.focus();
  }

  function closeModal() {
    overlay.classList.remove('is-open');
    modalTrigger.focus();
    closeAllDropdowns();
  }

  textInputs.forEach((input) => {
    input.addEventListener('input', updateCreateButtonState);
  });

  statusOptions.forEach((option) => {
    option.addEventListener('click', () => {
      statusLabel.classList.remove('placeholder');
      updateCreateButtonState();
    });
  });

  openModalBtn.addEventListener('click', () => openModal());
  document.querySelectorAll('.data-table tbody [data-action=edit]').forEach((button) => {
    button.addEventListener('click', () => openModal(button.closest('tr'), button));
  });

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open')) closeModal();
  });

  cancelBtn.addEventListener('click', closeModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', () => {
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(overlay)) return;
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeModal();
  });

  // ---------- Modal: Eliminar alumno ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteStudentOverlay'), { beforeOpen: closeAllDropdowns });
});

