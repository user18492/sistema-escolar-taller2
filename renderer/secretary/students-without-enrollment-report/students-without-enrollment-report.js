// Reporte Alumnos activos sin inscripción (Secretario), abierto desde Reportes. Responde qué alumnos
// vigentes y activos siguen en la institución y todavía no tienen una inscripción vigente y activa
// en un curso del ciclo lectivo actual (window.api.reports.getStudentsWithoutEnrollment), por
// apellido y nombre (el orden llega del proceso principal). Cada fila muestra además la última
// inscripción vigente del alumno, de cualquier ciclo lectivo, y su estado; un alumno que nunca tuvo
// una muestra un guion.
// Los filtros se aplican en memoria sobre la lista completa, porque las opciones de Curso salen de
// las últimas inscripciones de todos los alumnos del reporte: Alumno busca por apellido, nombre o
// DNI; Nivel y Curso miran la última inscripción, así que mientras alguno filtra no aparecen los
// alumnos sin inscripciones. Curso ofrece cada combinación de grado, división, turno y nivel (de
// cualquier ciclo) y, con un nivel elegido, solo las de ese nivel. Con cada cambio, la tabla vuelve a
// la página 1; se pagina en memoria, 10 por página, con <table-pagination>.
// Cada fila lleva tres acciones, que abren sobre el reporte los mismos formularios de Inscripciones
// y de Alumnos:
//   - Inscribir: "Nueva inscripción" (<enrollment-form>) con el alumno cargado y bloqueado; se eligen
//     el nivel educativo y un curso del ciclo actual.
//   - Editar: "Editar alumno" (<student-form>) con sus datos, p. ej. para pasarlo a egresado.
//   - Dar de baja: la confirmación "Eliminar alumno" de Alumnos (confirm-modal.component.js), que
//     pide la baja con student-delete.component.js.
// Los formularios van en el modal de los reportes, sin listado (setupListModal,
// list-modal.component.js): Cancelar, la X y Escape lo cierran sin cambios. Cada formulario y la
// baja guardan y avisan con sus toasts. Al confirmar, el reporte se vuelve a pedir con los mismos
// filtros y en la misma página (acotada a la última): el alumno inscripto, egresado o dado de baja
// deja de aparecer y el que solo cambió otros datos sigue, con los datos nuevos. Si la fila ya no
// está, el foco pasa a la misma acción de la fila que quedó en su lugar.

