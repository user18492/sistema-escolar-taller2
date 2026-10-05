// Vista Cursos del Administrador: la tabla muestra los cursos de la institución, de todos los
// ciclos lectivos, que llegan del proceso principal (window.api.courses.list), y los filtros de
// columna los filtran en memoria. La lista filtrada se pagina en memoria, 10 por página, con
// <table-pagination>.
// Nuevo curso, Editar y Eliminar siguen siendo visuales: no modifican datos persistidos.

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  // También guarda en data-placeholder el texto inicial de las etiquetas con .placeholder, que
  // usa el reinicio del formulario.
  const { closeDropdown, closeAllDropdowns } = setupDropdowns();

  // ---------- Tabla: cursos de la institución ----------

  const table = document.querySelector('.courses-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('courseRowTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.courses-card table-pagination');
  // Grado: el componente del panel guarda los grados marcados (grade-dropdown.js)
  const gradeFilter = table.querySelector('th[data-filter="grade"] grade-dropdown');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar los cursos. Intentá nuevamente.';

  // Textos de Turno y Nivel educativo tomados de las opciones del filtro y del formulario, para que
  // la celda diga lo mismo que ellos. Llegan como MORNING o AFTERNOON y PRIMARY o SECONDARY.
  const labelsOf = (selector) => Object.fromEntries(
    Array.from(document.querySelectorAll(`${selector} .dropdown-option`), (option) => [option.dataset.value, option.textContent.trim()])
  );
  const shiftLabels = labelsOf('#shiftFilter');
  const levelLabels = labelsOf('[data-filter="new-course-level"]');

  // En el orden en que llegan del proceso principal
  let courses = [];
  let isLoaded = false;

  // Un grado se repite entre niveles educativos (hay un 1° de primaria y otro de secundaria): se lo
  // identifica con los dos datos
  const gradeKey = (level, name) => `${level}:${name}`;

  // Lo que filtra cada columna, por su data-filter: los grados marcados, la división escrita, el
  // turno elegido y el año completo. Vacío (nada marcado, "Todos" o sin texto) no filtra.
  const activeFilters = { grade: [], division: '', shift: [], year: '' };

  // Valor de cada filtro después de un cambio: el de Grado lo da su componente y los demás llegan
  // en el detalle de column-filter-change
  const FILTER_VALUES = {
    grade: () => gradeFilter.selectedGrades.map(({ level, name }) => gradeKey(level, name)),
    // Sin distinguir mayúsculas: la división se guarda como una letra mayúscula
    division: ({ text }) => text.toLocaleUpperCase('es'),
    shift: ({ values }) => values,
    year: ({ text }) => text,
  };

  // Si el curso pasa el filtro de la columna con ese valor, que no está vacío
  const FILTER_MATCHERS = {
    grade: (course, grades) => grades.includes(gradeKey(course.educationLevel, course.gradeName)),
    division: (course, division) => course.division === division,
    shift: (course, shifts) => shifts.includes(course.shift),
    year: (course, year) => String(course.schoolYear) === year,
  };

  // Entre columnas se combinan con Y; un filtro vacío no descarta nada
  const matchesFilters = (course) =>
    Object.entries(activeFilters).every(([filter, value]) => value.length === 0 || FILTER_MATCHERS[filter](course, value));

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // curso_id en data-course-id.
  const createRow = (course) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.courseId = String(course.id);
    const texts = [
      course.gradeName,
      course.division,
      shiftLabels[course.shift] ?? course.shift,
      levelLabels[course.educationLevel] ?? course.educationLevel,
      course.schoolYear,
    ];
    texts.forEach((text, index) => {
      row.cells[index].textContent = text ?? '';
    });
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de los cursos que pasan los filtros (10 por
  // página, en memoria). Al cambiar un filtro se vuelve a la página 1; al recargar se conserva, y
  // el componente la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const visibleCourses = courses.filter(matchesFilters);
    const pageCourses = pagination.slice(visibleCourses, { page });
    if (pageCourses.length) tbody.replaceChildren(...pageCourses.map(createRow));
    else showMessage(courses.length ? 'Ningún curso coincide con los filtros.' : 'No hay cursos registrados.');
  };

  // Punto de entrada también para volver a pedir la lista cuando la que está en memoria quede
  // vieja. Conserva la página y los filtros.
  async function loadCourses() {
    isLoaded = false;
    showMessage('Cargando cursos…');
    let response;
    try {
      response = await window.api?.courses?.list();
    } catch (error) {
      console.error('Error al cargar los cursos:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    courses = response.courses;
    isLoaded = true;
    renderRows();
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Si lo que filtra no cambió (el
  // campo de año avisa cada tecla, aunque el año incompleto todavía no filtre), la tabla y la
  // página quedan como están. Mientras carga o si la carga falló, se guarda el valor sin reemplazar
  // el mensaje de la tabla.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const { filter } = event.target.dataset;
    const value = FILTER_VALUES[filter](event.detail);
    if (String(value) === String(activeFilters[filter])) return;
    activeFilters[filter] = value;
    if (isLoaded) renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadCourses();

  // ---------- Modal compartido: Nuevo curso / Editar curso ----------

  const courseOverlay = document.getElementById('newCourseOverlay');
  const openCourseModalBtn = document.getElementById('openNewCourseModalBtn');
  const cancelCourseBtn = document.getElementById('cancelNewCourseBtn');
  const createCourseBtn = document.getElementById('createCourseBtn');
  const courseTitle = document.getElementById('newCourseTitle');
  const courseSubtitle = courseOverlay.querySelector('.modal-header p');
  const cycleDescription = courseOverlay.querySelector('.info-box-text p');
  let modalTrigger = null;

  // Formato y error de la división: componente compartido field-validation.component.js.
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
    clearFieldErrors(courseOverlay);

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

  // `trigger` es el botón que lo abre, al que vuelve el foco al cerrarlo; `row`, la fila del curso
  // que se edita
  function openCourseModal(trigger, row = null) {
    resetCourseForm();
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    modalTrigger = trigger;
    const isEditing = Boolean(row);
    courseTitle.textContent = isEditing ? 'Editar curso' : 'Nuevo curso';
    courseSubtitle.textContent = isEditing
      ? 'Modifica los datos del curso'
      : 'Completa los datos para crear un nuevo curso';
    cycleDescription.textContent = isEditing
      ? 'El curso pertenece al ciclo lectivo actual.'
      : 'El curso se creará para el ciclo lectivo actual.';
    createCourseBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear curso';
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

  openCourseModalBtn.addEventListener('click', () => openCourseModal(openCourseModalBtn));
  cancelCourseBtn.addEventListener('click', closeCourseModal);
  // Por delegación: las filas se generan al cargar los cursos, al filtrar y al cambiar de página
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openCourseModal(button, button.closest('tr'));
  });

  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && courseOverlay.classList.contains('is-open')) closeCourseModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createCourseBtn.addEventListener('click', () => {
    // Con la división inválida, el modal sigue abierto con el foco en ella.
    if (validateFields(courseOverlay)) return;
    // Vista puramente visual: crear y guardar no modifican datos persistidos.
    closeCourseModal();
  });

  // ---------- Modal: Eliminar curso ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteCourseOverlay'), { beforeOpen: closeAllDropdowns });
});
