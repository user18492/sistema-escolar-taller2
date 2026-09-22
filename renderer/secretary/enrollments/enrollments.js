// Vista Inscripciones del Secretario — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  // Abrir un dropdown, hacer clic fuera de los buscadores o pulsar Escape cierra también los
  // buscadores (searchable-select.component.js).
  const { closeAllDropdowns } = setupDropdowns({
    onToggle: closeAllSearchableMenus,
    onDismiss: dismissSearchableMenus,
  });

  // Los filtros de Número de inscripción / Alumno / Curso / Estado viven en los encabezados
  // de la tabla y los gestiona el componente compartido column-filter.js; Curso incrusta
  // <course-filter>, el mismo filtro compuesto de Docencia.

  // ---------- Modal: Nueva inscripción ----------

  const enrollmentOverlay = document.getElementById('newEnrollmentOverlay');
  const openEnrollmentModalBtn = document.getElementById('openNewEnrollmentModalBtn');
  const cancelEnrollmentBtn = document.getElementById('cancelNewEnrollmentBtn');
  const createEnrollmentBtn = document.getElementById('createEnrollmentBtn');

  const MODAL_LEVEL_PLACEHOLDER = 'Seleccionar nivel educativo';
  const MODAL_COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const MODAL_COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';

  // Campos con búsqueda integrada (Alumno y Curso): componente compartido
  // searchable-select.component.js. El valor muestra solo el nombre, reiniciar el campo
  // conserva el filtro por nivel y cambiar de nivel vuelve a filtrar la lista en el momento.
  const searchableOptions = {
    onOpen: closeAllDropdowns,
    valueContent: 'name',
    resetClearsGroupFilter: false,
    filterOnGroupChange: true,
  };
  const modalStudentSelect = setupSearchableSelect(
    enrollmentOverlay.querySelector('[data-role="new-enrollment-student-select"]'),
    searchableOptions
  );
  const modalCourseSelect = setupSearchableSelect(
    enrollmentOverlay.querySelector('[data-role="new-enrollment-course-select"]'),
    searchableOptions
  );

  const modalLevelDropdown = enrollmentOverlay.querySelector('[data-filter="new-enrollment-level"]');
  const modalLevelLabel = modalLevelDropdown.querySelector('.dropdown-label');
  const modalLevelOptions = modalLevelDropdown.querySelectorAll('.dropdown-option');

  function updateCreateButtonState() {
    const hasStudent = Boolean(modalStudentSelect.getValue());
    const hasLevel = Boolean(modalLevelDropdown.querySelector('.dropdown-option.selected'));
    const hasCourse = Boolean(modalCourseSelect.getValue());
    createEnrollmentBtn.disabled = !(hasStudent && hasLevel && hasCourse);
  }

  modalStudentSelect.onSelect(updateCreateButtonState);
  modalCourseSelect.onSelect(updateCreateButtonState);

  modalCourseSelect.lock(MODAL_COURSE_LOCKED_PLACEHOLDER);

  // Curso depende del nivel: cambiar de nivel descarta el curso ya elegido.
  modalLevelOptions.forEach((option) => {
    option.addEventListener('click', () => {
      modalLevelLabel.classList.remove('placeholder');
      modalCourseSelect.reset();
      modalCourseSelect.setGroupFilter(option.dataset.value);
      modalCourseSelect.unlock(MODAL_COURSE_UNLOCKED_PLACEHOLDER);
      updateCreateButtonState();
    });
  });

  function resetEnrollmentForm() {
    modalStudentSelect.reset();

    modalLevelOptions.forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    modalLevelLabel.textContent = MODAL_LEVEL_PLACEHOLDER;
    modalLevelLabel.classList.add('placeholder');

    modalCourseSelect.reset();
    modalCourseSelect.setGroupFilter('');
    modalCourseSelect.lock(MODAL_COURSE_LOCKED_PLACEHOLDER);

    updateCreateButtonState();
  }

  function openEnrollmentModal() {
    resetEnrollmentForm();
    closeAllDropdowns();
    closeAllSearchableMenus();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    enrollmentOverlay.classList.add('is-open');
    enrollmentOverlay.querySelector('.modal').scrollTop = 0;
    modalStudentSelect.root.querySelector('.searchable-chevron').focus();
  }

  function closeEnrollmentModal() {
    enrollmentOverlay.classList.remove('is-open');
    closeAllDropdowns();
    closeAllSearchableMenus();
    openEnrollmentModalBtn.focus();
  }

  openEnrollmentModalBtn.addEventListener('click', openEnrollmentModal);
  cancelEnrollmentBtn.addEventListener('click', closeEnrollmentModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape cierra el modal si no hay un desplegable ni un buscador abiertos
  // (dropdown.component.js resuelve antes esa pulsación). Se escucha en el documento para que
  // funcione aunque el foco haya quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && enrollmentOverlay.classList.contains('is-open')) closeEnrollmentModal();
  });

  createEnrollmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeEnrollmentModal();
  });

  // ---------- Modal: Editar inscripción ----------

  const editOverlay = document.getElementById('editEnrollmentOverlay');
  const cancelEditEnrollmentBtn = document.getElementById('cancelEditEnrollmentBtn');
  const saveEnrollmentBtn = document.getElementById('saveEnrollmentBtn');

  const statusDropdown = editOverlay.querySelector('[data-filter="edit-enrollment-status"]');
  const statusLabel = statusDropdown.querySelector('.dropdown-label');
  const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');

  // Ícono "Editar" que abrió el modal: recupera el foco al cerrarlo.
  let editTrigger = null;

  // Marca la opción de estado cuyo texto coincide con el de la fila, replicando lo
  // que hace el listener del dropdown al elegirla con el ratón.
  function selectStatus(optionLabel) {
    statusOptions.forEach((option) => {
      const selected = option.textContent.trim() === optionLabel;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) statusLabel.textContent = option.textContent.trim();
    });
    statusLabel.classList.remove('placeholder');
  }

  statusOptions.forEach((option) => {
    option.addEventListener('click', () => {
      statusLabel.classList.remove('placeholder');
    });
  });

  function openEditModal(row, trigger) {
    editTrigger = trigger;
    selectStatus(row.cells[5].textContent.trim());

    closeAllDropdowns();
    closeAllSearchableMenus();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    editOverlay.classList.add('is-open');
    editOverlay.querySelector('.modal').scrollTop = 0;
    statusDropdown.querySelector('.dropdown-toggle').focus();
  }

  function closeEditModal() {
    editOverlay.classList.remove('is-open');
    closeAllDropdowns();
    editTrigger.focus();
  }

  document.querySelectorAll('.data-table tbody [data-action=edit]').forEach((button) => {
    button.addEventListener('click', () => openEditModal(button.closest('tr'), button));
  });

  cancelEditEnrollmentBtn.addEventListener('click', closeEditModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  // El foco con Tab se retiene en el modal mediante modal-focus-trap.component.js.
  // Escape: mismo criterio que en Nueva inscripción.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editOverlay.classList.contains('is-open')) closeEditModal();
  });

  saveEnrollmentBtn.addEventListener('click', () => {
    // Vista puramente visual: el guardado real se conecta cuando exista la capa de servicios/IPC.
    closeEditModal();
  });

  // ---------- Modal: Eliminar inscripción ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteEnrollmentOverlay'), {
    beforeOpen: () => {
      closeAllDropdowns();
      closeAllSearchableMenus();
    },
  });
});