document.addEventListener('DOMContentLoaded', () => {
  // Apertura, cierre y selección de los desplegables de los formularios (dropdown.component.js).
  // Abrir uno, hacer clic fuera de los buscadores o pulsar Escape cierra también los buscadores
  // (searchable-select.component.js).
  const { closeAllDropdowns } = setupDropdowns({
    onToggle: closeAllSearchableMenus,
    onDismiss: dismissSearchableMenus,
  });

  const filterBar = document.querySelector('.report-filters');
  const card = document.querySelector('.students-without-enrollment-card');
  const table = card.querySelector('.data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('studentRowTemplate');
  // Los scripts de los componentes se cargan sin defer en <head>: acá ya están definidos y
  // conectados
  const pagination = card.querySelector('table-pagination');
  const courseFilterRoot = filterBar.querySelector('[data-filter="course"]');
  const enrollmentOverlay = document.getElementById('newEnrollmentOverlay');
  const enrollmentForm = enrollmentOverlay.querySelector('enrollment-form');
  const studentOverlay = document.getElementById('editStudentOverlay');
  const studentForm = studentOverlay.querySelector('student-form');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  const NO_STUDENTS_MESSAGE = 'Todos los alumnos activos tienen una inscripción activa en el ciclo lectivo actual.';
  const EMPTY_MESSAGE = 'Ningún alumno coincide con los filtros.';
  const ALL_LABEL = 'Todos';
  const NO_ENROLLMENT_TEXT = '—';

  // Textos de Nivel tomados de las opciones de su filtro, para que la celda y el filtro digan lo
  // mismo. Llegan como PRIMARY o SECONDARY.
  const levelLabels = Object.fromEntries(
    Array.from(filterBar.querySelectorAll('#levelFilter .dropdown-option[data-value]:not([data-value=""])'),
      (option) => [option.dataset.value, option.textContent.trim()])
  );
  // Los mismos textos de Turno y de Estado de una inscripción que Inscripciones
  const SHIFT_LABELS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
  const SHIFT_ORDER = ['MORNING', 'AFTERNOON'];
  const ENROLLMENT_STATUS_LABELS = { ACTIVE: 'Activa', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada' };

  // El valor vigente que muestra el botón de cada filtro (report-filters.css)
  const filterValue = (filter) => filterBar.querySelector(`[data-filter="${filter}"] .report-filter-value`);

  // Los alumnos del último reporte recibido, en el orden en que llegan del proceso principal
  let students = [];
  let isLoaded = false;
  // Cada pedido lleva un número: si llega la respuesta de uno anterior al último, se descarta
  let requestNumber = 0;

  // Lo que filtra cada filtro de la barra: el texto de Alumno ('' = todos), el nivel educativo
  // (null = todos) y la clave de un curso (courseKey; null = todos)
  const activeFilters = { text: '', educationLevel: null, course: null };

  // "Álvarez, Camila"
  const fullName = (student) => `${student.lastName ?? ''}, ${student.firstName ?? ''}`;
  const levelLabel = (level) => levelLabels[level] ?? level;
  // "6° B · Mañana": el grado, la división y el turno de un curso
  const courseName = (course) => `${course.gradeName} ${course.division} · ${SHIFT_LABELS[course.shift] ?? course.shift}`;
  // "6° B · Mañana · Secundaria": el curso en Curso, sin el ciclo lectivo
  const courseWithLevel = (course) => `${courseName(course)} · ${levelLabel(course.educationLevel)}`;
  // "6° B · Mañana · Secundaria · 2025": la última inscripción
  const courseWithSchoolYear = (course) => `${courseWithLevel(course)} · ${course.schoolYear}`;
  // Identifica una combinación de nivel, grado, división y turno, de cualquier ciclo lectivo: los
  // cursos con el mismo nombre en Primaria y en Secundaria son distintos
  const courseKey = (course) => [course.educationLevel, course.gradeName, course.division, course.shift].join('|');

  // ---------- Filtros ----------

  // Sin acentos y en minúscula, para que "alvarez" encuentre a "Álvarez"
  const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');

  // Alumno: con solo dígitos (y los puntos de un DNI escrito como 48.123.456), busca en el DNI; si
  // no, en "Apellido, Nombre" y en "Nombre Apellido"
  const matchesText = (student) => {
    const text = activeFilters.text.trim();
    if (!text) return true;
    if (/^[\d.\s]+$/.test(text)) return (student.dni ?? '').includes(text.replace(/\D/g, ''));
    const query = normalize(text);
    return [fullName(student), `${student.firstName ?? ''} ${student.lastName ?? ''}`]
      .some((name) => normalize(name).includes(query));
  };

  // Nivel y Curso miran la última inscripción: sin ella, el alumno no pasa ninguno de los dos
  const matchesFilters = (student) => {
    if (!matchesText(student)) return false;
    const { educationLevel, course } = activeFilters;
    if (!educationLevel && !course) return true;
    const lastCourse = student.lastEnrollment?.course;
    if (!lastCourse) return false;
    return (!educationLevel || lastCourse.educationLevel === educationLevel)
      && (!course || courseKey(lastCourse) === course);
  };

  // Los cursos de las últimas inscripciones de todos los alumnos del reporte, sin repetir, por nivel
  // educativo, grado, división y turno
  const reportCourses = () => {
    const byKey = new Map();
    students.forEach(({ lastEnrollment }) => {
      if (lastEnrollment) byKey.set(courseKey(lastEnrollment.course), lastEnrollment.course);
    });
    return Array.from(byKey.values()).sort((a, b) =>
      a.educationLevel.localeCompare(b.educationLevel)
      || a.gradeName.localeCompare(b.gradeName, 'es', { numeric: true })
      || a.division.localeCompare(b.division)
      || SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift));
  };

  const createCourseOption = (course) => {
    const option = document.createElement('li');
    option.className = 'dropdown-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.value = courseKey(course);
    option.textContent = courseWithLevel(course);
    return option;
  };

  // Las opciones de Curso: los cursos del reporte del nivel elegido (o de los dos). El curso elegido
  // sigue elegido si todavía está entre ellas; si no (otro nivel, o ya ningún alumno lo tiene como
  // última inscripción), deja de filtrar.
  const fillCourseOptions = () => {
    const courses = reportCourses().filter((course) => !activeFilters.educationLevel || course.educationLevel === activeFilters.educationLevel);
    const kept = replaceColumnFilterOptions(courseFilterRoot, courses.map(createCourseOption), activeFilters.course ? [activeFilters.course] : []);
    activeFilters.course = kept[0] ?? null;
  };

  // "Alumno · gar", "Nivel · Primaria", "Curso · 1° A · Tarde · Primaria"
  const renderFilterValues = () => {
    filterValue('student').textContent = activeFilters.text.trim() || ALL_LABEL;
    filterValue('level').textContent = activeFilters.educationLevel ? levelLabel(activeFilters.educationLevel) : ALL_LABEL;
    const selectedCourse = courseFilterRoot.querySelector('.dropdown-option.selected[data-value]:not([data-value=""])');
    filterValue('course').textContent = activeFilters.course && selectedCourse ? selectedCourse.textContent.trim() : ALL_LABEL;
  };

  // Lo que fija cada filtro de la barra, por su data-filter, con el detalle de column-filter-change
  const FILTER_VALUES = {
    student: ({ text }) => ({ text }),
    level: ({ values }) => ({ educationLevel: values[0] ?? null }),
    course: ({ values }) => ({ course: values[0] ?? null }),
  };

  // ---------- Tabla ----------

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
  // alumno_id en data-student-id; las acciones toman de ahí al alumno del reporte.
  const createRow = (student) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.studentId = String(student.id);
    row.cells[0].querySelector('.text-truncate').textContent = fullName(student);
    row.cells[1].textContent = formatDni(student.dni ?? '');
    const { lastEnrollment } = student;
    row.cells[2].textContent = lastEnrollment ? courseWithSchoolYear(lastEnrollment.course) : NO_ENROLLMENT_TEXT;
    if (lastEnrollment) {
      // <status-badge> lee sus atributos al conectarse: se fijan antes de insertar la fila
      const badge = document.createElement('status-badge');
      badge.setAttribute('status', lastEnrollment.status.toLowerCase());
      badge.setAttribute('label', ENROLLMENT_STATUS_LABELS[lastEnrollment.status] ?? lastEnrollment.status);
      row.cells[3].append(badge);
    } else {
      row.cells[3].textContent = NO_ENROLLMENT_TEXT;
    }
    // "Inscribir a Álvarez, Camila", "Editar a…", "Dar de baja a…"
    row.querySelectorAll('[data-action]').forEach((button) => {
      button.setAttribute('aria-label', `${button.textContent.trim()} a ${fullName(student)}`);
    });
    return row;
  };

  // Muestra la página `page` (por defecto, la actual) de los alumnos que pasan los filtros (10 por
  // página, en memoria); el componente la acota a la última que quede.
  const renderRows = ({ page } = {}) => {
    const visibleStudents = students.filter(matchesFilters);
    const pageStudents = pagination.slice(visibleStudents, { page });
    if (pageStudents.length) tbody.replaceChildren(...pageStudents.map(createRow));
    else showMessage(students.length ? EMPTY_MESSAGE : NO_STUDENTS_MESSAGE);
  };

  // Pide el reporte y lo muestra desde la página 1 o, con `keepPage` (después de una acción), en la
  // página actual, acotada a la última, con los mismos filtros. Si en el medio llega otro pedido, la
  // respuesta de este se descarta. Mientras se espera, la tabla conserva lo que muestra y las filas
  // nuevas la reemplazan de una vez al llegar; el "Cargando reporte…" queda solo para la primera
  // carga.
  async function loadReport({ keepPage = false } = {}) {
    const number = ++requestNumber;
    table.setAttribute('aria-busy', 'true');
    let response;
    try {
      response = await window.api?.reports?.getStudentsWithoutEnrollment();
    } catch (error) {
      console.error('Error al cargar el reporte:', error);
    }
    if (number !== requestNumber) return;
    table.setAttribute('aria-busy', 'false');
    if (!response?.ok) {
      isLoaded = false;
      students = [];
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    students = response.report.students;
    isLoaded = true;
    fillCourseOptions();
    renderFilterValues();
    renderRows(keepPage ? {} : { page: 1 });
  }

  // Cada filtro de la barra avisa sus cambios (column-filter.js). Un nivel nuevo cambia también las
  // opciones de Curso. Mientras carga o si la carga falló, se guardan los valores sin reemplazar el
  // mensaje de la tabla.
  filterBar.addEventListener('column-filter-change', (event) => {
    const filter = event.target.dataset.filter;
    const values = FILTER_VALUES[filter](event.detail);
    const hasChanged = Object.entries(values).some(([key, value]) => value !== activeFilters[key]);
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    if (filter === 'level') fillCourseOptions();
    renderFilterValues();
    if (isLoaded) renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  // ---------- Acciones ----------

  // El alumno del reporte de la fila del botón
  const studentOf = (button) => {
    const id = button?.closest('tr')?.dataset.studentId;
    return students.find((student) => String(student.id) === id) ?? null;
  };

  // Posición en la página de la fila de la última acción, para dejar el foco en la que ocupe su lugar
  // si esa fila ya no se muestra (el alumno se inscribió, egresó o se dio de baja)
  let actionRowIndex = 0;

  // Al cerrar un modal, si la tabla se volvió a dibujar: la misma acción en la fila del mismo alumno
  // o, si ya no está, en la que quedó en su lugar; si no queda ninguna fila, el filtro Alumno
  const focusAfterAction = (action, studentId) => {
    const sameRow = studentId ? tbody.querySelector(`tr[data-student-id="${studentId}"] [data-action="${action}"]`) : null;
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return sameRow
      ?? buttons[Math.min(actionRowIndex, buttons.length - 1)]
      ?? filterBar.querySelector('[data-filter="student"] .column-filter-toggle');
  };

  const focusAfterClose = (trigger) =>
    focusAfterAction(trigger?.dataset.action, trigger?.closest('tr')?.dataset.studentId);

  const enrollmentModal = setupListModal(enrollmentOverlay, { form: enrollmentForm, focusAfterClose });
  const studentModal = setupListModal(studentOverlay, { form: studentForm, focusAfterClose });

  // Después de guardar, o si lo que se mostraba quedó viejo: el reporte se vuelve a pedir en la misma
  // página y con los mismos filtros, y el modal se cierra. Las listas del formulario de inscripción
  // (los alumnos que se pueden inscribir) se vuelven a pedir al abrirlo.
  const refreshAfterChange = async (modal) => {
    enrollmentForm.invalidateOptions();
    await loadReport({ keepPage: true });
    modal?.close();
  };

  enrollmentForm.setup({
    closeAllDropdowns,
    onSaved: () => refreshAfterChange(enrollmentModal),
    onCancel: enrollmentModal.cancelForm,
    onStale: () => refreshAfterChange(enrollmentModal),
  });

  studentForm.setup({
    closeAllDropdowns,
    onSaved: () => refreshAfterChange(studentModal),
    onCancel: studentModal.cancelForm,
    onStale: () => refreshAfterChange(studentModal),
  });

  // Dar de baja: la baja y sus toasts los resuelve student-delete.component.js; la promesa no
  // resuelve ningún mensaje, así el modal se cierra siempre. Si el alumno ya no estaba vigente, el
  // reporte también se vuelve a pedir.
  setupConfirmModal(document.getElementById('deleteStudentOverlay'), {
    beforeOpen: closeAllDropdowns,
    onConfirm: (trigger) => {
      const student = studentOf(trigger);
      if (!student) return refreshAfterChange();
      return deleteStudent(student, {
        onDeleted: () => refreshAfterChange(),
        onGone: () => refreshAfterChange(),
      });
    },
    fallbackFocus: () => focusAfterAction('delete'),
  });

  // Inscribir y Editar, por delegación: las filas se generan al cargar, al filtrar y al cambiar de
  // página. Dar de baja lo abre confirm-modal.component.js; acá solo se toma la posición de la fila.
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    actionRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(button.closest('tr')));
    const student = studentOf(button);
    if (!student) return;
    if (button.dataset.action === 'enroll') enrollmentModal.openForm(button, { preset: { student } });
    else if (button.dataset.action === 'edit') studentModal.openForm(button, { student });
  });

  // Los alumnos que se pueden inscribir y los cursos del ciclo lectivo actual que ofrece el
  // formulario de inscripción
  enrollmentForm.reloadOptions();

  showMessage('Cargando reporte…');
  renderFilterValues();
  loadReport();
});
