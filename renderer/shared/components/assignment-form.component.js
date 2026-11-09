// Componente global: formulario "Nueva asignación / Editar asignación" de una asignación docente
// (Docencia del Administrador y los reportes). Genera el encabezado, el cuerpo (Profesor, Nivel
// educativo, Curso, Materia, sus aclaraciones y el recuadro del ciclo lectivo) y el pie de un
// modal de formulario, y resuelve todo el formulario: las opciones, las materias del curso elegido,
// la edición, el guardado (window.api.teacherAssignments.create / update) y sus toasts. La vista
// pone el elemento dentro del .modal de su .modal-overlay y se queda con abrir y cerrar el overlay,
// el foco al cerrar y Escape.
// Marcado: <div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true"
// aria-labelledby="newAssignmentTitle"><assignment-form></assignment-form></div></div>. El
// elemento es display: contents (assignment-form.css), así sus partes quedan como hijas del
// .modal; con el atributo hidden no se muestra (un modal por pasos). Lleva los ids
// newAssignmentTitle, newAssignmentTeacherHint, newAssignmentSubject, newAssignmentSubjectError,
// newAssignmentLockedHint, newAssignmentYear, cancelNewAssignmentBtn y createAssignmentBtn, y los
// campos [data-role="teacher-select"], [data-filter="new-assignment-level"],
// [data-role="course-select"] y [data-filter="new-assignment-subject"]: una sola vez por vista.
// El script se carga sin defer en <head>: el marcado existe cuando la vista llama a setupDropdowns
// en DOMContentLoaded, que así toma también los desplegables del formulario.
// API del elemento:
//   - setup({ closeDropdown, closeAllDropdowns, onSaved, onCancel, onStale }), una vez, después de
//     setupDropdowns (de él vienen closeDropdown y closeAllDropdowns), así sus listeners corren
//     antes que los del formulario.
//       - onSaved({ teacherAssignment, mode }): se guardó; mode es 'create' o 'edit'. La vista
//         actualiza su tabla y cierra el modal; después el componente muestra el toast de éxito.
//       - onCancel(): se pulsó Cancelar (mientras se guarda no responde).
//       - onStale(code): el proceso principal avisó que la asignación quedó vieja
//         (staleAssignmentCodes: ya no está vigente, su ciclo lectivo se cerró o tiene evaluaciones
//         que la vista no mostraba). La vista recarga sus datos y cierra el modal (o vuelve a otro
//         paso); el toast de error lo muestra el componente.
//     Si onSaved u onStale devuelven una promesa, el formulario sigue guardando (inerte, con
//     "Creando…" o "Guardando…") hasta que se resuelve.
//   - open({ assignment = null, preset = null, lockCourseAndSubject = false,
//     requireTeacherChange = false }): deja el formulario listo para un alta o, con `assignment`,
//     para editarla; no abre ningún overlay. `assignment` es { id, teacher: { id, firstName,
//     lastName }, course: { id, educationLevel, schoolYear, gradeName, division, shift },
//     subject: { id, name }, hasEvaluations }; `preset` ({ course, subject }, con la misma forma)
//     precarga un alta. Con lockCourseAndSubject, con preset o en una asignación con evaluaciones,
//     el nivel educativo, el curso y la materia quedan bloqueados con su valor (con evaluaciones,
//     además, con la aclaración). Con requireTeacherChange, el botón principal queda
//     deshabilitado mientras el profesor elegido sea el de la asignación.
//   - focusFirst(): el foco en Profesor o, si está bloqueado, en Cancelar (al abrir el modal).
//   - closeMenus(): cierra los desplegables y los buscadores (al cerrar el modal).
//   - isSaving: si se está esperando la respuesta (la vista no cierra el modal con Escape).
//   - reloadOptions(): pide los profesores activos y los cursos del ciclo lectivo en curso; la
//     vista lo llama al cargar. Si no llegan, se vuelven a pedir al abrir el formulario.
//   - setCurrentSchoolYear(schoolYear): el ciclo lectivo actual ({ year, today }, de
//     loadCurrentSchoolYear, school-year.js) que anuncia el recuadro de un alta y que distingue
//     los cursos de otro ciclo. La vista lo pasa cuando lo recibe.
// Ayudas para la vista, con los mismos textos que el formulario: createTeacherOption(teacher) y
// createSubjectOption(subject) (las opciones de sus filtros Profesor y Materia), courseName(course)
// ("1° A · Mañana"), levelLabel(level) ("Primaria"), subjectInCourse({ course, subject }) ("Lengua
// en 1° A de Primaria, turno Mañana"), errorDescription(error) (la descripción de un toast de
// error), compareCourses(a, b) e insertSorted(items, item, compare) (el orden del listado), y
// staleAssignmentCodes.
// Dependencias (scripts sin defer en <head>, antes que este, y sus .css): dropdown.component.js
// (dropdown.css), searchable-select.component.js (searchable-select.css), field-validation
// (form-field.css), modal-dropdown.js (modal-dropdown.css), modal-resize.js, modal-focus-trap,
// user-avatar.component.js, text-truncate.component.js, toast.component.js (toast.css); además
// buttons.css, info-box.css y assignment-form.css.

