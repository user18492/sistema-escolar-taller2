// Vista Evaluaciones de una asignación (Profesor) — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Datos de la asignación seleccionada ----------

  // La fila de Asignaciones abre esta vista pasando sus valores en la URL; si se
  // entra directamente se conservan los que ya trae el HTML.
  const params = new URLSearchParams(window.location.search);
  document.querySelectorAll('.summary-value[data-field]').forEach((valueEl) => {
    const value = params.get(valueEl.dataset.field);
    if (value) valueEl.textContent = value;
  });

  // El enlace de vuelta a Gestión conserva esos mismos datos.
  const query = params.toString();
  if (query) {
    const managementLink = document.querySelector('.breadcrumb a[href*="assignment-management"]');
    if (managementLink) managementLink.href = `${managementLink.getAttribute('href')}?${query}`;
  }

  // ---------- Filtros: Título y Tipo ----------

  // Los filtros viven en los encabezados de la tabla y los gestiona el componente
  // compartido column-filter.js (mismo patrón usado en Alumnos de la asignación).

  // ---------- Navegación a las calificaciones de la evaluación ----------

  // La acción "Gestionar" de cada fila abre las calificaciones de esa evaluación y le
  // pasa los datos de la asignación junto con los de la evaluación elegida, así esa
  // vista puede encabezar ambos bloques de contexto.
  const EVALUATION_FIELDS = ['evaluation', 'type', 'date'];

  document.querySelectorAll('.data-table tbody tr').forEach((row) => {
    const manageLink = row.querySelector('.manage-link');
    if (!manageLink) return;

    const scoresParams = new URLSearchParams(params);
    EVALUATION_FIELDS.forEach((field, index) => {
      const cell = row.cells[index];
      if (cell) scoresParams.set(field, cell.textContent.trim());
    });
    manageLink.href = `${manageLink.getAttribute('href')}?${scoresParams.toString()}`;
  });

  // ---------- Dropdowns del modal ----------

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

    label.dataset.placeholder = label.textContent.trim();

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
        label.classList.remove('placeholder');
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

  // ---------- Modal compartido: Nueva evaluación / Editar evaluación ----------

  const evaluationOverlay = document.getElementById('evaluationOverlay');
  const openEvaluationModalBtn = document.getElementById('openNewEvaluationModalBtn');
  const cancelEvaluationBtn = document.getElementById('cancelEvaluationBtn');
  const saveEvaluationBtn = document.getElementById('saveEvaluationBtn');
  const evaluationModalTitle = document.getElementById('evaluationModalTitle');
  const evaluationModalSubtitle = evaluationOverlay.querySelector('.modal-header p');
  const cycleDescription = document.getElementById('evaluationCycleDescription');
  const yearBadge = document.getElementById('evaluationYearBadge');

  const titleInput = document.getElementById('evaluationTitleInput');
  const dateInput = document.getElementById('evaluationDateInput');
  const typeDropdown = evaluationOverlay.querySelector('[data-filter="evaluation-type"]');
  const typeLabel = typeDropdown.querySelector('.dropdown-label');
  const typeOptions = typeDropdown.querySelectorAll('.dropdown-option');

  const MONTH_ABBREVIATIONS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

  let modalTrigger = openEvaluationModalBtn;

  // Fecha de evaluación: solo día y mes. La "/" se inserta sola al escribir el mes,
  // y el cursor queda junto al mismo dígito al editar en medio del valor.
  function formatDateInput() {
    const digitsBeforeCursor = dateInput.value.slice(0, dateInput.selectionStart).replace(/\D/g, '').length;
    const digits = dateInput.value.replace(/\D/g, '').slice(0, 4);
    let formatted = digits.slice(0, 2);
    if (digits.length > 2) formatted += '/' + digits.slice(2, 4);
    let cursor = 0;
    let digitCount = 0;

    while (cursor < formatted.length && digitCount < digitsBeforeCursor) {
      if (formatted[cursor] !== '/') digitCount += 1;
      cursor += 1;
    }

    dateInput.value = formatted;
    dateInput.setSelectionRange(cursor, cursor);
  }

  function updateSaveButtonState() {
    const hasTitle = titleInput.value.trim().length > 0;
    const hasType = Boolean(typeDropdown.querySelector('.dropdown-option.selected'));
    const hasDate = /^\d{2}\/\d{2}$/.test(dateInput.value);
    saveEvaluationBtn.disabled = !(hasTitle && hasType && hasDate);
  }

  function resetEvaluationForm() {
    titleInput.value = '';
    dateInput.value = '';
    typeOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    typeLabel.textContent = typeLabel.dataset.placeholder;
    typeLabel.classList.add('placeholder');
  }

  function openEvaluationModal(row = null, trigger = openEvaluationModalBtn) {
    const isEditing = Boolean(row);
    modalTrigger = trigger;
    resetEvaluationForm();

    evaluationModalTitle.textContent = isEditing ? 'Editar evaluación' : 'Nueva evaluación';
    evaluationModalSubtitle.textContent = isEditing
      ? 'Modifica los datos de la evaluación'
      : 'Completa los datos para crear una nueva evaluación';
    cycleDescription.textContent = isEditing
      ? 'La fecha conserva el año del ciclo lectivo actual.'
      : 'La fecha tomará el año del ciclo lectivo actual.';
    saveEvaluationBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear evaluación';
    yearBadge.textContent = String(new Date().getFullYear());

    if (row) {
      const [title, type, date] = Array.from(row.cells, (cell) => cell.textContent.trim());
      titleInput.value = title;
      Array.from(typeOptions).find((option) => option.textContent.trim() === type)?.click();
      // La tabla muestra la fecha como "DD MMM AAAA"; el campo la espera como DD/MM.
      const [day, month, year] = date.split(' ');
      const monthNumber = String(MONTH_ABBREVIATIONS.indexOf(month) + 1).padStart(2, '0');
      dateInput.value = `${day}/${monthNumber}`;
      yearBadge.textContent = year;
    }

    updateSaveButtonState();
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    evaluationOverlay.classList.add('is-open');
    evaluationOverlay.querySelector('.modal').scrollTop = 0;
    titleInput.focus();
  }

  function closeEvaluationModal() {
    evaluationOverlay.classList.remove('is-open');
    closeAllDropdowns();
    modalTrigger?.focus();
  }

  titleInput.addEventListener('input', updateSaveButtonState);
  dateInput.addEventListener('input', () => {
    formatDateInput();
    updateSaveButtonState();
  });
  typeOptions.forEach((option) => option.addEventListener('click', updateSaveButtonState));

  openEvaluationModalBtn.addEventListener('click', () => openEvaluationModal());
  document.querySelectorAll('.data-table tbody [data-action=edit]').forEach((button) => {
    button.addEventListener('click', () => openEvaluationModal(button.closest('tr'), button));
  });

  // Escape cierra primero el desplegable abierto y, si no hay ninguno, el modal.
  evaluationOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !typeDropdown.classList.contains('open')) closeEvaluationModal();
  });

  cancelEvaluationBtn.addEventListener('click', closeEvaluationModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  saveEvaluationBtn.addEventListener('click', () => {
    // Vista puramente visual: crear y guardar no modifican datos persistidos.
    closeEvaluationModal();
  });

  // ---------- Modal: Eliminar evaluación ----------

  const deleteOverlay = document.getElementById('deleteEvaluationOverlay');
  const cancelDeleteBtn = document.getElementById('cancelDeleteEvaluationBtn');
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
  document.getElementById('confirmDeleteEvaluationBtn').addEventListener('click', () => {
    // Vista puramente visual: la eliminación real se conecta cuando exista la capa de servicios/IPC.
    closeDeleteModal();
  });

});
