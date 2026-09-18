// Vista Alumnos del Secretario — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  const dropdowns = document.querySelectorAll('.dropdown');

  const closeDropdown = (dropdown) => {
    dropdown.classList.remove('open');
    dropdown.querySelector('.dropdown-toggle').setAttribute('aria-expanded', 'false');
    dropdown.querySelector('.dropdown-menu').hidden = true;
  };

  const closeAllDropdowns = (except) => {
    dropdowns.forEach((dropdown) => {
      if (dropdown !== except) closeDropdown(dropdown);
    });
  };

  dropdowns.forEach((dropdown) => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const label = dropdown.querySelector('.dropdown-label');
    const menu = dropdown.querySelector('.dropdown-menu');
    const options = dropdown.querySelectorAll('.dropdown-option');

    toggle.addEventListener('click', () => {
      const isOpen = dropdown.classList.contains('open');
      closeAllDropdowns(dropdown);

      if (isOpen) {
        closeDropdown(dropdown);
        return;
      }

      dropdown.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
    });

    options.forEach((option) => {
      option.addEventListener('click', () => {
        options.forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        option.classList.add('selected');
        option.setAttribute('aria-selected', 'true');
        label.textContent = option.textContent.trim();
        closeDropdown(dropdown);
      });
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllDropdowns();
    }
  });

  // Los filtros de Nombre / Email / Teléfono / DNI / Estado viven en los encabezados
  // de la tabla y los gestiona el componente compartido column-filter.js.

  // ---------- Textos truncados (Nombre / Email / Dirección) ----------

  // El tooltip con el valor completo aparece solo si el texto está recortado. Se
  // evalúa al pasar el cursor para reflejar el ancho actual de la columna.
  document.querySelector('.data-table tbody').addEventListener('mouseover', (event) => {
    const text = event.target.closest('.cell-truncate');
    if (!text) return;
    if (text.scrollWidth > text.clientWidth) {
      text.title = text.textContent.trim();
    } else {
      text.removeAttribute('title');
    }
  });

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

  let modalTrigger = openModalBtn;

  function formatDniInput() {
    const digitsBeforeCursor = dniInput.value.slice(0, dniInput.selectionStart).replace(/\D/g, '').length;
    const digits = dniInput.value.replace(/\D/g, '').slice(0, 8);
    const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    let cursor = 0;
    let digitCount = 0;

    // Mantener el cursor junto al mismo dígito al insertar o quitar los puntos.
    while (cursor < formatted.length && digitCount < digitsBeforeCursor) {
      if (formatted[cursor] !== '.') digitCount += 1;
      cursor += 1;
    }

    dniInput.value = formatted;
    dniInput.setSelectionRange(cursor, cursor);
  }

  dniInput.addEventListener('input', formatDniInput);

  function formatBirthdateInput() {
    const digits = birthdateInput.value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits.slice(0, 2);
    if (digits.length > 2) formatted += '/' + digits.slice(2, 4);
    if (digits.length > 4) formatted += '/' + digits.slice(4, 8);
    birthdateInput.value = formatted;
  }

  birthdateInput.addEventListener('input', formatBirthdateInput);

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
      birthdateInput.value = row.cells[5].textContent.trim();
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

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
    if (event.key !== 'Tab') return;
    const controls = Array.from(overlay.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]'))
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  cancelBtn.addEventListener('click', closeModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeModal();
  });

  // ---------- Modal: Eliminar alumno ----------

  const deleteOverlay = document.getElementById('deleteStudentOverlay');
  const cancelDeleteBtn = document.getElementById('cancelDeleteStudentBtn');
  let deleteTrigger = null;

  function openDeleteModal(trigger) {
    deleteTrigger = trigger;
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    deleteOverlay.classList.add('is-open');
    // "Cancelar" recibe el foco para evitar eliminaciones accidentales con Enter.
    cancelDeleteBtn.focus();
  }

  function closeDeleteModal() {
    deleteOverlay.classList.remove('is-open');
    deleteTrigger?.focus();
  }

  document.querySelectorAll('.data-table tbody [data-action="delete"]').forEach((button) => {
    button.addEventListener('click', () => openDeleteModal(button));
  });
  deleteOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDeleteModal();
  });
  cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDeleteStudentBtn').addEventListener('click', () => {
    // Vista puramente visual: la eliminación real se conecta cuando exista la capa de servicios/IPC.
    closeDeleteModal();
  });
});

