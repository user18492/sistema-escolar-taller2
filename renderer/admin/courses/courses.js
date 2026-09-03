// Vista Cursos del Administrador — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  sidebarToggle.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  });

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

  // ---------- Modal: Nuevo curso ----------

  const courseOverlay = document.getElementById('newCourseOverlay');
  const openCourseModalBtn = document.getElementById('openNewCourseModalBtn');
  const cancelCourseBtn = document.getElementById('cancelNewCourseBtn');
  const createCourseBtn = document.getElementById('createCourseBtn');

  const divisionInput = document.getElementById('newCourseDivision');

  const gradeDropdown = courseOverlay.querySelector('[data-filter="new-course-grade"]');
  const gradeLabel = gradeDropdown.querySelector('.dropdown-label');
  const gradeCards = gradeDropdown.querySelectorAll('.grade-card');

  const yearBadge = document.getElementById('newCourseYearBadge');
  yearBadge.textContent = String(new Date().getFullYear());

  const courseSelectDropdowns = courseOverlay.querySelectorAll(
    '[data-filter="new-course-shift"], [data-filter="new-course-level"]'
  );

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
  }

  function openCourseModal() {
    resetCourseForm();
    courseOverlay.classList.add('is-open');
  }

  function closeCourseModal() {
    courseOverlay.classList.remove('is-open');
    closeAllDropdowns();
  }

  openCourseModalBtn.addEventListener('click', openCourseModal);
  cancelCourseBtn.addEventListener('click', closeCourseModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createCourseBtn.addEventListener('click', () => {
    // Vista puramente visual: el alta real se conecta cuando exista la capa de servicios/IPC.
    closeCourseModal();
  });
});
