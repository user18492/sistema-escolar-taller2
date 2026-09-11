// Vista Cursos del Administrador — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  const dropdowns = document.querySelectorAll('.dropdown');

  document.querySelectorAll('.dropdown-label.placeholder').forEach((label) => {
    label.dataset.placeholder = label.textContent.trim();
  });

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
        label.textContent = option.dataset.label ?? option.textContent.trim();
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

  // ---------- Modal compartido: Nuevo curso / Editar curso ----------

  const courseOverlay = document.getElementById('newCourseOverlay');
  const openCourseModalBtn = document.getElementById('openNewCourseModalBtn');
  const cancelCourseBtn = document.getElementById('cancelNewCourseBtn');
  const createCourseBtn = document.getElementById('createCourseBtn');
  const courseTitle = document.getElementById('newCourseTitle');
  const courseSubtitle = courseOverlay.querySelector('.modal-header p');
  const cycleDescription = courseOverlay.querySelector('.info-box-text p');
  const dangerZone = document.getElementById('courseDangerZone');
  let modalTrigger = null;

  const divisionInput = document.getElementById('newCourseDivision');

  const gradeDropdown = courseOverlay.querySelector('[data-filter="new-course-grade"]');
  const gradeLabel = gradeDropdown.querySelector('.dropdown-label');
  const gradeCards = gradeDropdown.querySelectorAll('.grade-card');

  const yearBadge = document.getElementById('newCourseYearBadge');
  yearBadge.textContent = String(new Date().getFullYear());

  const courseSelectDropdowns = courseOverlay.querySelectorAll(
    '[data-filter="new-course-shift"], [data-filter="new-course-level"]'
  );

  function updateCreateButtonState() {
    const hasGrade = Boolean(gradeDropdown.querySelector('.grade-card.selected'));
    const hasDivision = divisionInput.value.trim().length > 0;
    const hasShift = Boolean(
      courseOverlay.querySelector('[data-filter="new-course-shift"] .dropdown-option.selected')
    );
    const hasLevel = Boolean(
      courseOverlay.querySelector('[data-filter="new-course-level"] .dropdown-option.selected')
    );
    createCourseBtn.disabled = !(hasGrade && hasDivision && hasShift && hasLevel);
  }

  gradeCards.forEach((card) => {
    card.addEventListener('click', () => {
      gradeCards.forEach((c) => {
        c.classList.remove('selected');
        c.setAttribute('aria-selected', 'false');
      });
      card.classList.add('selected');
      card.setAttribute('aria-selected', 'true');
      gradeLabel.textContent = `${card.dataset.value}°`;
      gradeLabel.classList.remove('placeholder');
      closeDropdown(gradeDropdown);
      updateCreateButtonState();
    });
  });

  divisionInput.addEventListener('input', updateCreateButtonState);

  courseSelectDropdowns.forEach((dropdown) => {
    dropdown.querySelectorAll('.dropdown-option').forEach((option) => {
      option.addEventListener('click', updateCreateButtonState);
    });
  });

  function resetCourseForm() {
    divisionInput.value = '';

    gradeCards.forEach((card) => {
      card.classList.remove('selected');
      card.setAttribute('aria-selected', 'false');
    });
    gradeLabel.textContent = gradeLabel.dataset.placeholder;
    gradeLabel.classList.add('placeholder');

    courseSelectDropdowns.forEach((dropdown) => {
      const label = dropdown.querySelector('.dropdown-label');
      const options = dropdown.querySelectorAll('.dropdown-option');
      options.forEach((o) => {
        o.classList.remove('selected');
        o.setAttribute('aria-selected', 'false');
      });
      label.textContent = label.dataset.placeholder;
      label.classList.add('placeholder');
    });

    updateCreateButtonState();
  }

  function openCourseModal(event, row = null) {
    resetCourseForm();
    closeAllDropdowns();
    modalTrigger = event.currentTarget;
    const isEditing = Boolean(row);
    courseTitle.textContent = isEditing ? 'Editar curso' : 'Nuevo curso';
    courseSubtitle.textContent = isEditing
      ? 'Modifica los datos del curso'
      : 'Completa los datos para crear un nuevo curso';
    cycleDescription.textContent = isEditing
      ? 'El curso pertenece al ciclo lectivo actual.'
      : 'El curso se creará para el ciclo lectivo actual.';
    createCourseBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear curso';
    dangerZone.hidden = !isEditing;
    yearBadge.textContent = String(new Date().getFullYear());

    if (row) {
      const [grade, division, shift, level, year] = Array.from(row.cells, (cell) => cell.textContent.trim());
      divisionInput.value = division;
      Array.from(gradeCards).find((card) => card.textContent.trim() === grade)?.click();
      courseSelectDropdowns.forEach((dropdown, index) => {
        const value = index === 0 ? shift : level;
        Array.from(dropdown.querySelectorAll('.dropdown-option'))
          .find((option) => option.textContent.trim() === value)?.click();
      });
      yearBadge.textContent = year;
      updateCreateButtonState();
    }
    courseOverlay.classList.add('is-open');
    gradeDropdown.querySelector('.dropdown-toggle').focus();
  }

  function closeCourseModal() {
    courseOverlay.classList.remove('is-open');
    closeAllDropdowns();
    modalTrigger?.focus();
  }

  openCourseModalBtn.addEventListener('click', openCourseModal);
  cancelCourseBtn.addEventListener('click', closeCourseModal);
  document.querySelectorAll('.data-table tbody [data-action=edit]').forEach((button) => {
    button.addEventListener('click', (event) => openCourseModal(event, button.closest('tr')));
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createCourseBtn.addEventListener('click', () => {
    // Vista puramente visual: crear y guardar no modifican datos persistidos.
    closeCourseModal();
  });
});
