// Vista Cursos del Administrador: la tabla muestra los cursos vigentes de la institución, de todos
// los ciclos lectivos, que llegan del proceso principal (window.api.courses.list), y los filtros de
// columna los filtran en memoria. La lista filtrada se pagina en memoria, 10 por página, con
// <table-pagination>.
// Nuevo curso lo crea para el ciclo lectivo del año en curso (window.api.courses.create), con los
// grados del catálogo (window.api.grades.list); Editar guarda el grado, la división y el turno de un
// curso, que conserva su ciclo lectivo (window.api.courses.update), y Eliminar lo da de baja (baja
// lógica, window.api.courses.delete) después de confirmarlo en un modal (confirm-modal.component.js).
// El resultado de las tres operaciones se avisa con un toast (toast.component.js), salvo el error de
// la división, que se marca en el formulario.

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

  // ---------- Tabla: cambios después de crear, editar o eliminar ----------

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

  // Reemplaza en la lista en memoria el curso editado, que pasa al lugar que le toca con sus datos
  // nuevos, como uno recién creado: si coincide con los filtros activos, la tabla pasa a la página
  // donde quedó; si no, su fila deja de mostrarse.
  const replaceCourse = (updatedCourse) => {
    courses = courses.filter((course) => course.id !== updatedCourse.id);
    insertCourse(updatedCourse);
  };

  // Quita de la lista en memoria el curso dado de baja, sin recargarla ni tocar los filtros. La
  // página se conserva; si era la última y quedó vacía, el componente pasa a la anterior.
  const removeCourse = (courseId) => {
    courses = courses.filter((course) => course.id !== courseId);
    renderRows();
  };

  // Posición en la página de la fila del botón que abrió el último modal, solo para devolver el
  // foco a la que ocupe su lugar si esa fila ya no se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit o delete) de la fila que quedó en su lugar (o de la última de la
  // página), o "Nuevo curso" si la tabla quedó sin cursos
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openCourseModalBtn;
  };

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // El curso ya no está vigente: la lista en memoria quedó vieja y se vuelve a pedir
  const NO_LONGER_ACTIVE_CODES = ['COURSE_NOT_FOUND', 'COURSE_ALREADY_DELETED'];

  // "3° A de Secundaria, turno Mañana", como lo nombran los toasts del alta, la edición y la baja
  const courseName = (course) =>
    `${course.gradeName} ${course.division} de ${levelLabels[course.educationLevel]}, turno ${shiftLabels[course.shift]}`;

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
  // Curso que se edita, el de la lista en memoria al abrir el modal desde su fila: su id es el único
  // que se envía al guardar
  let editingCourse = null;
  let isSaving = false;

  // Texto del botón principal, en reposo y mientras se espera la respuesta, y de los toasts de
  // éxito y de error, según el modo del modal
  const MODAL_TEXTS = {
    create: {
      submit: 'Crear curso',
      saving: 'Creando…',
      successTitle: 'Curso creado',
      successDescription: (course) => `Se registró ${courseName(course)}, para el ciclo lectivo ${course.schoolYear}.`,
      errorTitle: 'No se pudo crear el curso',
    },
    edit: {
      submit: 'Guardar cambios',
      saving: 'Guardando…',
      successTitle: 'Curso actualizado',
      successDescription: (course) => `Se guardaron los cambios de ${courseName(course)}, del ciclo lectivo ${course.schoolYear}.`,
      errorTitle: 'No se pudieron guardar los cambios',
    },
  };
  const modalTexts = () => MODAL_TEXTS[isEditing ? 'edit' : 'create'];

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
    // El modal se abrió para editar antes de que llegara el catálogo: recién ahora hay una tarjeta
    // que marcar con el grado del curso
    if (isEditing && courseOverlay.classList.contains('is-open')) {
      selectGrade(editingCourse.gradeName);
      updateCreateButtonState();
    }
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

  // Marca la tarjeta del grado con ese nombre; si el catálogo no la tiene, queda sin selección
  const selectGrade = (name) =>
    selectGradeCard(Array.from(gradeGrid.children).find((card) => card.dataset.value === name) ?? null);

  // Elige en `dropdown` la opción con ese data-value, como si se la pulsara: dropdown.component.js
  // la marca y la muestra en la etiqueta
  const selectOption = (dropdown, value) =>
    Array.from(dropdown.querySelectorAll('.dropdown-option')).find((option) => option.dataset.value === value)?.click();

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

  // Mientras se espera la respuesta, el cuerpo del modal queda inerte, así lo enviado coincide con
  // lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled: conservan el foco,
  // como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    courseModalBody.inert = saving;
    courseModal.setAttribute('aria-busy', String(saving));
    [cancelCourseBtn, createCourseBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    createCourseBtn.textContent = saving ? modalTexts().saving : modalTexts().submit;
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
  // que se edita. La fila identifica al curso solo por su data-course-id (el curso_id): los datos
  // del formulario salen del curso cargado de la base, no del texto de las celdas.
  function openCourseModal(trigger, row = null) {
    const course = row ? courses.find((candidate) => String(candidate.id) === row.dataset.courseId) : null;
    if (row && !course) return;
    resetCourseForm();
    closeAllDropdowns();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    modalTrigger = trigger;
    triggerRowIndex = row ? Math.max(0, Array.from(tbody.rows).indexOf(row)) : 0;
    isEditing = Boolean(course);
    editingCourse = course;
    // El catálogo no llegó al cargar la vista: se vuelve a pedir
    if (!grades.length) loadGrades();
    courseTitle.textContent = isEditing ? 'Editar curso' : 'Nuevo curso';
    courseSubtitle.textContent = isEditing
      ? 'Modifica los datos del curso'
      : 'Completa los datos para crear un nuevo curso';
    cycleDescription.textContent = isEditing
      ? 'Pertenece al ciclo lectivo:'
      : 'Se creará para el ciclo lectivo:';
    createCourseBtn.textContent = modalTexts().submit;
    // Un curso conserva su ciclo lectivo; uno nuevo es del año en curso
    cycleYear.textContent = String(course?.schoolYear ?? new Date().getFullYear());

    if (course) {
      divisionInput.value = course.division;
      selectGrade(course.gradeName);
      selectOption(shiftDropdown, course.shift);
      selectOption(levelDropdown, course.educationLevel);
      updateCreateButtonState();
    }
    courseOverlay.classList.add('is-open');
    gradeDropdown.querySelector('.dropdown-toggle').focus();
  }

  function closeCourseModal() {
    courseOverlay.classList.remove('is-open');
    closeAllDropdowns();
    // Después de guardar, o si el curso ya no está vigente, la tabla se volvió a dibujar: el foco
    // pasa a Editar en la fila del curso o, si ya no se muestra, en la que quedó en su lugar
    const focusTarget = modalTrigger.isConnected
      ? modalTrigger
      : tbody.querySelector(`tr[data-course-id="${editingCourse?.id}"] [data-action="edit"]`) ?? focusAfterRemoval('edit');
    focusTarget.focus();
  }

  // Crea el curso o guarda sus cambios, según el modo; al terminar cierra el modal y lo avisa con un
  // toast. El error de la división se marca en el formulario y los demás salen en un toast: en ambos
  // casos el modal sigue abierto con lo que se eligió. Solo se cierra si el curso que se editaba ya
  // no está vigente.
  const saveCourse = async () => {
    const gradeName = selectedGradeName();
    const level = selectedValue(levelDropdown);
    const grade = findGrade(gradeName, level);
    // El catálogo no tiene ese grado en el nivel elegido: no hay un grado_id que enviar
    if (!grade) {
      showToast({ type: 'error', title: modalTexts().errorTitle, description: `No existe ${gradeName} de ${levelLabels[level]}.` });
      return;
    }
    // El ciclo lectivo no se envía: un curso nuevo es del año en curso, el que anuncia el modal, y
    // uno editado conserva el suyo
    const data = { gradeId: grade.id, division: divisionInput.value, shift: selectedValue(shiftDropdown) };
    setSaving(true);
    let response;
    try {
      response = await (isEditing
        ? window.api?.courses?.update(editingCourse.id, data)
        : window.api?.courses?.create(data));
    } catch (error) {
      console.error('Error al guardar el curso:', error);
    }
    // El curso que se editaba ya no está vigente: la lista se vuelve a pedir antes de liberar el
    // modal, que se cierra más abajo
    const isGone = isEditing && NO_LONGER_ACTIVE_CODES.includes(response?.error?.code);
    if (isGone) await loadCourses();
    setSaving(false);

    if (response?.ok) {
      if (isEditing) replaceCourse(response.course);
      else insertCourse(response.course);
      closeCourseModal();
      showToast({
        type: 'success',
        title: modalTexts().successTitle,
        description: modalTexts().successDescription(response.course),
      });
      return;
    }
    const error = response?.error;
    if (error?.fieldErrors?.division) {
      setFieldError(divisionInput, error.fieldErrors.division);
      divisionInput.focus();
      return;
    }
    if (isGone) closeCourseModal();
    showToast({ type: 'error', title: modalTexts().errorTitle, description: errorDescription(error) });
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
  // quedado fuera de un control. Mientras se guarda, ni Escape ni Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && courseOverlay.classList.contains('is-open') && !isSaving) closeCourseModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  createCourseBtn.addEventListener('click', () => {
    if (isSaving) return;
    // Con la división inválida, el modal sigue abierto con el foco en ella.
    if (validateFields(courseOverlay)) return;
    // El proceso principal vuelve a validar todo antes de guardar el curso.
    saveCourse();
  });

  // ---------- Modal: Eliminar curso ----------

  // El id sale del data-course-id de la fila del botón (el curso_id, fijado al crearla), no de su
  // posición en la tabla. Avisa el resultado con un toast y no resuelve ningún mensaje, así el
  // modal se cierra siempre.
  const deleteCourse = async (trigger) => {
    const row = trigger.closest('tr');
    const courseId = Number(row?.dataset.courseId);
    let response;
    try {
      response = await window.api?.courses?.delete(courseId);
    } catch (error) {
      console.error('Error al eliminar el curso:', error);
    }
    const isGone = NO_LONGER_ACTIVE_CODES.includes(response?.error?.code);
    // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
    if (response?.ok || isGone) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      removeCourse(response.course.id);
      showToast({
        type: 'success',
        title: 'Curso eliminado',
        description: `Se eliminó ${courseName(response.course)}, del ciclo lectivo ${response.course.schoolYear}.`,
      });
      return;
    }
    if (isGone) await loadCourses();
    showToast({ type: 'error', title: 'No se pudo eliminar el curso', description: errorDescription(response?.error) });
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y después se
  // cierra. Si la fila ya no está, el foco pasa a Eliminar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('deleteCourseOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: deleteCourse,
    fallbackFocus: () => focusAfterRemoval('delete'),
  });
});
