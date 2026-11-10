// Reporte Alumnos activos sin inscripción (Secretario), abierto desde Reportes. Responde qué alumnos
// vigentes y activos siguen en la institución y todavía no tienen una inscripción vigente y activa
// en un curso del ciclo lectivo actual (window.api.reports.getStudentsWithoutEnrollment), por
// apellido y nombre (el orden llega del proceso principal). Cada fila muestra además la última
// inscripción vigente del alumno, de cualquier ciclo lectivo, y su estado; un alumno que nunca tuvo
// una muestra un guion.
// Los filtros se aplican en memoria sobre la lista completa: Alumno busca por apellido, nombre o
// DNI; Curso (<course-filter>, el de Inscripciones: grado y nivel educativo, división y turno) mira
// el curso de la última inscripción, de cualquier ciclo, así que mientras filtra no aparecen los
// alumnos sin inscripciones. Con cada cambio, la tabla vuelve a la página 1; se pagina en memoria,
// 10 por página, con <table-pagination>.
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
  const courseFilter = filterBar.querySelector('course-filter');
  const enrollmentOverlay = document.getElementById('newEnrollmentOverlay');
  const enrollmentForm = enrollmentOverlay.querySelector('enrollment-form');
  const studentOverlay = document.getElementById('editStudentOverlay');
  const studentForm = studentOverlay.querySelector('student-form');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  const NO_STUDENTS_MESSAGE = 'Todos los alumnos activos tienen una inscripción activa en el ciclo lectivo actual.';
  const EMPTY_MESSAGE = 'Ningún alumno coincide con los filtros.';
  const ALL_LABEL = 'Todos';
  const NO_ENROLLMENT_TEXT = '—';

  // Los mismos textos de Estado de una inscripción que Inscripciones
  const ENROLLMENT_STATUS_LABELS = { ACTIVE: 'Activa', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada' };

  // El valor vigente que muestra el botón de cada filtro (report-filters.css)
  const filterValue = (filter) => filterBar.querySelector(`[data-filter="${filter}"] .report-filter-value`);

  // Los alumnos del último reporte recibido, en el orden en que llegan del proceso principal
  let students = [];
  let isLoaded = false;
  // Cada pedido lleva un número: si llega la respuesta de uno anterior al último, se descarta
  let requestNumber = 0;

  // Lo que filtra cada filtro de la barra: el texto de Alumno ('' = todos) y, del filtro Curso, los
  // grados (gradeKey), las divisiones y los turnos (vacíos = todos)
  const activeFilters = { text: '', grades: [], divisions: [], shifts: [] };

  // "Álvarez, Camila"
  const fullName = (student) => `${student.lastName ?? ''}, ${student.firstName ?? ''}`;
  // Un grado se repite entre niveles educativos (hay un 1° de primaria y otro de secundaria): se lo
  // identifica con los dos datos
  const gradeKey = (level, name) => `${level}:${name}`;

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

  // Curso mira el curso de la última inscripción: sin ella, el alumno no pasa el filtro. Grado,
  // división y turno se combinan con Y; uno vacío no descarta nada, y con los dos turnos activos
  // pasan todos, igual que sin ninguno.
  const matchesCourse = (student) => {
    const { grades, divisions, shifts } = activeFilters;
    if (!grades.length && !divisions.length && !shifts.length) return true;
    const lastCourse = student.lastEnrollment?.course;
    if (!lastCourse) return false;
    return (!grades.length || grades.includes(gradeKey(lastCourse.educationLevel, lastCourse.gradeName)))
      && (!divisions.length || divisions.includes(lastCourse.division))
      && (!shifts.length || shifts.includes(lastCourse.shift));
  };

  const matchesFilters = (student) => matchesText(student) && matchesCourse(student);

  // "Alumno · gar", "Curso · 1° Primaria, División A" (course-filter-text.component.js)
  const renderFilterValues = () => {
    filterValue('student').textContent = activeFilters.text.trim() || ALL_LABEL;
    filterValue('course').textContent = courseFilterText(courseFilter);
  };

  // Lo que fija cada filtro de la barra, por su data-filter, después de un cambio: Alumno, con el
  // detalle de column-filter-change; Curso, con lo que da su componente
  const FILTER_VALUES = {
    student: ({ text }) => ({ text }),
    course: () => ({
      grades: courseFilter.selectedGrades.map(({ level, name }) => gradeKey(level, name)),
      divisions: courseFilter.selectedDivisions,
      shifts: courseFilter.selectedShifts,
    }),
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
    row.cells[2].textContent = lastEnrollment
      ? courseLabel(lastEnrollment.course, { level: true, schoolYear: true })
      : NO_ENROLLMENT_TEXT;
    // El estado, como texto plano igual que las demás celdas (sin chip), para que no compita con las
    // acciones de la fila
    row.cells[3].textContent = lastEnrollment
      ? ENROLLMENT_STATUS_LABELS[lastEnrollment.status] ?? lastEnrollment.status
      : NO_ENROLLMENT_TEXT;
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
    renderRows(keepPage ? {} : { page: 1 });
  }

  // Cada filtro de la barra avisa sus cambios (column-filter.js). Si lo que filtra no cambió (Curso
  // avisa cada clic y cada tecla dentro de su panel), la tabla queda como está. Mientras carga o si
  // la carga falló, se guardan los valores sin reemplazar el mensaje de la tabla.
  filterBar.addEventListener('column-filter-change', (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(activeFilters[key]));
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
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
