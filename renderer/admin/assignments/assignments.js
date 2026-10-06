// Vista Docencia del Administrador: la tabla muestra las asignaciones docentes vigentes de la
// institución, de todos los ciclos lectivos, que llegan del proceso principal
// (window.api.teacherAssignments.list), y los filtros de columna las filtran en memoria. Las opciones
// de los filtros Profesor y Materia son los profesores y las materias de esas asignaciones. La lista
// filtrada se pagina en memoria, 10 por página, con <table-pagination>.
// La foto de perfil de cada profesor se muestra con fillAvatar (user-avatar.component.js).
// Nueva asignación la crea (window.api.teacherAssignments.create) para un curso del ciclo lectivo
// del año en curso: el formulario ofrece los profesores activos y los cursos vigentes de ese ciclo
// (listAssignableTeachers, listAssignableCourses) y, al elegir el curso, las materias que todavía
// no tienen un profesor en él (listAssignableSubjects). El resultado se avisa con un toast
// (toast.component.js), salvo el rechazo de la materia, que se marca en el formulario.
// Eliminar la da de baja (baja lógica, window.api.teacherAssignments.delete) después de confirmarlo
// en un modal (confirm-modal.component.js) y también lo avisa con un toast: su materia vuelve a
// ofrecerse en ese curso.
// Editar sigue siendo visual: no modifica datos persistidos.

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js.
  // También guarda en data-placeholder el texto inicial de las etiquetas con .placeholder, que
  // usa el reinicio del formulario. Abrir un dropdown, hacer clic fuera de los buscadores o
  // pulsar Escape cierra también los buscadores (searchable-select.component.js).
  const { closeDropdown, closeAllDropdowns } = setupDropdowns({
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
  const compareTeachers = (a, b) =>
    nameCollator.compare(a.lastName, b.lastName) || nameCollator.compare(a.firstName, b.firstName) || a.id - b.id;
  const compareSubjects = (a, b) => nameCollator.compare(a.name, b.name) || a.id - b.id;

  // Los profesores (por apellido y nombre) y las materias (por nombre) que tienen alguna asignación
  // en la lista cargada: las opciones de sus filtros
  const listedTeachers = () => uniqueById(assignments.map(({ teacher }) => teacher)).sort(compareTeachers);
  const listedSubjects = () => uniqueById(assignments.map(({ subject }) => subject)).sort(compareSubjects);

  // Opciones de Profesor y de Materia. Las de Profesor van antes de .dropdown-empty y las de
  // Materia, después de "Todas"; column-filter.js las lee al usarlas.
  // Llegan sin marcar, así que esos dos filtros dejan de aplicarse y sus embudos se actualizan.
  const fillFilterOptions = () => {
    const teacherList = teacherHeader.querySelector('[role="listbox"]');
    teacherList.replaceChildren(...listedTeachers().map(createTeacherOption), teacherList.querySelector('.dropdown-empty'));

    const subjectList = subjectHeader.querySelector('[role="listbox"]');
    subjectList.replaceChildren(subjectList.querySelector('.dropdown-option[data-value=""]'), ...listedSubjects().map(createSubjectOption));

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

  // ---------- Tabla: cambios después de crear o eliminar ----------

  // Orden aproximado al del listado (FIND_BY_INSTITUTION_SQL, teacher-assignment.repository.js):
  // ciclo lectivo (el más reciente primero), profesor, curso (nivel educativo, grado, división y
  // turno) y materia; el id desempata. El orden exacto de los nombres depende de la intercalación
  // de la base y se aplica en la próxima carga.
  const LEVEL_ORDER = ['PRIMARY', 'SECONDARY'];
  const SHIFT_ORDER = ['MORNING', 'AFTERNOON'];
  const compareCourses = (a, b) =>
    LEVEL_ORDER.indexOf(a.educationLevel) - LEVEL_ORDER.indexOf(b.educationLevel) ||
    a.gradeName.localeCompare(b.gradeName) ||
    a.division.localeCompare(b.division) ||
    SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift) ||
    a.id - b.id;
  const compareAssignments = (a, b) =>
    b.course.schoolYear - a.course.schoolYear ||
    compareTeachers(a.teacher, b.teacher) ||
    compareCourses(a.course, b.course) ||
    compareSubjects(a.subject, b.subject) ||
    a.id - b.id;

  // Agrega al filtro de `header` la opción de `item` (un profesor o una materia) si no la tenía,
  // antes de la del que lo sigue en `items` (los de las asignaciones cargadas, ya ordenados) y sin
  // tocar las marcadas
  const addFilterOption = (header, items, item, createOption) => {
    const list = header.querySelector('[role="listbox"]');
    const optionOf = ({ id }) => list.querySelector(`.dropdown-option[data-value="${id}"]`);
    if (optionOf(item)) return;
    const nextItem = items[items.findIndex(({ id }) => id === item.id) + 1];
    list.insertBefore(createOption(item), (nextItem && optionOf(nextItem)) ?? list.querySelector('.dropdown-empty'));
  };

  // Agrega la asignación creada a la lista en memoria, en su lugar, sin recargarla ni tocar los
  // filtros; su profesor y su materia pasan a ser opciones de los filtros si todavía no lo eran. Si
  // coincide con los filtros activos, la tabla pasa a la página donde quedó; si no, no se muestra.
  // Si la lista no se había podido cargar, se vuelve a pedir: mostrar solo la asignación nueva
  // taparía el error.
  const insertAssignment = (newAssignment) => {
    if (!isLoaded) {
      loadAssignments();
      return;
    }
    const index = assignments.findIndex((assignment) => compareAssignments(newAssignment, assignment) < 0);
    assignments = assignments.toSpliced(index === -1 ? assignments.length : index, 0, newAssignment);
    addFilterOption(teacherHeader, listedTeachers(), newAssignment.teacher, createTeacherOption);
    addFilterOption(subjectHeader, listedSubjects(), newAssignment.subject, createSubjectOption);
    const visibleIndex = assignments.filter(matchesFilters).indexOf(newAssignment);
    renderRows(visibleIndex === -1 ? {} : { page: Math.floor(visibleIndex / pagination.pageSize) + 1 });
  };

  // Quita del filtro de `header` la opción de `item` (un profesor o una materia) si ya no está en
  // `items` (los de las asignaciones cargadas). Si estaba marcada, `filter` deja de filtrar por
  // ella y el embudo se actualiza.
  const removeFilterOption = (header, filter, items, item) => {
    if (items.some(({ id }) => id === item.id)) return;
    const option = header.querySelector(`.dropdown-option[data-value="${item.id}"]`);
    if (!option) return;
    const wasSelected = option.classList.contains('selected');
    option.remove();
    if (!wasSelected) return;
    activeFilters[filter] = activeFilters[filter].filter((value) => value !== String(item.id));
    header.dispatchEvent(new Event('column-filter-refresh'));
  };

  // Quita de la lista en memoria la asignación dada de baja, sin recargarla; su profesor y su
  // materia dejan de ser opciones de los filtros si no les queda otra asignación, sin tocar las
  // demás. La página se conserva; si era la última y quedó vacía, el componente pasa a la anterior.
  const removeAssignment = ({ id, teacher, subject }) => {
    assignments = assignments.filter((assignment) => assignment.id !== id);
    removeFilterOption(teacherHeader, 'teacher', listedTeachers(), teacher);
    removeFilterOption(subjectHeader, 'subject', listedSubjects(), subject);
    renderRows();
  };

  // Posición en la página de la fila del botón que abrió el último modal, solo para devolver el
  // foco a la que ocupe su lugar si esa fila ya no se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit o delete) de la fila que quedó en su lugar (o de la última de la
  // página), o "Nueva asignación" si la tabla quedó sin asignaciones
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openAssignmentModalBtn;
  };

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // La asignación ya no está vigente: la lista en memoria quedó vieja y se vuelve a pedir
  const NO_LONGER_ACTIVE_CODES = ['TEACHER_ASSIGNMENT_NOT_FOUND', 'TEACHER_ASSIGNMENT_ALREADY_DELETED'];

  // "Lengua en 1° A de Primaria, turno Mañana", como lo nombran los toasts del alta y de la baja
  const subjectInCourse = ({ course, subject }) =>
    `${subject.name} en ${course.gradeName} ${course.division} de ${levelLabels[course.educationLevel]}, turno ${shiftLabels[course.shift]}`;

  // ---------- Modal compartido: Nueva asignación / Editar asignación ----------

  const assignmentOverlay = document.getElementById('newAssignmentOverlay');
  const assignmentModal = assignmentOverlay.querySelector('.modal');
  const assignmentModalBody = assignmentOverlay.querySelector('.modal-body');
  const openAssignmentModalBtn = document.getElementById('openNewAssignmentModalBtn');
  const cancelAssignmentBtn = document.getElementById('cancelNewAssignmentBtn');
  const createAssignmentBtn = document.getElementById('createAssignmentBtn');
  const assignmentTitle = document.getElementById('newAssignmentTitle');
  const assignmentSubtitle = assignmentOverlay.querySelector('.modal-header p');
  const cycleDescription = assignmentOverlay.querySelector('.info-box-text span');
  const courseOptionTemplate = document.getElementById('courseOptionTemplate');
  let modalTrigger = null;
  // Asignación que se edita, la de la lista en memoria al abrir el modal desde su fila; null en un
  // alta
  let editingAssignment = null;
  let isSaving = false;

  const assignmentCycleYear = document.getElementById('newAssignmentYear');
  assignmentCycleYear.textContent = String(new Date().getFullYear());

  const teacherRoot = assignmentOverlay.querySelector('[data-role="teacher-select"]');
  const courseRoot = assignmentOverlay.querySelector('[data-role="course-select"]');
  const levelDropdown = assignmentOverlay.querySelector('[data-filter="new-assignment-level"]');
  const levelOptions = levelDropdown.querySelectorAll('.dropdown-option');
  const subjectDropdown = assignmentOverlay.querySelector('[data-filter="new-assignment-subject"]');
  // El error de la materia va en #newAssignmentSubjectError, con setFieldError
  // (field-validation.component.js)
  const subjectToggle = document.getElementById('newAssignmentSubject');
  const subjectLabel = subjectDropdown.querySelector('.dropdown-label');
  const subjectMenu = subjectDropdown.querySelector('.dropdown-menu');

  const SUBMIT_TEXT = 'Crear asignación';
  // dropdown.component.js guardó el texto inicial de la etiqueta
  const LEVEL_PLACEHOLDER = levelDropdown.querySelector('.dropdown-label').dataset.placeholder;
  const COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';
  const SUBJECT_LOCKED_PLACEHOLDER = 'Selecciona primero un curso';
  const SUBJECT_UNLOCKED_PLACEHOLDER = 'Seleccionar materia';
  const NO_SUBJECTS_LEFT = 'El curso ya tiene todas sus materias asignadas';

  // Códigos con los que el proceso principal avisa que un profesor o un curso que ofrece el
  // formulario ya no se puede elegir (otra sesión lo suspendió o lo dio de baja): las listas se
  // vuelven a pedir
  const STALE_OPTION_CODES = ['TEACHER_NOT_AVAILABLE', 'COURSE_NOT_AVAILABLE'];

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

  const selectedSubjectOption = () => subjectMenu.querySelector('.dropdown-option.selected');

  function updateCreateButtonState() {
    const hasTeacher = Boolean(teacherSelect.getValue());
    const hasLevel = Boolean(levelDropdown.querySelector('.dropdown-option.selected'));
    const hasCourse = Boolean(courseSelect.getValue());
    const hasSubject = Boolean(selectedSubjectOption());
    createAssignmentBtn.disabled = !(hasTeacher && hasLevel && hasCourse && hasSubject);
  }

  // Deja un desplegable del formulario (Nivel educativo o Materia) sin selección y con `text` en
  // su etiqueta: bloqueado mientras no se pueda elegir, o listo para elegir
  const resetDropdown = (dropdown, text, isLocked) => {
    dropdown.querySelectorAll('.dropdown-option').forEach((option) => {
      option.classList.remove('selected');
      option.setAttribute('aria-selected', 'false');
    });
    dropdown.classList.toggle('is-locked', isLocked);
    dropdown.querySelector('.dropdown-toggle').disabled = isLocked;
    const label = dropdown.querySelector('.dropdown-label');
    label.textContent = text;
    label.classList.add('placeholder');
  };
  const lockDropdown = (dropdown, text) => resetDropdown(dropdown, text, true);
  const unlockDropdown = (dropdown, placeholder) => resetDropdown(dropdown, placeholder, false);

  // ---------- Modal: materias del curso elegido ----------

  // Cambia cada vez que Materia se vacía: descarta la respuesta que se esté esperando con las
  // materias de otro curso
  let subjectsRequestId = 0;

  // Materia sin opciones ni error, bloqueada con `text`: a la espera de un curso o de sus materias,
  // o porque no hay ninguna para elegir
  function lockSubject(text = SUBJECT_LOCKED_PLACEHOLDER) {
    subjectsRequestId += 1;
    subjectMenu.replaceChildren();
    setFieldError(subjectToggle, '');
    lockDropdown(subjectDropdown, text);
    updateCreateButtonState();
  }

  // Marca la opción elegida y la muestra en la etiqueta, como dropdown.component.js con las
  // opciones que existen al cargar la vista: estas se generan al elegir el curso. Elegir una
  // materia quita el error de la anterior.
  const selectSubject = (selectedOption) => {
    subjectMenu.querySelectorAll('.dropdown-option').forEach((option) => {
      const isSelected = option === selectedOption;
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
    subjectLabel.textContent = selectedOption.textContent;
    subjectLabel.classList.remove('placeholder');
    setFieldError(subjectToggle, '');
    updateCreateButtonState();
  };

  subjectMenu.addEventListener('click', (event) => {
    const option = event.target.closest('.dropdown-option');
    if (!option) return;
    selectSubject(option);
    closeDropdown(subjectDropdown);
  });

  // Pide las materias que se pueden asignar en el curso elegido: las de su grado que todavía no
  // tienen un profesor en él. Mientras llegan, si no queda ninguna o si la consulta falla, Materia
  // sigue bloqueada con el motivo. Al editar se ofrece además la materia de la asignación, que no
  // llega porque ya tiene un profesor: el de esa misma asignación.
  async function loadSubjects(courseId) {
    lockSubject('Cargando materias…');
    const requestId = subjectsRequestId;
    let response;
    try {
      response = await window.api?.teacherAssignments?.listAssignableSubjects(courseId);
    } catch (error) {
      console.error('Error al cargar las materias:', error);
    }
    // Mientras se esperaba se eligió otro curso u otro nivel, o se reinició el formulario
    if (requestId !== subjectsRequestId) return;
    if (!response?.ok) {
      lockSubject('No se pudieron cargar las materias');
      // El curso ya no se puede elegir: las listas del formulario quedaron viejas
      if (STALE_OPTION_CODES.includes(response?.error?.code)) {
        showToast({ type: 'error', title: 'No se pudieron cargar las materias', description: response.error.message });
        loadFormOptions();
      }
      return;
    }
    const ownSubject = editingAssignment?.course.id === courseId ? editingAssignment.subject : null;
    const subjects = ownSubject ? [...response.subjects, ownSubject].sort(compareSubjects) : response.subjects;
    if (!subjects.length) {
      lockSubject(NO_SUBJECTS_LEFT);
      return;
    }
    subjectMenu.replaceChildren(...subjects.map(createSubjectOption));
    unlockDropdown(subjectDropdown, SUBJECT_UNLOCKED_PLACEHOLDER);
    if (ownSubject) selectSubject(subjectMenu.querySelector(`.dropdown-option[data-value="${ownSubject.id}"]`));
  }

  // El proceso principal rechazó la materia elegida (otra sesión la asignó en ese curso con el
  // formulario abierto): el error queda en el campo, que la sigue mostrando, y la materia deja de
  // ofrecerse, así que para volver a guardar hay que elegir otra. Si era la última sin asignar,
  // Materia queda bloqueada.
  const rejectSubject = (message) => {
    selectedSubjectOption()?.remove();
    if (!subjectMenu.children.length) lockDropdown(subjectDropdown, NO_SUBJECTS_LEFT);
    setFieldError(subjectToggle, message);
    updateCreateButtonState();
    (subjectToggle.disabled ? cancelAssignmentBtn : subjectToggle).focus();
  };

  // ---------- Modal: profesores y cursos que se pueden elegir ----------

  // Texto con el que Profesor y Nivel educativo quedan bloqueados mientras su lista no se puede
  // usar (no llegó o llegó vacía); null cuando se puede elegir
  let teacherLockText = null;
  let levelLockText = null;
  let isLoadingFormOptions = false;
  // Llegaron las dos listas: si no, se vuelven a pedir al abrir el modal
  let hasFormOptions = false;

  // El curso se busca dentro de un nivel educativo (data-level), que elige el campo anterior
  const createCourseOption = (course) => {
    const option = courseOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(course.id);
    option.dataset.level = course.educationLevel;
    option.querySelector('.option-name').textContent = courseName(course);
    return option;
  };

  // Lista `key` de la respuesta de `request`, o null si no llegó
  const requestOptions = async (request, key) => {
    let response;
    try {
      response = await request();
    } catch (error) {
      console.error('Error al cargar las opciones del formulario:', error);
    }
    return response?.ok ? response[key] : null;
  };

  // Texto que bloquea un campo según su lista: no llegó, llegó vacía o, si se puede usar, null
  const lockTextOf = (items, errorText, emptyText) => {
    if (!items) return errorText;
    return items.length ? null : emptyText;
  };

  function resetAssignmentForm() {
    teacherSelect.reset();
    if (teacherLockText) teacherSelect.lock(teacherLockText);
    else teacherSelect.unlock();

    if (levelLockText) lockDropdown(levelDropdown, levelLockText);
    else unlockDropdown(levelDropdown, LEVEL_PLACEHOLDER);

    courseSelect.reset();
    courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);

    lockSubject();
  }

  // El primer campo del formulario o, si está bloqueado, Cancelar
  const focusForm = () => {
    const chevron = teacherRoot.querySelector('.searchable-chevron');
    (chevron.disabled ? cancelAssignmentBtn : chevron).focus();
  };

  // Editar sigue siendo visual: el formulario llega con el profesor, el nivel educativo y el curso
  // de la asignación si el alta los ofrece (no ofrece a un profesor suspendido ni un curso de otro
  // ciclo lectivo); con el curso llegan sus materias, y entre ellas la de la asignación
  // (loadSubjects).
  const fillEditForm = () => {
    const { teacher, course } = editingAssignment;
    const clickOption = (root, value) => {
      const option = Array.from(root.querySelectorAll('.dropdown-option'))
        .find((candidate) => candidate.dataset.value === String(value) && !candidate.hidden);
      option?.click();
      return Boolean(option);
    };
    if (!teacherLockText) clickOption(teacherRoot, teacher.id);
    if (!levelLockText && clickOption(levelDropdown, course.educationLevel)) clickOption(courseRoot, course.id);
  };

  // Pide los profesores activos de la institución y sus cursos vigentes del ciclo lectivo en curso:
  // las opciones de Profesor y de Curso. Punto de entrada también para volver a pedirlos al abrir
  // el modal, si no habían llegado, y cuando el proceso principal avisa que quedaron viejos. El
  // formulario vuelve a quedar vacío: lo elegido puede no estar en las listas nuevas.
  async function loadFormOptions() {
    if (isLoadingFormOptions) return;
    isLoadingFormOptions = true;
    hasFormOptions = false;
    teacherLockText = 'Cargando profesores…';
    levelLockText = 'Cargando cursos…';
    resetAssignmentForm();
    const [teachers, courses] = await Promise.all([
      requestOptions(() => window.api?.teacherAssignments?.listAssignableTeachers(), 'teachers'),
      requestOptions(() => window.api?.teacherAssignments?.listAssignableCourses(), 'courses'),
    ]);
    isLoadingFormOptions = false;
    hasFormOptions = Boolean(teachers && courses);
    teacherSelect.setOptions((teachers ?? []).map(createTeacherOption));
    courseSelect.setOptions((courses ?? []).map(createCourseOption));
    // De los niveles educativos quedan a la vista los que tienen algún curso
    levelOptions.forEach((option) => {
      option.hidden = !courses?.some((course) => course.educationLevel === option.dataset.value);
    });
    teacherLockText = lockTextOf(teachers, 'No se pudieron cargar los profesores', 'No hay profesores activos');
    levelLockText = lockTextOf(courses, 'No se pudieron cargar los cursos', `No hay cursos del ciclo lectivo ${new Date().getFullYear()}`);
    resetAssignmentForm();
    // El modal se abrió para editar antes de que llegaran las listas
    if (editingAssignment && assignmentOverlay.classList.contains('is-open')) fillEditForm();
  }

  // ---------- Modal: formulario ----------

  teacherSelect.onSelect(updateCreateButtonState);

  courseSelect.onSelect((option) => loadSubjects(Number(option.dataset.value)));

  levelOptions.forEach((option) => {
    option.addEventListener('click', () => {
      courseSelect.reset();
      courseSelect.setGroupFilter(option.dataset.value);
      courseSelect.unlock(COURSE_UNLOCKED_PLACEHOLDER);
      lockSubject();
    });
  });

  // Mientras se espera la respuesta, el cuerpo del modal queda inerte, así lo enviado coincide con
  // lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled: conservan el foco,
  // como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    assignmentModalBody.inert = saving;
    assignmentModal.setAttribute('aria-busy', String(saving));
    [cancelAssignmentBtn, createAssignmentBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    createAssignmentBtn.textContent = saving ? 'Creando…' : SUBMIT_TEXT;
  };

  // `trigger` es el botón que lo abre, al que vuelve el foco al cerrarlo; `row`, la fila de la
  // asignación que se edita. La fila la identifica solo por su data-assignment-id (el
  // asignacion_docente_id): los datos del formulario salen de la asignación cargada de la base, no
  // del texto de las celdas.
  function openAssignmentModal(trigger, row = null) {
    const assignment = row ? assignments.find((candidate) => String(candidate.id) === row.dataset.assignmentId) : null;
    if (row && !assignment) return;
    editingAssignment = assignment;
    resetAssignmentForm();
    closeAllDropdowns();
    closeAllSearchableMenus();
    modalTrigger = trigger;
    const isEditing = Boolean(assignment);
    assignmentTitle.textContent = isEditing ? 'Editar asignación' : 'Nueva asignación';
    assignmentSubtitle.textContent = isEditing
      ? 'Modifica los datos de la asignación'
      : 'Completa los datos para crear una nueva asignación docente';
    cycleDescription.textContent = isEditing
      ? 'Pertenece al ciclo lectivo:'
      : 'Se creará para el ciclo lectivo:';
    createAssignmentBtn.textContent = isEditing ? 'Guardar cambios' : SUBMIT_TEXT;
    // Una asignación es del ciclo lectivo de su curso; una nueva, del año en curso
    assignmentCycleYear.textContent = String(assignment?.course.schoolYear ?? new Date().getFullYear());

    // Las listas no llegaron al cargar la vista: se vuelven a pedir
    if (!hasFormOptions) loadFormOptions();
    else if (isEditing) fillEditForm();
    assignmentOverlay.classList.add('is-open');
    focusForm();
  }

  function closeAssignmentModal() {
    assignmentOverlay.classList.remove('is-open');
    closeAllDropdowns();
    closeAllSearchableMenus();
    modalTrigger?.focus();
  }

  // "Pablo Fernández dictará Lengua en 1° A de Primaria, turno Mañana."
  const successDescription = (assignment) =>
    `${assignment.teacher.firstName} ${assignment.teacher.lastName} dictará ${subjectInCourse(assignment)}.`;

  // Crea la asignación; al terminar cierra el modal y lo avisa con un toast. Si el proceso
  // principal rechaza la materia (ya tiene un profesor en ese curso), el error se marca en el campo
  // y los demás salen en un toast: en ambos casos el modal sigue abierto. Si el profesor o el curso
  // ya no se pueden elegir, las listas se vuelven a pedir antes de liberar el modal.
  const saveAssignment = async () => {
    const data = {
      teacherId: Number(teacherSelect.getValue()),
      courseId: Number(courseSelect.getValue()),
      subjectId: Number(selectedSubjectOption().dataset.value),
    };
    setSaving(true);
    let response;
    try {
      response = await window.api?.teacherAssignments?.create(data);
    } catch (error) {
      console.error('Error al crear la asignación docente:', error);
    }
    const error = response?.error;
    const isStale = STALE_OPTION_CODES.includes(error?.code);
    if (isStale) await loadFormOptions();
    setSaving(false);

    if (response?.ok) {
      insertAssignment(response.teacherAssignment);
      closeAssignmentModal();
      showToast({
        type: 'success',
        title: 'Asignación creada',
        description: successDescription(response.teacherAssignment),
      });
      return;
    }
    if (error?.fieldErrors?.subject) {
      rejectSubject(error.fieldErrors.subject);
      return;
    }
    // El formulario quedó vacío y "Crear asignación", deshabilitado
    if (isStale) focusForm();
    showToast({ type: 'error', title: 'No se pudo crear la asignación', description: errorDescription(error) });
  };

  openAssignmentModalBtn.addEventListener('click', () => openAssignmentModal(openAssignmentModalBtn));
  cancelAssignmentBtn.addEventListener('click', () => {
    if (!isSaving) closeAssignmentModal();
  });
  // Por delegación: las filas se generan al cargar las asignaciones, al filtrar y al cambiar de página
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openAssignmentModal(button, button.closest('tr'));
  });

  // Escape cierra el modal si no hay un desplegable ni un buscador abiertos
  // (dropdown.component.js resuelve antes esa pulsación). Se escucha en el documento para que
  // funcione aunque el foco haya quedado fuera de un control. Mientras se guarda, ni Escape ni
  // Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && assignmentOverlay.classList.contains('is-open') && !isSaving) closeAssignmentModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createAssignmentBtn.addEventListener('click', () => {
    if (isSaving) return;
    // Editar sigue siendo visual: guardar no modifica datos persistidos.
    if (editingAssignment) {
      closeAssignmentModal();
      return;
    }
    // El proceso principal vuelve a validar todo antes de guardar la asignación.
    saveAssignment();
  });

  loadFormOptions();

  // ---------- Modal: Eliminar asignación ----------

  // El id sale del data-assignment-id de la fila del botón (el asignacion_docente_id, fijado al
  // crearla), no de su posición en la tabla. Avisa el resultado con un toast y no resuelve ningún
  // mensaje, así el modal se cierra siempre.
  const deleteAssignment = async (trigger) => {
    const row = trigger.closest('tr');
    const assignmentId = Number(row?.dataset.assignmentId);
    let response;
    try {
      response = await window.api?.teacherAssignments?.delete(assignmentId);
    } catch (error) {
      console.error('Error al eliminar la asignación docente:', error);
    }
    const isGone = NO_LONGER_ACTIVE_CODES.includes(response?.error?.code);
    // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
    if (response?.ok || isGone) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      const { teacher, course } = response.teacherAssignment;
      removeAssignment(response.teacherAssignment);
      showToast({
        type: 'success',
        title: 'Asignación eliminada',
        description: `${teacher.firstName} ${teacher.lastName} ya no dicta ${subjectInCourse(response.teacherAssignment)}, en el ciclo lectivo ${course.schoolYear}.`,
      });
      return;
    }
    if (isGone) await loadAssignments();
    showToast({ type: 'error', title: 'No se pudo eliminar la asignación', description: errorDescription(response?.error) });
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y después se
  // cierra. Si la fila ya no está, el foco pasa a Eliminar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('deleteAssignmentOverlay'), {
    beforeOpen: () => {
      closeAllDropdowns();
      closeAllSearchableMenus();
    },
    onConfirm: deleteAssignment,
    fallbackFocus: () => focusAfterRemoval('delete'),
  });
});