(() => {
  // Etiquetas de Nivel educativo y de Turno, que llegan como PRIMARY o SECONDARY y MORNING o
  // AFTERNOON: las mismas de las opciones del formulario y de los botones del filtro Curso
  const LEVEL_LABELS = { PRIMARY: 'Primaria', SECONDARY: 'Secundaria' };
  const SHIFT_LABELS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };

  // Orden aproximado al del listado (FIND_BY_INSTITUTION_SQL, teacher-assignment.repository.js)
  const LEVEL_ORDER = ['PRIMARY', 'SECONDARY'];
  const SHIFT_ORDER = ['MORNING', 'AFTERNOON'];

  // La asignación ya no está vigente: los datos de la vista quedaron viejos
  const NO_LONGER_ACTIVE_CODES = ['TEACHER_ASSIGNMENT_NOT_FOUND', 'TEACHER_ASSIGNMENT_ALREADY_DELETED'];
  // Lo mismo al guardar o eliminar, que además rechazan la de un ciclo lectivo que se cerró con la
  // vista abierta desde antes del cambio de año y, en una con evaluaciones, el cambio de curso o de
  // materia y la baja: la vista la mostraba sin evaluaciones porque otra sesión creó una después de
  // cargarla
  const STALE_ASSIGNMENT_CODES = [...NO_LONGER_ACTIVE_CODES, 'SCHOOL_YEAR_CLOSED', 'TEACHER_ASSIGNMENT_HAS_EVALUATIONS'];

  // Códigos con los que el proceso principal avisa que un profesor o un curso que ofrece el
  // formulario ya no se puede elegir (otra sesión lo suspendió o lo dio de baja): las listas se
  // vuelven a pedir
  const STALE_OPTION_CODES = ['TEACHER_NOT_AVAILABLE', 'COURSE_NOT_AVAILABLE'];

  const COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';
  const SUBJECT_LOCKED_PLACEHOLDER = 'Selecciona primero un curso';
  const SUBJECT_UNLOCKED_PLACEHOLDER = 'Seleccionar materia';
  const NO_SUBJECTS_LEFT = 'El curso ya tiene todas sus materias asignadas';
  const LOCKED_HINT = 'La asignación tiene evaluaciones: el curso y la materia no se pueden cambiar.';

  const nameCollator = new Intl.Collator('es');
  const compareSubjects = (a, b) => nameCollator.compare(a.name, b.name) || a.id - b.id;

  // "1° A · Mañana"
  const courseName = (course) => `${course.gradeName} ${course.division} · ${SHIFT_LABELS[course.shift] ?? course.shift}`;

  const compareCourses = (a, b) =>
    LEVEL_ORDER.indexOf(a.educationLevel) - LEVEL_ORDER.indexOf(b.educationLevel) ||
    a.gradeName.localeCompare(b.gradeName) ||
    a.division.localeCompare(b.division) ||
    SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift) ||
    a.id - b.id;

  // `items`, ya ordenados, con `item` en el lugar que le toca según `compare`
  const insertSorted = (items, item, compare) => {
    const index = items.findIndex((other) => compare(item, other) < 0);
    return items.toSpliced(index === -1 ? items.length : index, 0, item);
  };

  // "Lengua en 1° A de Primaria, turno Mañana", como lo nombran los toasts del alta, la edición y
  // la baja
  const subjectInCourse = ({ course, subject }) =>
    `${subject.name} en ${course.gradeName} ${course.division} de ${LEVEL_LABELS[course.educationLevel]}, turno ${SHIFT_LABELS[course.shift]}`;

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // Texto del botón principal, en reposo y mientras se espera la respuesta, y de los toasts de
  // éxito y de error, según el modo del formulario
  const MODAL_TEXTS = {
    create: {
      title: 'Nueva asignación',
      subtitle: 'Completa los datos para crear una nueva asignación docente',
      // Una asignación nueva es del año en curso (showCycleYear)
      cycleDescription: 'Se creará para el ciclo lectivo:',
      submit: 'Crear asignación',
      saving: 'Creando…',
      successTitle: 'Asignación creada',
      // "Pablo Fernández dictará Lengua en 1° A de Primaria, turno Mañana."
      successDescription: (assignment) =>
        `${assignment.teacher.firstName} ${assignment.teacher.lastName} dictará ${subjectInCourse(assignment)}.`,
      errorTitle: 'No se pudo crear la asignación',
    },
    edit: {
      title: 'Editar asignación',
      subtitle: 'Modifica los datos de la asignación',
      // Una asignación es del ciclo lectivo de su curso
      cycleDescription: 'Pertenece al ciclo lectivo:',
      submit: 'Guardar cambios',
      saving: 'Guardando…',
      successTitle: 'Asignación actualizada',
      // "Pablo Fernández dicta Lengua en 1° A de Primaria, turno Mañana, en el ciclo lectivo 2026."
      successDescription: (assignment) =>
        `${assignment.teacher.firstName} ${assignment.teacher.lastName} dicta ${subjectInCourse(assignment)}, en el ciclo lectivo ${assignment.course.schoolYear}.`,
      errorTitle: 'No se pudieron guardar los cambios',
    },
  };

  const CHEVRON_ICON = `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>`;
  const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>`;

  // Los textos de las etiquetas y las opciones son los de MODAL_TEXTS.create y LEVEL_LABELS; el
  // modo y los bloqueos los cambia open()
  const MARKUP = `<div class="modal-header">
        <h2 id="newAssignmentTitle">${MODAL_TEXTS.create.title}</h2>
        <p>${MODAL_TEXTS.create.subtitle}</p>
      </div>

      <div class="modal-body">
        <div class="form-field">
          <label>Profesor</label>
          <div class="field field-searchable dropdown-searchable" data-role="teacher-select">
            <div class="searchable-bar">
              <span class="searchable-icon">
                ${SEARCH_ICON}
              </span>
              <input type="text" class="searchable-input" placeholder="Buscar profesor" autocomplete="off" aria-describedby="newAssignmentTeacherHint" />
              <div class="searchable-value"></div>
              <button type="button" class="searchable-chevron" aria-label="Abrir lista de profesores" aria-expanded="false" aria-describedby="newAssignmentTeacherHint">
                ${CHEVRON_ICON}
              </button>
            </div>
            <ul class="dropdown-menu dropdown-menu-teacher" role="listbox" hidden>
              <li class="dropdown-empty" hidden>Sin resultados</li>
            </ul>
          </div>
          <!-- Aclaraciones: el componente les pone el texto al mostrarlas y las vacía al ocultarlas,
               así un campo no queda descrito por una oculta -->
          <p class="field-hint" id="newAssignmentTeacherHint" hidden></p>
        </div>

        <div class="form-field">
          <label>Nivel educativo</label>
          <div class="field field-select dropdown" data-filter="new-assignment-level">
            <button type="button" class="dropdown-toggle" aria-haspopup="listbox" aria-expanded="false">
              <span class="dropdown-label text-truncate placeholder">Seleccionar nivel educativo</span>
              ${CHEVRON_ICON}
            </button>
            <ul class="dropdown-menu" role="listbox" hidden>
              <li class="dropdown-option" role="option" data-value="PRIMARY" aria-selected="false">${LEVEL_LABELS.PRIMARY}</li>
              <li class="dropdown-option" role="option" data-value="SECONDARY" aria-selected="false">${LEVEL_LABELS.SECONDARY}</li>
            </ul>
          </div>
        </div>

        <div class="form-field">
          <label>Curso</label>
          <div class="field field-searchable dropdown-searchable is-locked" data-role="course-select">
            <div class="searchable-bar">
              <span class="searchable-icon">
                ${SEARCH_ICON}
              </span>
              <input type="text" class="searchable-input" placeholder="${COURSE_LOCKED_PLACEHOLDER}" autocomplete="off" disabled />
              <div class="searchable-value"></div>
              <button type="button" class="searchable-chevron" aria-label="Abrir lista de cursos" aria-expanded="false" disabled>
                ${CHEVRON_ICON}
              </button>
            </div>
            <ul class="dropdown-menu dropdown-menu-course" role="listbox" hidden>
              <li class="dropdown-empty" hidden>Sin resultados</li>
            </ul>
          </div>
        </div>

        <div class="form-field">
          <label>Materia</label>
          <div class="field field-select dropdown is-locked" data-filter="new-assignment-subject">
            <button type="button" class="dropdown-toggle" id="newAssignmentSubject" aria-haspopup="listbox" aria-expanded="false" aria-describedby="newAssignmentSubjectError newAssignmentLockedHint" disabled>
              <span class="dropdown-label text-truncate placeholder">${SUBJECT_LOCKED_PLACEHOLDER}</span>
              ${CHEVRON_ICON}
            </button>
            <ul class="dropdown-menu" role="listbox" hidden></ul>
          </div>
          <p class="field-error" id="newAssignmentSubjectError" hidden></p>
          <p class="field-hint" id="newAssignmentLockedHint" hidden></p>
        </div>

        <div class="info-box">
          <span class="info-box-icon">
            <!-- resources/CalendarDays.svg -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
            </svg>
          </span>
          <div class="info-box-text">
            <p><span>${MODAL_TEXTS.create.cycleDescription}</span> <strong id="newAssignmentYear">—</strong></p>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelNewAssignmentBtn">Cancelar</button>
        <button type="button" class="btn btn-primary" id="createAssignmentBtn" disabled>${MODAL_TEXTS.create.submit}</button>
      </div>

      <!-- Plantillas de las opciones: el componente las completa con lo que devuelve el proceso
           principal. Las de Profesor y Materia sirven también a los filtros de la vista -->
      <template data-template="teacher-option">
        <li class="dropdown-option option-teacher avatar-item" role="option" aria-selected="false">
          <span class="avatar-circle option-avatar"></span>
          <span class="avatar-item-text">
            <span class="option-name text-truncate"></span>
            <span class="option-email text-truncate"></span>
          </span>
        </li>
      </template>
      <template data-template="subject-option">
        <li class="dropdown-option" role="option" aria-selected="false"></li>
      </template>
      <template data-template="course-option">
        <li class="dropdown-option" role="option" aria-selected="false"><span class="option-name text-truncate"></span></li>
      </template>`;

  class AssignmentForm extends HTMLElement {
    connectedCallback() {
      // Se genera una sola vez: los listeners de setup quedan sobre estos nodos
      if (this.rendered) return;
      this.rendered = true;
      this.innerHTML = MARKUP;
    }

    // ---------- Ayudas para la vista ----------

    courseName = courseName;
    subjectInCourse = subjectInCourse;
    errorDescription = errorDescription;
    compareCourses = compareCourses;
    insertSorted = insertSorted;
    staleAssignmentCodes = STALE_ASSIGNMENT_CODES;

    levelLabel(level) {
      return LEVEL_LABELS[level] ?? level;
    }

    #cloneTemplate(name) {
      return this.querySelector(`template[data-template="${name}"]`).content.firstElementChild.cloneNode(true);
    }

    createTeacherOption(teacher) {
      const option = this.#cloneTemplate('teacher-option');
      option.dataset.value = String(teacher.id);
      fillAvatar(option.querySelector('.avatar-circle'), teacher);
      option.querySelector('.option-name').textContent = `${teacher.lastName}, ${teacher.firstName}`;
      option.querySelector('.option-email').textContent = teacher.email;
      return option;
    }

    createSubjectOption(subject) {
      const option = this.#cloneTemplate('subject-option');
      option.dataset.value = String(subject.id);
      option.textContent = subject.name;
      return option;
    }

    // El curso se busca dentro de un nivel educativo (data-level), que elige el campo anterior, y
    // lleva su ciclo lectivo (data-school-year), que el formulario anuncia al elegirlo. Uno de otro
    // ciclo (el de la asignación que se edita) se muestra con su año: puede haber otro igual en el
    // ciclo actual.
    createCourseOption(course) {
      const option = this.#cloneTemplate('course-option');
      option.dataset.value = String(course.id);
      option.dataset.level = course.educationLevel;
      option.dataset.schoolYear = String(course.schoolYear);
      option.querySelector('.option-name').textContent = course.schoolYear === this.#currentSchoolYear?.year
        ? courseName(course)
        : `${courseName(course)} · ${course.schoolYear}`;
      return option;
    }

    // ---------- Estado ----------

    #currentSchoolYear = null;
    #isSaving = false;
    // Lo que pidió open(): la asignación que se edita (null en un alta), el alta precargada y los
    // bloqueos
    #editingAssignment = null;
    #preset = null;
    #lockCourseAndSubject = false;
    #requireTeacherChange = false;

    get isSaving() {
      return this.#isSaving;
    }

    // Las funciones que arma setup(), que usan los nodos y los listeners del formulario
    #form = null;

    setCurrentSchoolYear(schoolYear) {
      this.#currentSchoolYear = schoolYear;
      // El formulario pudo abrirse antes de que llegara el año que anuncia; con un curso elegido,
      // anuncia el del curso
      this.#form?.refreshCycleYear();
    }

    setup(options) {
      this.#form = this.#createForm(options);
    }

    open(options) {
      this.#form.open(options);
    }

    focusFirst() {
      this.#form.focusFirst();
    }

    closeMenus() {
      this.#form.closeMenus();
    }

    reloadOptions() {
      return this.#form.loadFormOptions();
    }

    // Toda la lógica del formulario, sobre sus nodos. Devuelve las funciones que usa la API.
    #createForm({ closeDropdown, closeAllDropdowns, onSaved, onCancel, onStale }) {
      const modal = this.closest('.modal');
      const modalBody = this.querySelector('.modal-body');
      const cancelButton = this.querySelector('#cancelNewAssignmentBtn');
      const submitButton = this.querySelector('#createAssignmentBtn');
      const title = this.querySelector('#newAssignmentTitle');
      const subtitle = this.querySelector('.modal-header p');
      const cycleDescription = this.querySelector('.info-box-text span');
      const cycleYear = this.querySelector('#newAssignmentYear');
      // El texto del marcado, una raya: el año mientras no llega el ciclo lectivo actual
      const YEAR_PLACEHOLDER = cycleYear.textContent;

      const teacherRoot = this.querySelector('[data-role="teacher-select"]');
      const courseRoot = this.querySelector('[data-role="course-select"]');
      const levelDropdown = this.querySelector('[data-filter="new-assignment-level"]');
      const levelOptions = levelDropdown.querySelectorAll('.dropdown-option');
      const subjectDropdown = this.querySelector('[data-filter="new-assignment-subject"]');
      // El error de la materia va en #newAssignmentSubjectError, con setFieldError
      // (field-validation.component.js)
      const subjectToggle = this.querySelector('#newAssignmentSubject');
      const subjectLabel = subjectDropdown.querySelector('.dropdown-label');
      const subjectMenu = subjectDropdown.querySelector('.dropdown-menu');
      // Aclaraciones al editar: el profesor de la asignación está suspendido, o el curso y la
      // materia quedan bloqueados porque tiene evaluaciones
      const teacherHint = this.querySelector('#newAssignmentTeacherHint');
      const lockedHint = this.querySelector('#newAssignmentLockedHint');
      // dropdown.component.js guardó el texto inicial de la etiqueta
      const LEVEL_PLACEHOLDER = levelDropdown.querySelector('.dropdown-label').dataset.placeholder;

      const modalTexts = () => MODAL_TEXTS[this.#editingAssignment ? 'edit' : 'create'];
      // El curso y la materia que el formulario trae elegidos: los de la asignación que se edita o
      // los del alta precargada
      const ownCourse = () => this.#editingAssignment?.course ?? this.#preset?.course ?? null;
      const ownSubject = () => this.#editingAssignment?.subject ?? this.#preset?.subject ?? null;
      // Nivel educativo, curso y materia quedan bloqueados con su valor
      const locksCourseAndSubject = () =>
        Boolean(this.#editingAssignment?.hasEvaluations || this.#preset || this.#lockCourseAndSubject);

      // Ciclo lectivo que anuncia el formulario: el del curso elegido (`courseOption`); sin curso,
      // el de la asignación que se edita o, en un alta, el actual
      const showCycleYear = (courseOption = null) => {
        cycleYear.textContent = courseOption?.dataset.schoolYear
          ?? String(this.#editingAssignment?.course.schoolYear ?? this.#currentSchoolYear?.year ?? YEAR_PLACEHOLDER);
      };

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

      const closeMenus = () => {
        closeAllDropdowns();
        closeAllSearchableMenus();
      };

      const selectedSubjectOption = () => subjectMenu.querySelector('.dropdown-option.selected');

      // Con requireTeacherChange, el profesor elegido tiene que ser otro que el de la asignación
      const updateSubmitButtonState = () => {
        const teacherId = teacherSelect.getValue();
        const hasTeacher = Boolean(teacherId);
        const hasLevel = Boolean(levelDropdown.querySelector('.dropdown-option.selected'));
        const hasCourse = Boolean(courseSelect.getValue());
        const hasSubject = Boolean(selectedSubjectOption());
        const keepsTeacher = this.#requireTeacherChange && teacherId === String(this.#editingAssignment?.teacher.id);
        submitButton.disabled = !(hasTeacher && hasLevel && hasCourse && hasSubject) || keepsTeacher;
      };

      // Deja un desplegable del formulario (Nivel educativo o Materia) sin selección y con `text`
      // en su etiqueta: bloqueado mientras no se pueda elegir, o listo para elegir
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
      // Bloquea un desplegable sin borrar lo elegido, que se sigue viendo: el nivel educativo y la
      // materia de una asignación con evaluaciones o precargada. resetDropdown lo desbloquea.
      const lockDropdownWithValue = (dropdown) => {
        dropdown.classList.add('is-locked');
        dropdown.querySelector('.dropdown-toggle').disabled = true;
      };

      // Muestra una aclaración con `text`, o la vacía y la oculta: así aria-describedby no anuncia
      // una que no se ve
      const setHint = (hint, text) => {
        hint.textContent = text;
        hint.hidden = !text;
      };

      // ---------- Materias del curso elegido ----------

      // Cambia cada vez que Materia se vacía: descarta la respuesta que se esté esperando con las
      // materias de otro curso
      let subjectsRequestId = 0;

      // Materia sin opciones ni error, bloqueada con `text`: a la espera de un curso o de sus
      // materias, o porque no hay ninguna para elegir
      const lockSubject = (text = SUBJECT_LOCKED_PLACEHOLDER) => {
        subjectsRequestId += 1;
        subjectMenu.replaceChildren();
        setFieldError(subjectToggle, '');
        lockDropdown(subjectDropdown, text);
        updateSubmitButtonState();
      };

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
        updateSubmitButtonState();
      };

      subjectMenu.addEventListener('click', (event) => {
        const option = event.target.closest('.dropdown-option');
        if (!option) return;
        selectSubject(option);
        closeDropdown(subjectDropdown);
      });

      // Pide las materias que se pueden asignar en el curso elegido: las de su grado que todavía no
      // tienen un profesor en él. Mientras llegan, si no queda ninguna o si la consulta falla,
      // Materia sigue bloqueada con el motivo. Al editar se envía también el id de la asignación:
      // con su curso llega además su materia. Con el curso propio (el de la asignación o el del
      // alta precargada), su materia queda elegida y, si corresponde, bloqueada.
      const loadSubjects = async (courseId) => {
        lockSubject('Cargando materias…');
        const requestId = subjectsRequestId;
        let response;
        try {
          response = await window.api?.teacherAssignments?.listAssignableSubjects(courseId, this.#editingAssignment?.id ?? null);
        } catch (error) {
          console.error('Error al cargar las materias:', error);
        }
        // Mientras se esperaba se eligió otro curso u otro nivel, o se reinició el formulario
        if (requestId !== subjectsRequestId) return;
        if (!response?.ok) {
          lockSubject('No se pudieron cargar las materias');
          const error = response?.error;
          const isStale = STALE_OPTION_CODES.includes(error?.code);
          const isGone = NO_LONGER_ACTIVE_CODES.includes(error?.code);
          if (!isStale && !isGone) return;
          showToast({ type: 'error', title: 'No se pudieron cargar las materias', description: error.message });
          // El curso ya no se puede elegir: las listas del formulario quedaron viejas
          if (isStale) loadFormOptions();
          // La asignación que se editaba ya no está vigente: no hay nada que guardar
          if (isGone) await onStale?.(error.code);
          return;
        }
        if (!response.subjects.length) {
          lockSubject(NO_SUBJECTS_LEFT);
          return;
        }
        subjectMenu.replaceChildren(...response.subjects.map((subject) => this.createSubjectOption(subject)));
        unlockDropdown(subjectDropdown, SUBJECT_UNLOCKED_PLACEHOLDER);
        if (ownCourse()?.id !== courseId) return;
        const ownOption = subjectMenu.querySelector(`.dropdown-option[data-value="${ownSubject()?.id}"]`);
        if (!ownOption) return;
        selectSubject(ownOption);
        if (locksCourseAndSubject()) lockDropdownWithValue(subjectDropdown);
      };

      // El proceso principal rechazó la materia elegida (otra sesión la asignó en ese curso con el
      // formulario abierto): el error queda en el campo, que la sigue mostrando, y la materia deja
      // de ofrecerse, así que para volver a guardar hay que elegir otra. Si era la última sin
      // asignar, Materia queda bloqueada.
      const rejectSubject = (message) => {
        selectedSubjectOption()?.remove();
        if (!subjectMenu.children.length) lockDropdown(subjectDropdown, NO_SUBJECTS_LEFT);
        setFieldError(subjectToggle, message);
        updateSubmitButtonState();
        (subjectToggle.disabled ? cancelButton : subjectToggle).focus();
      };

      // ---------- Profesores y cursos que se pueden elegir ----------

      // Texto con el que Profesor y Nivel educativo quedan bloqueados mientras su lista no se puede
      // usar (no llegó o llegó vacía); null cuando se puede elegir
      let teacherLockText = null;
      let levelLockText = null;
      let isLoadingFormOptions = false;
      // Profesores y cursos que ofrece el alta, como llegaron del proceso principal; null si no
      // llegaron
      let assignableTeachers = null;
      let assignableCourses = null;
      // Llegaron las dos listas: si no, se vuelven a pedir al abrir el formulario
      let hasFormOptions = false;

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

      const resetForm = () => {
        teacherSelect.reset();
        if (teacherLockText) teacherSelect.lock(teacherLockText);
        else teacherSelect.unlock();

        if (levelLockText) lockDropdown(levelDropdown, levelLockText);
        else unlockDropdown(levelDropdown, LEVEL_PLACEHOLDER);

        courseSelect.reset();
        courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);
        showCycleYear();

        lockSubject();

        // Al editar, fillOwnValues las vuelve a mostrar si corresponde
        setHint(teacherHint, '');
        setHint(lockedHint, '');
      };

      // El primer campo del formulario o, si está bloqueado, Cancelar
      const focusFirst = () => {
        const chevron = teacherRoot.querySelector('.searchable-chevron');
        (chevron.disabled ? cancelButton : chevron).focus();
      };

      // `items` (los cursos del alta) con `ownItem`, el de la asignación que se edita o el del alta
      // precargada, si no estaba; sin él, o si la lista no llegó, queda como está
      const withOwnItem = (items, ownItem, compare) =>
        (!items || !ownItem || items.some(({ id }) => id === ownItem.id) ? items : insertSorted(items, ownItem, compare));

      // Arma las opciones de Profesor y de Curso con las listas del alta. Se suma el curso propio
      // si el alta no lo ofrece (al editar, uno de otro ciclo lectivo o dado de baja): la asignación
      // lo puede conservar. El profesor no: tiene que ser uno de los activos, aunque sea el que ya
      // tiene, así que a uno suspendido no se lo ofrece (fillOwnValues lo nombra en una
      // aclaración). Los dos campos quedan sin valor.
      const fillFormOptions = () => {
        const courses = withOwnItem(assignableCourses, ownCourse(), compareCourses);
        teacherSelect.setOptions((assignableTeachers ?? []).map((teacher) => this.createTeacherOption(teacher)));
        courseSelect.setOptions((courses ?? []).map((course) => this.createCourseOption(course)));
        // De los niveles educativos quedan a la vista los que tienen algún curso
        levelOptions.forEach((option) => {
          option.hidden = !courses?.some((course) => course.educationLevel === option.dataset.value);
        });
        teacherLockText = lockTextOf(assignableTeachers, 'No se pudieron cargar los profesores', 'No hay profesores activos');
        levelLockText = lockTextOf(courses, 'No se pudieron cargar los cursos', `No hay cursos del ciclo lectivo ${this.#currentSchoolYear?.year ?? 'actual'}`);
      };

      // Al editar, el formulario llega con el nivel educativo y el curso de la asignación
      // (fillFormOptions los ofrece siempre) y con su profesor, si es uno de los activos. Si la
      // lista de profesores llegó y el suyo no está, es que está suspendido (la base no deja dar de
      // baja a uno con asignaciones vigentes del ciclo actual, y las de un ciclo cerrado no se
      // editan): no hay opción para él, Profesor queda vacío con una aclaración que lo nombra y
      // guardar sigue deshabilitado hasta elegir otro. Un alta precargada llega con el nivel
      // educativo y el curso, sin profesor. Con el curso llegan sus materias, y entre ellas la
      // propia, que queda elegida (loadSubjects). Si la asignación tiene evaluaciones, o si se
      // pidió bloquearlos, el nivel educativo y el curso quedan bloqueados con su valor (con
      // evaluaciones, la aclaración lo explica); la materia se bloquea al llegar.
      const fillOwnValues = () => {
        const course = ownCourse();
        if (!course) return;
        const clickOption = (root, value) => {
          const option = Array.from(root.querySelectorAll('.dropdown-option'))
            .find((candidate) => candidate.dataset.value === String(value) && !candidate.hidden);
          option?.click();
          return Boolean(option);
        };
        const teacher = this.#editingAssignment?.teacher;
        if (teacher) {
          if (!teacherLockText) clickOption(teacherRoot, teacher.id);
          if (assignableTeachers && !assignableTeachers.some(({ id }) => id === teacher.id)) {
            setHint(teacherHint, `${teacher.firstName} ${teacher.lastName} está suspendido: elige otro profesor para guardar la asignación.`);
          }
        }
        const hasCourse = !levelLockText && clickOption(levelDropdown, course.educationLevel) && clickOption(courseRoot, course.id);
        if (locksCourseAndSubject() && hasCourse) {
          lockDropdownWithValue(levelDropdown);
          courseSelect.lock();
          if (this.#editingAssignment?.hasEvaluations) setHint(lockedHint, LOCKED_HINT);
        }
      };

      // El formulario está a la vista: su overlay está abierto y no es un paso oculto
      const isShown = () => Boolean(this.closest('.modal-overlay')?.classList.contains('is-open')) && !this.hidden;

      // Pide los profesores activos de la institución y sus cursos vigentes del ciclo lectivo en
      // curso: las opciones de Profesor y de Curso. Punto de entrada también para volver a pedirlos
      // al abrir el formulario, si no habían llegado, y cuando el proceso principal avisa que
      // quedaron viejos. El formulario vuelve a quedar como al abrirlo: lo elegido puede no estar
      // en las listas nuevas.
      const loadFormOptions = async () => {
        if (isLoadingFormOptions) return;
        isLoadingFormOptions = true;
        hasFormOptions = false;
        teacherLockText = 'Cargando profesores…';
        levelLockText = 'Cargando cursos…';
        resetForm();
        [assignableTeachers, assignableCourses] = await Promise.all([
          requestOptions(() => window.api?.teacherAssignments?.listAssignableTeachers(), 'teachers'),
          requestOptions(() => window.api?.teacherAssignments?.listAssignableCourses(), 'courses'),
        ]);
        isLoadingFormOptions = false;
        hasFormOptions = Boolean(assignableTeachers && assignableCourses);
        fillFormOptions();
        resetForm();
        // El formulario está abierto con valores propios: se abrió antes de que llegaran las
        // listas, o quedaron viejas con él a la vista
        if (isShown()) fillOwnValues();
      };

      // ---------- Formulario ----------

      // Elegir un profesor resuelve la aclaración del suspendido
      teacherSelect.onSelect(() => {
        setHint(teacherHint, '');
        updateSubmitButtonState();
      });

      courseSelect.onSelect((option) => {
        showCycleYear(option);
        loadSubjects(Number(option.dataset.value));
      });

      levelOptions.forEach((option) => {
        option.addEventListener('click', () => {
          courseSelect.reset();
          courseSelect.setGroupFilter(option.dataset.value);
          courseSelect.unlock(COURSE_UNLOCKED_PLACEHOLDER);
          showCycleYear();
          lockSubject();
        });
      });

      // Mientras se espera la respuesta, el cuerpo del formulario queda inerte, así lo enviado
      // coincide con lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled:
      // conservan el foco, como en confirm-modal.component.js.
      const setSaving = (saving) => {
        this.#isSaving = saving;
        modalBody.inert = saving;
        modal?.setAttribute('aria-busy', String(saving));
        [cancelButton, submitButton].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
        submitButton.textContent = saving ? modalTexts().saving : modalTexts().submit;
      };

      const open = ({ assignment = null, preset = null, lockCourseAndSubject = false, requireTeacherChange = false } = {}) => {
        this.#editingAssignment = assignment;
        this.#preset = assignment ? null : preset;
        this.#lockCourseAndSubject = lockCourseAndSubject;
        this.#requireTeacherChange = Boolean(assignment) && requireTeacherChange;
        // Las opciones de Curso dependen del curso propio
        if (hasFormOptions) fillFormOptions();
        resetForm();
        closeMenus();
        const texts = modalTexts();
        title.textContent = texts.title;
        subtitle.textContent = texts.subtitle;
        cycleDescription.textContent = texts.cycleDescription;
        submitButton.textContent = texts.submit;

        // Las listas no llegaron al cargar la vista: se vuelven a pedir
        if (!hasFormOptions) loadFormOptions();
        else fillOwnValues();
      };

      // Crea la asignación o guarda sus cambios, según el modo, y avisa el resultado con un toast,
      // después de onSaved. Si el proceso principal rechaza la materia (ya tiene un profesor en ese
      // curso), el error se marca en el campo y los demás salen en un toast: en ambos casos el
      // formulario sigue abierto. Al editar, el rechazo de la materia sale además en el toast. Si
      // el profesor o el curso ya no se pueden elegir, las listas se vuelven a pedir antes de
      // liberar el formulario. Si la asignación que se editaba quedó vieja
      // (STALE_ASSIGNMENT_CODES), se espera onStale: ya no está vigente, su ciclo lectivo se cerró
      // o tiene evaluaciones que la vista no mostraba.
      const saveAssignment = async () => {
        const data = {
          teacherId: Number(teacherSelect.getValue()),
          courseId: Number(courseSelect.getValue()),
          subjectId: Number(selectedSubjectOption().dataset.value),
        };
        const texts = modalTexts();
        const mode = this.#editingAssignment ? 'edit' : 'create';
        setSaving(true);
        let response;
        try {
          response = await (this.#editingAssignment
            ? window.api?.teacherAssignments?.update(this.#editingAssignment.id, data)
            : window.api?.teacherAssignments?.create(data));
        } catch (error) {
          console.error('Error al guardar la asignación docente:', error);
        }
        const error = response?.error;
        const isStale = STALE_OPTION_CODES.includes(error?.code);
        const isStaleAssignment = STALE_ASSIGNMENT_CODES.includes(error?.code);
        if (isStale) await loadFormOptions();

        if (response?.ok) {
          await onSaved?.({ teacherAssignment: response.teacherAssignment, mode });
          setSaving(false);
          showToast({
            type: 'success',
            title: texts.successTitle,
            description: texts.successDescription(response.teacherAssignment),
          });
          return;
        }
        if (isStaleAssignment) await onStale?.(error.code);
        setSaving(false);
        if (error?.fieldErrors?.subject) {
          rejectSubject(error.fieldErrors.subject);
          if (mode === 'create') return;
        }
        // El formulario volvió a quedar como al abrirlo
        if (isStale) focusFirst();
        showToast({ type: 'error', title: texts.errorTitle, description: errorDescription(error) });
      };

      cancelButton.addEventListener('click', () => {
        if (!this.#isSaving) onCancel?.();
      });

      submitButton.addEventListener('click', () => {
        if (this.#isSaving) return;
        // El proceso principal vuelve a validar todo antes de guardar la asignación.
        saveAssignment();
      });

      return {
        open,
        focusFirst,
        closeMenus,
        loadFormOptions,
        // Sin curso elegido, el recuadro anuncia el ciclo actual
        refreshCycleYear: () => {
          if (!courseSelect.getValue()) showCycleYear();
        },
      };
    }
  }

  customElements.define('assignment-form', AssignmentForm);
})();
