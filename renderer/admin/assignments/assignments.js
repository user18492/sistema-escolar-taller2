// Vista Docencia del Administrador: la tabla muestra las asignaciones docentes vigentes de la
// institución, de todos los ciclos lectivos, que llegan del proceso principal
// (window.api.teacherAssignments.list), y los filtros de columna las filtran en memoria. Las opciones
// de los filtros Profesor y Materia son los profesores y las materias de esas asignaciones. La lista
// filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// La foto de perfil de cada profesor se muestra con fillAvatar (user-avatar.component.js).
// Nueva asignación, Editar y Eliminar siguen siendo visuales: no modifican datos persistidos.

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

  // ---------- Tabla: asignaciones docentes de la institución ----------

  const table = document.querySelector('.assignments-card .data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('assignmentRowTemplate');
  const teacherOptionTemplate = document.getElementById('teacherOptionTemplate');
  const subjectOptionTemplate = document.getElementById('subjectOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = document.querySelector('.assignments-card table-pagination');
  const teacherHeader = table.querySelector('th[data-filter="teacher"]');
  const subjectHeader = table.querySelector('th[data-filter="subject"]');
  // Curso: el componente del panel guarda los grados, las divisiones y los turnos elegidos
  // (course-filter.js)
  const courseFilter = table.querySelector('th[data-filter="course"] course-filter');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar las asignaciones docentes. Intentá nuevamente.';

  // Textos de Turno y Nivel educativo tomados de los botones del filtro Curso y de las opciones del
  // formulario, para que la celda diga lo mismo que ellos. Llegan como MORNING o AFTERNOON y PRIMARY
  // o SECONDARY.
  const labelsOf = (selector) => Object.fromEntries(
    Array.from(document.querySelectorAll(selector), (element) => [element.dataset.value, element.textContent.trim()])
  );
  const shiftLabels = labelsOf('#courseFilter .course-filter-shift');
  const levelLabels = labelsOf('[data-filter="new-assignment-level"] .dropdown-option');

  // En el orden en que llegan del proceso principal
  let assignments = [];
  let isLoaded = false;

  // Un grado se repite entre niveles educativos (hay un 1° de primaria y otro de secundaria): se lo
  // identifica con los dos datos
  const gradeKey = (level, name) => `${level}:${name}`;

  // Lo que filtra cada dato de la asignación: el profesor elegido y las materias marcadas (por su
  // id), el año completo y, del curso, los grados marcados, las divisiones escritas y los turnos
  // activos. Vacío (nada elegido, "Todas" o sin texto) no filtra.
  const activeFilters = { teacher: [], grade: [], division: [], shift: [], subject: [], year: '' };

  // Valores de activeFilters que fija cada columna, por su data-filter, después de un cambio: los
  // tres de Curso los da su componente y los demás llegan en el detalle de column-filter-change
  const FILTER_VALUES = {
    teacher: ({ values }) => ({ teacher: values }),
    course: () => ({
      grade: courseFilter.selectedGrades.map(({ level, name }) => gradeKey(level, name)),
      division: courseFilter.selectedDivisions,
      shift: courseFilter.selectedShifts,
    }),
    subject: ({ values }) => ({ subject: values }),
    year: ({ text }) => ({ year: text }),
  };

  // Si la asignación pasa cada filtro con ese valor, que no está vacío. Con los dos turnos activos
  // pasan todas, igual que sin ninguno.
  const FILTER_MATCHERS = {
    teacher: ({ teacher }, ids) => ids.includes(String(teacher.id)),
    grade: ({ course }, grades) => grades.includes(gradeKey(course.educationLevel, course.gradeName)),
    division: ({ course }, divisions) => divisions.includes(course.division),
    shift: ({ course }, shifts) => shifts.includes(course.shift),
    subject: ({ subject }, ids) => ids.includes(String(subject.id)),
    year: ({ course }, year) => String(course.schoolYear) === year,
  };

  // Entre sí se combinan con Y; un filtro vacío no descarta nada
  const matchesFilters = (assignment) =>
    Object.entries(activeFilters).every(([filter, value]) => value.length === 0 || FILTER_MATCHERS[filter](assignment, value));

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // "1° A · Mañana"
  const courseName = (course) => `${course.gradeName} ${course.division} · ${shiftLabels[course.shift] ?? course.shift}`;

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // asignacion_docente_id en data-assignment-id.
  const createRow = ({ id, teacher, course, subject }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.assignmentId = String(id);
    fillAvatar(row.querySelector('.avatar-circle'), teacher);
    row.querySelector('.teacher-name').textContent = `${teacher.firstName} ${teacher.lastName}`;
    row.querySelector('.teacher-email').textContent = teacher.email;
    const texts = [
      courseName(course),
      levelLabels[course.educationLevel] ?? course.educationLevel,
      subject.name,
      course.schoolYear,
    ];
    // La primera celda es la del profesor
    texts.forEach((text, index) => {
      row.cells[index + 1].textContent = text ?? '';
    });
    return row;
  };

  const createTeacherOption = (teacher) => {
    const option = teacherOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(teacher.id);
    fillAvatar(option.querySelector('.avatar-circle'), teacher);
    option.querySelector('.option-name').textContent = `${teacher.lastName}, ${teacher.firstName}`;
    option.querySelector('.option-email').textContent = teacher.email;
    return option;
  };

  const createSubjectOption = (subject) => {
    const option = subjectOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(subject.id);
    option.textContent = subject.name;
    return option;
  };

  // Los profesores o las materias de las asignaciones cargadas, una vez cada uno
  const uniqueById = (items) => [...new Map(items.map((item) => [item.id, item])).values()];

  const nameCollator = new Intl.Collator('es');

  // Opciones de Profesor (por apellido y nombre) y de Materia (por nombre): solo los profesores y
  // las materias que tienen alguna asignación en la lista cargada. Las de Profesor van antes de
  // .dropdown-empty y las de Materia, después de "Todas"; column-filter.js las lee al usarlas.
  // Llegan sin marcar, así que esos dos filtros dejan de aplicarse y sus embudos se actualizan.
  const fillFilterOptions = () => {
    const teachers = uniqueById(assignments.map(({ teacher }) => teacher)).sort((a, b) =>
      nameCollator.compare(a.lastName, b.lastName) || nameCollator.compare(a.firstName, b.firstName) || a.id - b.id);
    const teacherList = teacherHeader.querySelector('[role="listbox"]');
    teacherList.replaceChildren(...teachers.map(createTeacherOption), teacherList.querySelector('.dropdown-empty'));

    const subjects = uniqueById(assignments.map(({ subject }) => subject)).sort((a, b) =>
      nameCollator.compare(a.name, b.name) || a.id - b.id);
    const subjectList = subjectHeader.querySelector('[role="listbox"]');
    subjectList.replaceChildren(subjectList.querySelector('.dropdown-option[data-value=""]'), ...subjects.map(createSubjectOption));

    activeFilters.teacher = [];
    activeFilters.subject = [];
    [teacherHeader, subjectHeader].forEach((header) => header.dispatchEvent(new Event('column-filter-refresh')));
  };

  // Muestra la página `page` (por defecto, la actual) de las asignaciones que pasan los filtros (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar un filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const visibleAssignments = assignments.filter(matchesFilters);
    const pageAssignments = pagination.slice(visibleAssignments, { page });
    if (pageAssignments.length) tbody.replaceChildren(...pageAssignments.map(createRow));
    else showMessage(assignments.length ? 'Ninguna asignación coincide con los filtros.' : 'No hay asignaciones docentes registradas.');
  };

  // Pide la lista y, al llegar, arma las opciones de Profesor y Materia y muestra las asignaciones
  // con lo que se haya elegido mientras tanto en Curso y Ciclo lectivo.
  async function loadAssignments() {
    isLoaded = false;
    showMessage('Cargando asignaciones docentes…');
    let response;
    try {
      response = await window.api?.teacherAssignments?.list();
    } catch (error) {
      console.error('Error al cargar las asignaciones docentes:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    assignments = response.teacherAssignments;
    isLoaded = true;
    fillFilterOptions();
    renderRows();
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Si lo que filtra no cambió (el
  // campo de año avisa cada tecla, aunque el año incompleto todavía no filtre, y Curso, cada clic
  // dentro de su panel), la tabla y la página quedan como están. Mientras carga o si la carga
  // falló, se guardan los valores sin reemplazar el mensaje de la tabla.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([filter, value]) => String(value) !== String(activeFilters[filter]));
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    if (isLoaded) renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadAssignments();

  // ---------- Modal: Nueva asignación ----------

  const assignmentOverlay = document.getElementById('newAssignmentOverlay');
  const openAssignmentModalBtn = document.getElementById('openNewAssignmentModalBtn');
  const cancelAssignmentBtn = document.getElementById('cancelNewAssignmentBtn');
  const createAssignmentBtn = document.getElementById('createAssignmentBtn');
  const assignmentTitle = document.getElementById('newAssignmentTitle');
  const assignmentSubtitle = assignmentOverlay.querySelector('.modal-header p');
  const cycleDescription = assignmentOverlay.querySelector('.info-box-text span');
  let modalTrigger = null;

  const assignmentCycleYear = document.getElementById('newAssignmentYear');
  assignmentCycleYear.textContent = String(new Date().getFullYear());

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

  // `trigger` es el botón que lo abre, al que vuelve el foco al cerrarlo; `row`, la fila de la
  // asignación que se edita
  function openAssignmentModal(trigger, row = null) {
    resetAssignmentForm();
    closeAllDropdowns();
    closeAllSearchableMenus();
    modalTrigger = trigger;
    const isEditing = Boolean(row);
    assignmentTitle.textContent = isEditing ? 'Editar asignación' : 'Nueva asignación';
    assignmentSubtitle.textContent = isEditing
      ? 'Modifica los datos de la asignación'
      : 'Completa los datos para crear una nueva asignación docente';
    cycleDescription.textContent = isEditing
      ? 'Pertenece al ciclo lectivo:'
      : 'Se creará para el ciclo lectivo:';
    createAssignmentBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear asignación';
    assignmentCycleYear.textContent = String(new Date().getFullYear());

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
      assignmentCycleYear.textContent = year;
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

  openAssignmentModalBtn.addEventListener('click', () => openAssignmentModal(openAssignmentModalBtn));
  cancelAssignmentBtn.addEventListener('click', closeAssignmentModal);
  // Por delegación: las filas se generan al cargar las asignaciones, al filtrar y al cambiar de página
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openAssignmentModal(button, button.closest('tr'));
  });

  // Escape cierra el modal si no hay un desplegable ni un buscador abiertos
  // (dropdown.component.js resuelve antes esa pulsación). Se escucha en el documento para que
  // funcione aunque el foco haya quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && assignmentOverlay.classList.contains('is-open')) closeAssignmentModal();
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
