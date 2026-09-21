// Vista Docencia del Administrador — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  // También guarda en data-placeholder el texto inicial de las etiquetas con .placeholder, que
  // usa el reinicio del formulario. Abrir un dropdown, hacer clic fuera de los buscadores o
  // pulsar Escape cierra también los buscadores (searchable-select.component.js).
  const { closeAllDropdowns } = setupDropdowns({
    onToggle: closeAllSearchableMenus,
    onDismiss: dismissSearchableMenus,
  });

  // Los textos truncados (nombre / email del profesor) muestran su tooltip con el
  // componente compartido text-truncate.component.js.

  // ---------- Modal: Nueva asignación ----------

  const assignmentOverlay = document.getElementById('newAssignmentOverlay');
  const openAssignmentModalBtn = document.getElementById('openNewAssignmentModalBtn');
  const cancelAssignmentBtn = document.getElementById('cancelNewAssignmentBtn');
  const createAssignmentBtn = document.getElementById('createAssignmentBtn');
  const assignmentTitle = document.getElementById('newAssignmentTitle');
  const assignmentSubtitle = assignmentOverlay.querySelector('.modal-header p');
  const cycleDescription = assignmentOverlay.querySelector('.info-box-text p');
  let modalTrigger = null;

  const assignmentYearBadge = document.getElementById('newAssignmentYearBadge');
  assignmentYearBadge.textContent = String(new Date().getFullYear());

  const teacherRoot = assignmentOverlay.querySelector('[data-role="teacher-select"]');
  const courseRoot = assignmentOverlay.querySelector('[data-role="course-select"]');
  const levelDropdown = assignmentOverlay.querySelector('[data-filter="new-assignment-level"]');
  const levelLabel = levelDropdown.querySelector('.dropdown-label');
  const levelOptions = levelDropdown.querySelectorAll('.dropdown-option');
  const subjectDropdown = assignmentOverlay.querySelector('[data-filter="new-assignment-subject"]');
  const subjectToggle = subjectDropdown.querySelector('.dropdown-toggle');
  const subjectLabel = subjectDropdown.querySelector('.dropdown-label');
  const subjectOptions = subjectDropdown.querySelectorAll('.dropdown-option');
  const unavailableSubjects = Array.from(subjectOptions).filter((option) => option.classList.contains('disabled'));

  const COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';
  const SUBJECT_LOCKED_PLACEHOLDER = 'Selecciona primero un curso';
  const SUBJECT_UNLOCKED_PLACEHOLDER = 'Seleccionar materia';

  // Campos con búsqueda integrada (Profesor y Curso): componente compartido
  // searchable-select.component.js. El valor muestra la opción completa (avatar, nombre y
  // email) y reiniciar el campo también quita el filtro por nivel; el filtro se aplica al
  // volver a abrir la lista.
  const searchableOptions = {
    onOpen: closeAllDropdowns,
    valueContent: 'markup',
    resetClearsGroupFilter: true,
    filterOnGroupChange: false,
  };
  const teacherSelect = setupSearchableSelect(teacherRoot, searchableOptions);
  const courseSelect = setupSearchableSelect(courseRoot, searchableOptions);

  function updateCreateButtonState() {
    const hasTeacher = Boolean(teacherSelect.getValue());
    const hasLevel = Boolean(levelDropdown.querySelector('.dropdown-option.selected'));
    const hasCourse = Boolean(courseSelect.getValue());
    const hasSubject = Boolean(subjectDropdown.querySelector('.dropdown-option.selected'));
    createAssignmentBtn.disabled = !(hasTeacher && hasLevel && hasCourse && hasSubject);
  }

  function lockSubject() {
    subjectDropdown.classList.add('is-locked');
    subjectToggle.disabled = true;
    subjectOptions.forEach((o) => {
      o.classList.remove('selected');
      o.setAttribute('aria-selected', 'false');
    });
    subjectLabel.textContent = SUBJECT_LOCKED_PLACEHOLDER;
    subjectLabel.classList.add('placeholder');
  }

  function unlockSubject() {
    subjectDropdown.classList.remove('is-locked');
    subjectToggle.disabled = false;
    subjectLabel.textContent = SUBJECT_UNLOCKED_PLACEHOLDER;
    subjectLabel.classList.add('placeholder');
  }

  teacherSelect.onSelect(updateCreateButtonState);

  courseSelect.onSelect(() => {
    unlockSubject();
    updateCreateButtonState();
  });

  courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);

  levelOptions.forEach((option) => {
    option.addEventListener('click', () => {
      courseSelect.reset();
      courseSelect.setGroupFilter(option.dataset.value);
      courseSelect.unlock(COURSE_UNLOCKED_PLACEHOLDER);
      lockSubject();
      updateCreateButtonState();
    });
  });

  subjectOptions.forEach((option) => {
    option.addEventListener('click', updateCreateButtonState);
  });

  function resetAssignmentForm() {
    unavailableSubjects.forEach((option) => {
      option.classList.add('disabled');
      option.setAttribute('aria-disabled', 'true');
      option.querySelector('.option-badge').hidden = false;
    });
    teacherSelect.reset();

    levelOptions.forEach((o) => {
      o.classList.remove('selected');
      o.setAttribute('aria-selected', 'false');
    });
    levelLabel.textContent = levelLabel.dataset.placeholder;
    levelLabel.classList.add('placeholder');

    courseSelect.reset();
    courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);

    lockSubject();

    updateCreateButtonState();
  }

  function openAssignmentModal(event, row = null) {
    resetAssignmentForm();
    closeAllDropdowns();
    closeAllSearchableMenus();
    modalTrigger = event.currentTarget;
    const isEditing = Boolean(row);
    assignmentTitle.textContent = isEditing ? 'Editar asignación' : 'Nueva asignación';
    assignmentSubtitle.textContent = isEditing
      ? 'Modifica los datos de la asignación'
      : 'Completa los datos para crear una nueva asignación docente';
    cycleDescription.textContent = isEditing
      ? 'La asignación pertenece al ciclo lectivo actual.'
      : 'La asignación se creará para el ciclo lectivo actual.';
    createAssignmentBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear asignación';
    assignmentYearBadge.textContent = String(new Date().getFullYear());

    if (row) {
      const email = row.querySelector('.teacher-email').textContent.trim();
      const [, course, level, subject, year] = Array.from(row.cells, (cell) => cell.textContent.trim());
      Array.from(teacherRoot.querySelectorAll('.dropdown-option'))
        .find((option) => option.querySelector('.option-email').textContent.trim() === email)?.click();
      const levelOption = Array.from(levelOptions).find((option) => option.textContent.trim() === level);
      levelOption?.click();
      Array.from(courseRoot.querySelectorAll('.dropdown-option'))
        .find((option) => option.textContent.trim() === course && option.dataset.level === levelOption?.dataset.value)?.click();
      const subjectOption = Array.from(subjectOptions).find((option) =>
        (option.querySelector('.option-name') ?? option).textContent.trim() === subject);
      if (subjectOption) {
        subjectOption.classList.remove('disabled');
        subjectOption.setAttribute('aria-disabled', 'false');
        const badge = subjectOption.querySelector('.option-badge');
        if (badge) badge.hidden = true;
        subjectOption.dataset.label = subject;
        subjectOption.click();
      }
      assignmentYearBadge.textContent = year;
      updateCreateButtonState();
    }
    assignmentOverlay.classList.add('is-open');
    teacherRoot.querySelector('.searchable-chevron').focus();
  }

  function closeAssignmentModal() {
    assignmentOverlay.classList.remove('is-open');
    closeAllDropdowns();
    closeAllSearchableMenus();
    modalTrigger?.focus();
  }

  openAssignmentModalBtn.addEventListener('click', openAssignmentModal);
  cancelAssignmentBtn.addEventListener('click', closeAssignmentModal);
  document.querySelectorAll('.data-table tbody [data-action=edit]').forEach((button) => {
    button.addEventListener('click', (event) => openAssignmentModal(event, button.closest('tr')));
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createAssignmentBtn.addEventListener('click', () => {
    // Vista puramente visual: crear y guardar no modifican datos persistidos.
    closeAssignmentModal();
  });

  // ---------- Modal: Eliminar asignación ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteAssignmentOverlay'), {
    beforeOpen: () => {
      closeAllDropdowns();
      closeAllSearchableMenus();
    },
  });
});
