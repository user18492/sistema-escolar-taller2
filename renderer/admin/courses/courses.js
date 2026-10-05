// Vista Cursos del Administrador: la tabla muestra los cursos de la institución, de todos los
// ciclos lectivos, que llegan del proceso principal (window.api.courses.list), y los filtros de
// columna los filtran en memoria. La lista filtrada se pagina en memoria, 10 por página, con
// <table-pagination>.
// Nuevo curso lo crea para el ciclo lectivo del año en curso (window.api.courses.create), con los
// grados del catálogo (window.api.grades.list). El resultado se avisa con un toast
// (toast.component.js), salvo el error de la división, que se marca en el formulario.
// Editar y Eliminar siguen siendo visuales: no modifican datos persistidos.

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

  // ---------- Tabla: cambios después de crear ----------

  // Mismo orden que el del listado (FIND_BY_INSTITUTION_SQL, course.repository.js): ciclo lectivo
  // (el más reciente primero), nivel educativo, grado, división y turno; el id desempata.
  const LEVEL_ORDER = ['PRIMARY', 'SECONDARY'];
  const SHIFT_ORDER = ['MORNING', 'AFTERNOON'];
  const compareCourses = (a, b) =>
    b.schoolYear - a.schoolYear ||
    LEVEL_ORDER.indexOf(a.educationLevel) - LEVEL_ORDER.indexOf(b.educationLevel) ||
    a.gradeName.localeCompare(b.gradeName) ||
    a.division.localeCompare(b.division) ||
    SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift) ||
    a.id - b.id;

  // Agrega el curso creado a la lista en memoria, en su lugar, sin recargarla ni tocar los filtros:
  // si coincide con los activos, la tabla pasa a la página donde quedó; si no, no se muestra. Si la
  // lista no se había podido cargar, se vuelve a pedir: mostrar solo el curso nuevo taparía el
  // error.
  const insertCourse = (newCourse) => {
    if (!isLoaded) {
      loadCourses();
      return;
    }
    const index = courses.findIndex((course) => compareCourses(newCourse, course) < 0);
    courses = courses.toSpliced(index === -1 ? courses.length : index, 0, newCourse);
    const visibleIndex = courses.filter(matchesFilters).indexOf(newCourse);
    renderRows(visibleIndex === -1 ? {} : { page: Math.floor(visibleIndex / pagination.pageSize) + 1 });
  };

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // ---------- Modal compartido: Nuevo curso / Editar curso ----------

  const courseOverlay = document.getElementById('newCourseOverlay');
  const courseModal = courseOverlay.querySelector('.modal');
  const courseModalBody = courseOverlay.querySelector('.modal-body');
  const openCourseModalBtn = document.getElementById('openNewCourseModalBtn');
  const cancelCourseBtn = document.getElementById('cancelNewCourseBtn');
  const createCourseBtn = document.getElementById('createCourseBtn');
  const courseTitle = document.getElementById('newCourseTitle');
  const courseSubtitle = courseOverlay.querySelector('.modal-header p');
  const cycleDescription = courseOverlay.querySelector('.info-box-text span');
  let modalTrigger = null;
  let isEditing = false;
  let isSaving = false;

  // Formato y error de la división: componente compartido field-validation.component.js.
  const divisionInput = document.getElementById('newCourseDivision');

  const gradeDropdown = courseOverlay.querySelector('[data-filter="new-course-grade"]');
  const gradeLabel = gradeDropdown.querySelector('.dropdown-label');
  const gradeGrid = gradeDropdown.querySelector('.grade-grid');
  const gradeMessage = document.getElementById('newCourseGradeMessage');
  const gradeCardTemplate = document.getElementById('gradeCardTemplate');

  const cycleYear = document.getElementById('newCourseYear');
  cycleYear.textContent = String(new Date().getFullYear());

  const shiftDropdown = courseOverlay.querySelector('[data-filter="new-course-shift"]');
  const levelDropdown = courseOverlay.querySelector('[data-filter="new-course-level"]');
  const courseSelectDropdowns = [shiftDropdown, levelDropdown];

  const selectedValue = (dropdown) => dropdown.querySelector('.dropdown-option.selected')?.dataset.value;
  // Nombre del grado elegido (1°, 2°, ... 6°): el data-value de su tarjeta
  const selectedGradeName = () => gradeGrid.querySelector('.grade-card.selected')?.dataset.value;

  // ---------- Modal: grados del catálogo ----------

  const GENERIC_GRADES_ERROR = 'No se pudieron cargar los grados. Intentá nuevamente.';

  // Catálogo de grados, en el orden en que llega del proceso principal: primaria antes que
  // secundaria y, dentro de cada nivel, de 1° a 6°. Un grado es un nombre en un nivel educativo, y
  // el formulario los elige por separado: el nombre en Grado y el nivel en Nivel educativo.
  let grades = [];
  let isLoadingGrades = false;

  // Grado del catálogo con ese nombre en ese nivel educativo, o undefined
  const findGrade = (name, level) => grades.find((grade) => grade.name === name && grade.educationLevel === level);

  // Grado: una tarjeta por nombre, en el orden del catálogo. Nivel educativo: de las opciones del
  // formulario quedan a la vista las que tienen algún grado. Los datos de la base se asignan con
  // textContent, nunca como HTML.
  const renderGradeOptions = () => {
    const names = [...new Set(grades.map((grade) => grade.name))];
    gradeGrid.replaceChildren(...names.map((name) => {
      const card = gradeCardTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.value = name;
      card.textContent = name;
      return card;
    }));
    levelDropdown.querySelectorAll('.dropdown-option').forEach((option) => {
      option.hidden = !grades.some((grade) => grade.educationLevel === option.dataset.value);
    });
    gradeMessage.textContent = 'No hay grados registrados.';
    gradeMessage.hidden = names.length > 0;
  };

  // Punto de entrada también para volver a pedir el catálogo al abrir el modal, si no había
  // cargado. Mientras no llega, el desplegable de Grado muestra el motivo en lugar de las tarjetas.
  async function loadGrades() {
    if (isLoadingGrades) return;
    isLoadingGrades = true;
    gradeMessage.textContent = 'Cargando grados…';
    gradeMessage.hidden = false;
    let response;
    try {
      response = await window.api?.grades?.list();
    } catch (error) {
      console.error('Error al cargar los grados:', error);
    }
    isLoadingGrades = false;
    if (!response?.ok) {
      gradeMessage.textContent = response?.error?.message || GENERIC_GRADES_ERROR;
      return;
    }
    grades = response.grades;
    renderGradeOptions();
  }

  loadGrades();

  // ---------- Modal: formulario ----------

  function updateCreateButtonState() {
    const hasGrade = Boolean(selectedGradeName());
    const hasDivision = divisionInput.value.trim().length > 0;
    const hasShift = Boolean(selectedValue(shiftDropdown));
    const hasLevel = Boolean(selectedValue(levelDropdown));
    createCourseBtn.disabled = !(hasGrade && hasDivision && hasShift && hasLevel);
  }

  // Marca la tarjeta elegida y la muestra en la etiqueta del desplegable. Con null queda sin
  // selección y con el texto inicial de la etiqueta.
  const selectGradeCard = (selectedCard) => {
    gradeGrid.querySelectorAll('.grade-card').forEach((card) => {
      const selected = card === selectedCard;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-selected', String(selected));
    });
    gradeLabel.textContent = selectedCard ? selectedCard.textContent : gradeLabel.dataset.placeholder;
    gradeLabel.classList.toggle('placeholder', !selectedCard);
  };

  // Por delegación: las tarjetas se generan al llegar el catálogo
  gradeGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.grade-card');
    if (!card) return;
    selectGradeCard(card);
    closeDropdown(gradeDropdown);
    updateCreateButtonState();
  });

  divisionInput.addEventListener('input', updateCreateButtonState);

  courseSelectDropdowns.forEach((dropdown) => {
    dropdown.querySelectorAll('.dropdown-option').forEach((option) => {
      option.addEventListener('click', updateCreateButtonState);
    });
  });

  // Mientras se espera la respuesta del alta, el cuerpo del modal queda inerte, así lo enviado
  // coincide con lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled:
  // conservan el foco, como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    courseModalBody.inert = saving;
    courseModal.setAttribute('aria-busy', String(saving));
    [cancelCourseBtn, createCourseBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    createCourseBtn.textContent = saving ? 'Creando…' : 'Crear curso';
  };

  function resetCourseForm() {
    divisionInput.value = '';
    clearFieldErrors(courseOverlay);

    selectGradeCard(null);

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
    isEditing = Boolean(row);
    // El catálogo no llegó al cargar la vista: se vuelve a pedir
    if (!grades.length) loadGrades();
    courseTitle.textContent = isEditing ? 'Editar curso' : 'Nuevo curso';
    courseSubtitle.textContent = isEditing
      ? 'Modifica los datos del curso'
      : 'Completa los datos para crear un nuevo curso';
    cycleDescription.textContent = isEditing
      ? 'Pertenece al ciclo lectivo:'
      : 'Se creará para el ciclo lectivo:';
    createCourseBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear curso';
    cycleYear.textContent = String(new Date().getFullYear());

    if (row) {
      const [grade, division, shift, level, year] = Array.from(row.cells, (cell) => cell.textContent.trim());
      divisionInput.value = division;
      Array.from(gradeGrid.querySelectorAll('.grade-card')).find((card) => card.textContent.trim() === grade)?.click();
      courseSelectDropdowns.forEach((dropdown, index) => {
        const value = index === 0 ? shift : level;
        Array.from(dropdown.querySelectorAll('.dropdown-option'))
          .find((option) => option.textContent.trim() === value)?.click();
      });
      cycleYear.textContent = year;
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

  const CREATE_ERROR_TITLE = 'No se pudo crear el curso';

  // "3° A de Secundaria, turno Mañana", como lo nombra el toast del alta
  const courseName = (course) =>
    `${course.gradeName} ${course.division} de ${levelLabels[course.educationLevel]}, turno ${shiftLabels[course.shift]}`;

  // Crea el curso; al terminar cierra el modal y lo avisa con un toast. El error de la división se
  // marca en el formulario y los demás salen en un toast: en ambos casos el modal sigue abierto con
  // lo que se eligió.
  const createCourse = async () => {
    const gradeName = selectedGradeName();
    const level = selectedValue(levelDropdown);
    const grade = findGrade(gradeName, level);
    // El catálogo no tiene ese grado en el nivel elegido: no hay un grado_id que enviar
    if (!grade) {
      showToast({ type: 'error', title: CREATE_ERROR_TITLE, description: `No existe ${gradeName} de ${levelLabels[level]}.` });
      return;
    }
    setSaving(true);
    let response;
    try {
      // El ciclo lectivo no se envía: el proceso principal usa el año en curso, el que anuncia el modal
      response = await window.api?.courses?.create({
        gradeId: grade.id,
        division: divisionInput.value,
        shift: selectedValue(shiftDropdown),
      });
    } catch (error) {
      console.error('Error al crear el curso:', error);
    }
    setSaving(false);

    if (response?.ok) {
      insertCourse(response.course);
      closeCourseModal();
      showToast({
        type: 'success',
        title: 'Curso creado',
        description: `Se registró ${courseName(response.course)}, para el ciclo lectivo ${response.course.schoolYear}.`,
      });
      return;
    }
    const error = response?.error;
    if (error?.fieldErrors?.division) {
      setFieldError(divisionInput, error.fieldErrors.division);
      divisionInput.focus();
      return;
    }
    showToast({ type: 'error', title: CREATE_ERROR_TITLE, description: errorDescription(error) });
  };

  openCourseModalBtn.addEventListener('click', () => openCourseModal(openCourseModalBtn));
  cancelCourseBtn.addEventListener('click', () => {
    if (!isSaving) closeCourseModal();
  });
  // Por delegación: las filas se generan al cargar los cursos, al filtrar y al cambiar de página
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (button) openCourseModal(button, button.closest('tr'));
  });

  // Escape cierra el modal si no hay un desplegable abierto (dropdown.component.js resuelve
  // antes esa pulsación). Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control. Mientras se crea el curso, ni Escape ni Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && courseOverlay.classList.contains('is-open') && !isSaving) closeCourseModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createCourseBtn.addEventListener('click', () => {
    if (isSaving) return;
    // Con la división inválida, el modal sigue abierto con el foco en ella.
    if (validateFields(courseOverlay)) return;
    // Editar sigue siendo visual: guardar no modifica datos persistidos.
    if (isEditing) {
      closeCourseModal();
      return;
    }
    // El proceso principal vuelve a validar todo antes de guardar el curso.
    createCourse();
  });

  // ---------- Modal: Eliminar curso ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteCourseOverlay'), { beforeOpen: closeAllDropdowns });
});
