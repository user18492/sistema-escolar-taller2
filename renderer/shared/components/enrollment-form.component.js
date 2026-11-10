// Componente global: formulario "Nueva inscripción" (Inscripciones del Secretario y sus reportes
// Inscripciones activas por curso y Alumnos activos sin inscripción). Genera el encabezado, el cuerpo (Alumno, Nivel educativo y
// Curso) y el pie de un modal de formulario, y resuelve todo el formulario: las opciones, el
// guardado (window.api.enrollments.create) y sus toasts. La vista pone el elemento dentro del .modal
// de su .modal-overlay y se queda con abrir y cerrar el overlay, el foco al cerrar y Escape.
// Marcado: <div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true"
// aria-labelledby="newEnrollmentTitle"><enrollment-form></enrollment-form></div></div>. El elemento
// es display: contents (enrollment-form.css), así sus partes quedan como hijas del .modal; con el
// atributo hidden no se muestra (un modal por pasos, list-modal.component.js). Lleva los ids
// newEnrollmentTitle, cancelNewEnrollmentBtn y createEnrollmentBtn, y los campos
// [data-role="new-enrollment-student-select"], [data-filter="new-enrollment-level"] y
// [data-role="new-enrollment-course-select"]: una sola vez por vista.
// El script se carga sin defer en <head>: el marcado existe cuando la vista llama a setupDropdowns
// en DOMContentLoaded, que así toma también el desplegable Nivel educativo.
// API del elemento:
//   - setup({ closeAllDropdowns, onSaved, onCancel, onStale }), una vez, después de setupDropdowns
//     (de él viene closeAllDropdowns), así sus listeners corren antes que los del formulario.
//       - onSaved(enrollment): se creó la inscripción (como la devuelve enrollments.create). La
//         vista actualiza su tabla y cierra el modal; después el componente muestra el toast de
//         éxito. Si resuelve un texto, el toast lo suma a su descripción (p. ej., que la
//         inscripción no se ve por los filtros).
//       - onCancel(): se pulsó Cancelar (mientras se guarda no responde).
//       - onStale(code): en un alta precargada (preset), el proceso principal avisó que lo que llegó
//         cargado ya no se puede elegir: el curso (COURSE_STALE_CODES: otra sesión lo dio de baja o
//         cambió el año) o el alumno (STUDENT_STALE_CODES: otra sesión lo dio de baja, lo pasó a
//         egresado o lo inscribió). La vista recarga sus datos y cierra el modal; el toast de error
//         lo muestra el componente.
//     Si onSaved u onStale devuelven una promesa, el formulario sigue guardando (inerte, con
//     "Creando…") hasta que se resuelve.
//   - open({ preset = null }): deja el formulario listo para un alta; no abre ningún overlay. Con
//     `preset` ({ course: { id, educationLevel, gradeName, division, shift } }), el nivel educativo
//     y el curso llegan cargados y bloqueados: solo se elige el alumno. Con
//     `preset` ({ student: { id, firstName, lastName, dni } }), el alumno llega cargado y
//     bloqueado: se eligen el nivel educativo y el curso.
//   - focusFirst(): el foco en el primer campo que se puede elegir (Alumno o Nivel educativo) o, si
//     están bloqueados, en Cancelar (al abrir el modal).
//   - closeMenus(): cierra los desplegables y los buscadores (al cerrar el modal).
//   - isSaving: si se está esperando la respuesta (la vista no cierra el modal con Escape).
//   - reloadOptions(): pide los alumnos que se pueden inscribir y los cursos del ciclo lectivo
//     actual; la vista lo llama al cargar. Si no llegan, se vuelven a pedir al abrir el formulario.
//   - invalidateOptions(): las listas quedaron viejas (p. ej., la vista dio de baja una inscripción
//     activa y su alumno vuelve a poder inscribirse): se vuelven a pedir al abrir el formulario.
// Ayudas para la vista, con los mismos textos que el formulario: courseFullName(course) ("1° A,
// Mañana, Primaria", como lo nombran los toasts) y errorDescription(error) (la descripción de un
// toast de error).
// Dependencias (scripts sin defer en <head>, antes que este, y sus .css): dropdown.component.js
// (dropdown.css), searchable-select.component.js (searchable-select.css), field-validation
// (form-field.css; formatDni), modal-dropdown.js (modal-dropdown.css), modal-resize.js,
// modal-focus-trap, text-truncate.component.js, toast.component.js (toast.css); además
// buttons.css y enrollment-form.css.

