// Vista Evaluaciones de una asignación (Profesor): la tarjeta superior muestra el curso, el nivel
// educativo, la materia y el ciclo lectivo de la asignación elegida en Asignaciones, que
// <assignment-summary> le pide al proceso principal con el id que trae la URL (?assignmentId=).
// Hasta que llegan, cada dato muestra una raya.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta, el alta y la tabla se ocultan y queda solo el mensaje de error.
// La tabla de evaluaciones y sus modales siguen siendo una maqueta: interacción puramente visual,
// sin lógica de negocio.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const evaluationsActions = document.querySelector('.evaluations-actions');
  const evaluationsCard = document.querySelector('.evaluations-card');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // Si la asignación no llega, tampoco hay evaluaciones que gestionar.
  summary.loadAssignment(loadError).then((assignment) => {
    if (assignment) return;
    evaluationsActions.hidden = true;
    evaluationsCard.hidden = true;
  });

  // El enlace de vuelta a Gestión conserva el id de la asignación, con el que esa vista la carga.
  const assignmentId = new URLSearchParams(window.location.search).get('assignmentId');
  const assignmentParams = new URLSearchParams(assignmentId ? { assignmentId } : {});
  const query = assignmentParams.toString();
  if (query) {
    const managementLink = document.querySelector('.breadcrumb a[href*="assignment-management"]');
    if (managementLink) managementLink.href = `${managementLink.getAttribute('href')}?${query}`;
  }

  // ---------- Filtros: Título y Tipo ----------

  // Los filtros viven en los encabezados de la tabla y los gestiona el componente
  // compartido column-filter.js (mismo patrón usado en Alumnos de la asignación).

  // ---------- Navegación a las calificaciones de la evaluación ----------

  // La acción "Gestionar" de cada fila abre las calificaciones de esa evaluación y le pasa el id
  // de la asignación, con el que esa vista la carga, junto con el título de la fila, que es el
  // paso de la evaluación en su ruta de navegación.
  document.querySelectorAll('.data-table tbody tr').forEach((row) => {
    const manageLink = row.querySelector('.manage-link');
    if (!manageLink) return;

    const scoresParams = new URLSearchParams(assignmentParams);
    scoresParams.set('evaluation', row.cells[0].textContent.trim());
    manageLink.href = `${manageLink.getAttribute('href')}?${scoresParams.toString()}`;
  });

  // ---------- Dropdowns del modal ----------

  // Apertura, cierre y selección: componente compartido dropdown.component.js. También guarda
  // en data-placeholder el texto inicial de la etiqueta, que usa el reinicio del formulario.
  const { closeAllDropdowns } = setupDropdowns();

  // ---------- Modal compartido: Nueva evaluación / Editar evaluación ----------

  const evaluationOverlay = document.getElementById('evaluationOverlay');
  const openEvaluationModalBtn = document.getElementById('openNewEvaluationModalBtn');
  const cancelEvaluationBtn = document.getElementById('cancelEvaluationBtn');
  const saveEvaluationBtn = document.getElementById('saveEvaluationBtn');
  const evaluationModalTitle = document.getElementById('evaluationModalTitle');
  const evaluationModalSubtitle = evaluationOverlay.querySelector('.modal-header p');
  const cycleDescription = evaluationOverlay.querySelector('.info-box-text span');
  const cycleYear = document.getElementById('evaluationYear');

  const titleInput = document.getElementById('evaluationTitleInput');
  const dateInput = document.getElementById('evaluationDateInput');
  const typeDropdown = evaluationOverlay.querySelector('[data-filter="evaluation-type"]');
  const typeLabel = typeDropdown.querySelector('.dropdown-label');
  const typeOptions = typeDropdown.querySelectorAll('.dropdown-option');

  const MONTH_ABBREVIATIONS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

  let modalTrigger = openEvaluationModalBtn;

  // Máscara DD/MM de la fecha, formato del título y errores: componente compartido
  // field-validation.component.js. La fecha se valida contra el año del ciclo (cycleYear).

  function updateSaveButtonState() {
    const hasTitle = titleInput.value.trim().length > 0;
    const hasType = Boolean(typeDropdown.querySelector('.dropdown-option.selected'));
    const hasDate = /^\d{2}\/\d{2}$/.test(dateInput.value);
    saveEvaluationBtn.disabled = !(hasTitle && hasType && hasDate);
  }

  function resetEvaluationForm() {
    titleInput.value = '';
    dateInput.value = '';
    clearFieldErrors(evaluationOverlay);
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
      ? 'Pertenece al ciclo lectivo:'
      : 'Se creará para el ciclo lectivo:';
    saveEvaluationBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear evaluación';
    cycleYear.textContent = String(new Date().getFullYear());

    if (row) {
      const [title, type, date] = Array.from(row.cells, (cell) => cell.textContent.trim());
      titleInput.value = title;
      Array.from(typeOptions).find((option) => option.textContent.trim() === type)?.click();
      // La tabla muestra la fecha como "DD MMM AAAA"; el campo la espera como DD/MM.
      const [day, month, year] = date.split(' ');
      const monthNumber = String(MONTH_ABBREVIATIONS.indexOf(month) + 1).padStart(2, '0');
      dateInput.value = `${day}/${monthNumber}`;
      cycleYear.textContent = year;
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
  dateInput.addEventListener('input', updateSaveButtonState);
  typeOptions.forEach((option) => option.addEventListener('click', updateSaveButtonState));

  openEvaluationModalBtn.addEventListener('click', () => openEvaluationModal());
  document.querySelectorAll('.data-table tbody [data-action=edit]').forEach((button) => {
    button.addEventListener('click', () => openEvaluationModal(button.closest('tr'), button));
  });

  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && evaluationOverlay.classList.contains('is-open')) closeEvaluationModal();
  });

  cancelEvaluationBtn.addEventListener('click', closeEvaluationModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  saveEvaluationBtn.addEventListener('click', () => {
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(evaluationOverlay)) return;
    // Vista puramente visual: crear y guardar no modifican datos persistidos.
    closeEvaluationModal();
  });

  // ---------- Modal: Eliminar evaluación ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteEvaluationOverlay'), { beforeOpen: closeAllDropdowns });

});