(() => {
  // Etiquetas de Nivel educativo y de Turno, que llegan como PRIMARY o SECONDARY y MORNING o
  // AFTERNOON: las mismas de las opciones del formulario y de los botones del filtro Curso
  const LEVEL_LABELS = { PRIMARY: 'Primaria', SECONDARY: 'Secundaria' };
  const SHIFT_LABELS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };

  const LEVEL_PLACEHOLDER = 'Seleccionar nivel educativo';
  const COURSE_LOCKED_PLACEHOLDER = 'Selecciona primero un nivel educativo';
  const COURSE_UNLOCKED_PLACEHOLDER = 'Buscar curso';
  const CREATE_TEXT = 'Crear inscripción';
  const CREATING_TEXT = 'Creando…';
  const ERROR_TITLE = 'No se pudo crear la inscripción';

  // Códigos con los que el proceso principal avisa que el alumno o el curso elegidos ya no se pueden
  // elegir (otra sesión los dio de baja, pasó al alumno a egresado o lo inscribió, o cambió el año):
  // las listas del formulario quedaron viejas y se vuelven a pedir la próxima vez que se abra.
  // Mientras tanto, el formulario conserva lo elegido.
  const STUDENT_STALE_CODES = ['STUDENT_NOT_FOUND', 'STUDENT_DELETED', 'STUDENT_NOT_ACTIVE', 'STUDENT_ALREADY_ENROLLED'];
  const COURSE_STALE_CODES = ['COURSE_NOT_FOUND', 'COURSE_DELETED', 'COURSE_OUT_OF_SCHOOL_YEAR'];
  const STALE_OPTION_CODES = [...STUDENT_STALE_CODES, ...COURSE_STALE_CODES];

  // "1° A · Mañana": el nivel educativo ya se eligió en el campo anterior
  const courseName = (course) => `${course.gradeName} ${course.division} · ${SHIFT_LABELS[course.shift] ?? course.shift}`;
  // "1° A, Mañana, Primaria"
  const courseFullName = (course) =>
    `${course.gradeName} ${course.division}, ${SHIFT_LABELS[course.shift] ?? course.shift}, ${LEVEL_LABELS[course.educationLevel] ?? course.educationLevel}`;
  // "Álvarez, Camila"
  const fullName = (student) => `${student.lastName ?? ''}, ${student.firstName ?? ''}`;

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // "Se registró la inscripción INS-000041 de Camila Álvarez en 1° A, Mañana, Primaria."
  const createdDescription = ({ number, student, course }) =>
    `Se registró la inscripción ${number} de ${student.firstName} ${student.lastName} en ${courseFullName(course)}.`;

  const CHEVRON_ICON = `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>`;
  const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>`;

  const MARKUP = `<div class="modal-header">
        <h2 id="newEnrollmentTitle">Nueva inscripción</h2>
        <p>Completa los campos para registrar una nueva inscripción</p>
      </div>

      <div class="modal-body">
        <div class="form-field">
          <label>Alumno</label>
          <div class="field field-searchable dropdown-searchable" data-role="new-enrollment-student-select">
            <div class="searchable-bar">
              <span class="searchable-icon">
                ${SEARCH_ICON}
              </span>
              <input type="text" class="searchable-input" placeholder="Buscar alumno" autocomplete="off" />
              <div class="searchable-value text-truncate"></div>
              <button type="button" class="searchable-chevron" aria-label="Abrir lista de alumnos" aria-expanded="false">
                ${CHEVRON_ICON}
              </button>
            </div>
            <!-- El alumno se identifica por "Apellido, Nombre" y, como dato secundario, por su DNI.
                 Las opciones son los alumnos vigentes y activos de la institución sin una
                 inscripción activa. -->
            <ul class="dropdown-menu dropdown-menu-enrollment" role="listbox" hidden>
              <li class="dropdown-empty" hidden>Sin resultados</li>
            </ul>
          </div>
        </div>

        <div class="form-field">
          <label>Nivel educativo</label>
          <div class="field field-select dropdown" data-filter="new-enrollment-level">
            <button type="button" class="dropdown-toggle" aria-haspopup="listbox" aria-expanded="false">
              <span class="dropdown-label text-truncate placeholder">${LEVEL_PLACEHOLDER}</span>
              ${CHEVRON_ICON}
            </button>
            <ul class="dropdown-menu" role="listbox" hidden>
              <li class="dropdown-option" role="option" data-value="PRIMARY" aria-selected="false">${LEVEL_LABELS.PRIMARY}</li>
              <li class="dropdown-option" role="option" data-value="SECONDARY" aria-selected="false">${LEVEL_LABELS.SECONDARY}</li>
            </ul>
          </div>
        </div>

        <!-- Curso depende del nivel educativo: arranca bloqueado y solo lista los cursos de ese
             nivel. Las opciones son los cursos vigentes de la institución del ciclo lectivo actual. -->
        <div class="form-field">
          <label>Curso</label>
          <div class="field field-searchable dropdown-searchable is-locked" data-role="new-enrollment-course-select">
            <div class="searchable-bar">
              <span class="searchable-icon">
                ${SEARCH_ICON}
              </span>
              <input type="text" class="searchable-input" placeholder="${COURSE_LOCKED_PLACEHOLDER}" autocomplete="off" disabled />
              <div class="searchable-value text-truncate"></div>
              <button type="button" class="searchable-chevron" aria-label="Abrir lista de cursos" aria-expanded="false" disabled>
                ${CHEVRON_ICON}
              </button>
            </div>
            <ul class="dropdown-menu dropdown-menu-course" role="listbox" hidden>
              <li class="dropdown-empty" hidden>Sin resultados</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelNewEnrollmentBtn">Cancelar</button>
        <button type="button" class="btn btn-primary" id="createEnrollmentBtn" disabled>${CREATE_TEXT}</button>
      </div>

      <!-- Plantillas de las opciones: el componente las completa con lo que devuelve el proceso
           principal -->
      <template data-template="student-option">
        <li class="dropdown-option option-enrollment" role="option" aria-selected="false">
          <span class="option-name text-truncate"></span>
          <span class="option-detail text-truncate"></span>
        </li>
      </template>
      <template data-template="course-option">
        <li class="dropdown-option" role="option" aria-selected="false"><span class="option-name text-truncate"></span></li>
      </template>`;

  class EnrollmentForm extends HTMLElement {
    connectedCallback() {
      // Se genera una sola vez: los listeners de setup quedan sobre estos nodos
      if (this.rendered) return;
      this.rendered = true;
      this.innerHTML = MARKUP;
    }

    // ---------- Ayudas para la vista ----------

    courseFullName = courseFullName;
    errorDescription = errorDescription;

    // ---------- Estado ----------

    #isSaving = false;
    // El alta precargada que pidió open(); null si no
    #preset = null;

    get isSaving() {
      return this.#isSaving;
    }

    // Las funciones que arma setup(), que usan los nodos y los listeners del formulario
    #form = null;

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

    invalidateOptions() {
      this.#form.invalidateOptions();
    }

    #cloneTemplate(name) {
      return this.querySelector(`template[data-template="${name}"]`).content.firstElementChild.cloneNode(true);
    }

    // "Álvarez, Camila", con su DNI debajo (48.123.456)
    #createStudentOption(student) {
      const option = this.#cloneTemplate('student-option');
      option.dataset.value = String(student.id);
      option.querySelector('.option-name').textContent = fullName(student);
      option.querySelector('.option-detail').textContent = formatDni(student.dni);
      return option;
    }

    // "1° A · Mañana": data-level filtra la lista por el nivel educativo elegido. Todos son del
    // ciclo lectivo actual, así que no llevan el año.
    #createCourseOption(course) {
      const option = this.#cloneTemplate('course-option');
      option.dataset.value = String(course.id);
      option.dataset.level = course.educationLevel;
      option.querySelector('.option-name').textContent = courseName(course);
      return option;
    }

    // Toda la lógica del formulario, sobre sus nodos. Devuelve las funciones que usa la API.
    #createForm({ closeAllDropdowns, onSaved, onCancel, onStale }) {
      const modal = this.closest('.modal');
      const modalBody = this.querySelector('.modal-body');
      const cancelButton = this.querySelector('#cancelNewEnrollmentBtn');
      const submitButton = this.querySelector('#createEnrollmentBtn');

      const levelDropdown = this.querySelector('[data-filter="new-enrollment-level"]');
      const levelToggle = levelDropdown.querySelector('.dropdown-toggle');
      const levelLabel = levelDropdown.querySelector('.dropdown-label');
      const levelOptions = levelDropdown.querySelectorAll('.dropdown-option');

      // Campos con búsqueda integrada (Alumno y Curso): componente compartido
      // searchable-select.component.js. El valor muestra solo el nombre, reiniciar el campo
      // conserva el filtro por nivel y cambiar de nivel vuelve a filtrar la lista en el momento.
      const searchableOptions = {
        onOpen: closeAllDropdowns,
        valueContent: 'name',
        resetClearsGroupFilter: false,
        filterOnGroupChange: true,
      };
      const studentSelect = setupSearchableSelect(this.querySelector('[data-role="new-enrollment-student-select"]'), searchableOptions);
      const courseSelect = setupSearchableSelect(this.querySelector('[data-role="new-enrollment-course-select"]'), searchableOptions);

      const closeMenus = () => {
        closeAllDropdowns();
        closeAllSearchableMenus();
      };

      // PRIMARY o SECONDARY, o '' si todavía no se eligió
      const selectedLevel = () => levelDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? '';

      const updateSubmitButtonState = () => {
        const hasStudent = Boolean(studentSelect.getValue());
        const hasLevel = Boolean(selectedLevel());
        const hasCourse = Boolean(courseSelect.getValue());
        submitButton.disabled = !(hasStudent && hasLevel && hasCourse);
      };

      // ---------- Alumnos y cursos que se pueden elegir ----------

      // Alumnos y cursos que ofrece el alta, como llegaron del proceso principal; null si no llegaron
      let enrollableStudents = null;
      let enrollableCourses = null;
      let isLoadingFormOptions = false;
      // Llegaron las dos listas y siguen al día: si no, se vuelven a pedir al abrir el formulario
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

      // Alumno queda bloqueado, con el motivo, mientras su lista se carga, si no llegó o si llegó vacía
      const updateStudentField = () => {
        if (isLoadingFormOptions) studentSelect.lock('Cargando alumnos…');
        else if (!enrollableStudents) studentSelect.lock('No se pudieron cargar los alumnos');
        else if (!enrollableStudents.length) studentSelect.lock('No hay alumnos para inscribir');
        else studentSelect.unlock();
      };

      // Curso depende del nivel educativo: sin nivel queda bloqueado a la espera de uno y, con nivel,
      // muestra sus cursos o, si no hay ninguno para elegir, el motivo. Cada cambio de nivel descarta
      // el curso elegido.
      const updateCourseField = () => {
        const level = selectedLevel();
        courseSelect.reset();
        courseSelect.setGroupFilter(level);
        if (!level) courseSelect.lock(COURSE_LOCKED_PLACEHOLDER);
        else if (isLoadingFormOptions) courseSelect.lock('Cargando cursos…');
        else if (!enrollableCourses) courseSelect.lock('No se pudieron cargar los cursos');
        else if (!enrollableCourses.some((course) => course.educationLevel === level)) {
          courseSelect.lock(`No hay cursos de ${LEVEL_LABELS[level] ?? level} en el ciclo lectivo actual`);
        } else courseSelect.unlock(COURSE_UNLOCKED_PLACEHOLDER);
        updateSubmitButtonState();
      };

      // Nivel educativo sin elegir y habilitado
      const resetLevel = () => {
        levelOptions.forEach((option) => {
          option.classList.remove('selected');
          option.setAttribute('aria-selected', 'false');
        });
        levelLabel.textContent = LEVEL_PLACEHOLDER;
        levelLabel.classList.add('placeholder');
        levelDropdown.classList.remove('is-locked');
        levelToggle.disabled = false;
      };

      // Lo que llegó cargado en un alta precargada (preset); null si no
      const presetCourse = () => this.#preset?.course ?? null;
      const presetStudent = () => this.#preset?.student ?? null;

      // En un alta precargada con un curso, el nivel educativo y el curso del preset quedan elegidos
      // y bloqueados con su valor, como el curso y la materia de Asignar en assignment-form. El curso
      // se elige con un clic en su opción, que marca el valor como searchable-select.component.js;
      // si no está entre los del alta (otra sesión lo dio de baja o cambió el año), igual se ofrece
      // (fillCourseOptions) y el proceso principal lo rechaza al guardar.
      const fillPresetCourse = () => {
        const course = presetCourse();
        levelOptions.forEach((option) => {
          const isSelected = option.dataset.value === course.educationLevel;
          option.classList.toggle('selected', isSelected);
          option.setAttribute('aria-selected', String(isSelected));
          if (isSelected) levelLabel.textContent = option.textContent.trim();
        });
        levelLabel.classList.remove('placeholder');
        levelDropdown.classList.add('is-locked');
        levelToggle.disabled = true;
        courseSelect.reset();
        courseSelect.setGroupFilter(course.educationLevel);
        if (isLoadingFormOptions) {
          courseSelect.lock('Cargando cursos…');
        } else {
          courseSelect.root.querySelector(`.dropdown-option[data-value="${course.id}"]`)?.click();
          // Sin la lista de cursos no hay opción que elegir
          courseSelect.lock(courseSelect.getValue() ? undefined : 'No se pudieron cargar los cursos');
        }
        updateSubmitButtonState();
      };

      // En un alta precargada con un alumno, el alumno del preset queda elegido y bloqueado con su
      // valor, como el curso en fillPresetCourse; el nivel educativo y el curso se eligen. Si no está
      // entre los que se pueden inscribir (otra sesión lo inscribió, lo pasó a egresado o lo dio de
      // baja), igual se ofrece (fillStudentOptions) y el proceso principal lo rechaza al guardar.
      const fillPresetStudent = () => {
        const student = presetStudent();
        if (!student) return;
        if (isLoadingFormOptions) {
          studentSelect.lock('Cargando alumnos…');
        } else {
          studentSelect.root.querySelector(`.dropdown-option[data-value="${student.id}"]`)?.click();
          // Sin la lista de alumnos no hay opción que elegir
          studentSelect.lock(studentSelect.getValue() ? undefined : 'No se pudieron cargar los alumnos');
        }
        updateSubmitButtonState();
      };

      // Curso según el preset (o, sin un curso precargado, según el nivel educativo elegido) y el
      // alumno precargado, si llegó
      const fillPreset = () => {
        if (presetCourse()) fillPresetCourse();
        else updateCourseField();
        fillPresetStudent();
      };

      const resetForm = () => {
        studentSelect.reset();
        updateStudentField();
        resetLevel();
        fillPreset();
      };

      // `options` y, en un alta precargada, también `presetOption` si no estaba entre ellas
      const withPresetOption = (options, presetOption) =>
        (options && presetOption && !options.some(({ id }) => id === presetOption.id) ? [...options, presetOption] : options);

      // Las opciones de Curso: las del alta y, en uno precargado, también su curso si no estaba
      const fillCourseOptions = () => {
        const courses = withPresetOption(enrollableCourses, presetCourse());
        courseSelect.setOptions((courses ?? []).map((course) => this.#createCourseOption(course)));
      };

      // Las opciones de Alumno: las del alta y, en uno precargado, también su alumno si no estaba
      const fillStudentOptions = () => {
        const students = withPresetOption(enrollableStudents, presetStudent());
        studentSelect.setOptions((students ?? []).map((student) => this.#createStudentOption(student)));
      };

      // El formulario está a la vista: su overlay está abierto y no es un paso oculto
      const isShown = () => Boolean(this.closest('.modal-overlay')?.classList.contains('is-open')) && !this.hidden;

      // Pide los alumnos que se pueden inscribir y los cursos del ciclo lectivo actual: las opciones
      // de Alumno y de Curso. Se piden al cargar la vista y se vuelven a pedir al abrir el
      // formulario si no llegaron o si quedaron viejas (invalidateOptions, un alta o un código de
      // STALE_OPTION_CODES). Mientras se espera, Alumno y Curso quedan bloqueados; el nivel educativo
      // elegido se conserva y, en un alta precargada, el curso o el alumno quedan elegidos al llegar.
      const loadFormOptions = async () => {
        if (isLoadingFormOptions) return;
        isLoadingFormOptions = true;
        hasFormOptions = false;
        updateStudentField();
        fillPreset();
        [enrollableStudents, enrollableCourses] = await Promise.all([
          requestOptions(() => window.api?.enrollments?.listEnrollableStudents(), 'students'),
          requestOptions(() => window.api?.enrollments?.listEnrollableCourses(), 'courses'),
        ]);
        isLoadingFormOptions = false;
        hasFormOptions = Boolean(enrollableStudents && enrollableCourses);
        fillStudentOptions();
        fillCourseOptions();
        updateStudentField();
        if (isShown()) fillPreset();
        else updateCourseField();
      };

      // ---------- Formulario ----------

      studentSelect.onSelect(updateSubmitButtonState);
      courseSelect.onSelect(updateSubmitButtonState);

      // dropdown.component.js ya marcó el nivel elegido
      levelDropdown.addEventListener('dropdown-change', updateCourseField);

      // Mientras se espera la respuesta, el cuerpo del formulario queda inerte, así lo enviado
      // coincide con lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled:
      // conservan el foco, como en confirm-modal.component.js.
      const setSaving = (saving) => {
        this.#isSaving = saving;
        modalBody.inert = saving;
        modal?.setAttribute('aria-busy', String(saving));
        [cancelButton, submitButton].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
        submitButton.textContent = saving ? CREATING_TEXT : CREATE_TEXT;
      };

      const open = ({ preset = null } = {}) => {
        const hadPreset = Boolean(this.#preset);
        this.#preset = preset;
        // Las opciones de Alumno y de Curso dependen de lo precargado
        if (hasFormOptions && (preset || hadPreset)) {
          fillStudentOptions();
          fillCourseOptions();
        }
        resetForm();
        closeMenus();
        // Las listas no llegaron al cargar la vista, cambiaron con un alta o una baja o quedaron
        // viejas: se vuelven a pedir
        if (!hasFormOptions) loadFormOptions();
      };

      // El primer campo que se puede elegir (Alumno o Nivel educativo) o, si están bloqueados,
      // Cancelar
      const focusFirst = () => {
        const studentChevron = studentSelect.root.querySelector('.searchable-chevron');
        ([studentChevron, levelToggle].find((control) => !control.disabled) ?? cancelButton).focus();
      };

      // Crea la inscripción con lo elegido; el proceso principal vuelve a validar todo antes de
      // guardarla. Si la crea, se espera onSaved (la vista actualiza su tabla antes de liberar el
      // modal, así al cerrarse ya la muestra) y un toast lo avisa. Si no, el toast dice por qué y el
      // formulario sigue abierto con lo elegido; si lo que llegó cargado en un alta precargada (el
      // curso o el alumno) ya no se puede elegir, antes se espera onStale.
      const saveEnrollment = async () => {
        const data = {
          studentId: Number(studentSelect.getValue()),
          educationLevel: selectedLevel(),
          courseId: Number(courseSelect.getValue()),
        };
        setSaving(true);
        let response;
        try {
          response = await window.api?.enrollments?.create(data);
        } catch (error) {
          console.error('Error al crear la inscripción:', error);
        }

        if (response?.ok) {
          // El alumno inscripto ya no se puede elegir: las listas se vuelven a pedir al reabrir
          hasFormOptions = false;
          const note = await onSaved?.(response.enrollment);
          setSaving(false);
          const description = createdDescription(response.enrollment);
          showToast({
            type: 'success',
            title: 'Inscripción creada',
            description: typeof note === 'string' && note ? `${description} ${note}` : description,
          });
          return;
        }
        const error = response?.error;
        if (STALE_OPTION_CODES.includes(error?.code)) hasFormOptions = false;
        const isPresetStale = (presetCourse() && COURSE_STALE_CODES.includes(error?.code))
          || (presetStudent() && STUDENT_STALE_CODES.includes(error?.code));
        if (isPresetStale) await onStale?.(error.code);
        setSaving(false);
        showToast({ type: 'error', title: ERROR_TITLE, description: errorDescription(error) });
      };

      cancelButton.addEventListener('click', () => {
        if (!this.#isSaving) onCancel?.();
      });

      submitButton.addEventListener('click', () => {
        if (this.#isSaving) return;
        saveEnrollment();
      });

      return {
        open,
        focusFirst,
        closeMenus,
        loadFormOptions,
        invalidateOptions: () => {
          hasFormOptions = false;
        },
      };
    }
  }

  customElements.define('enrollment-form', EnrollmentForm);
})();
