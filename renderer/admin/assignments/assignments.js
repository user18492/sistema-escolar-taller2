// Vista Docencia del Administrador: la tabla muestra las asignaciones docentes vigentes de la
// institución, que llegan del proceso principal (window.api.teacherAssignments.list) de todos los
// ciclos lectivos, y los filtros de columna las filtran en memoria. Muestra un solo ciclo
// (shownSchoolYear, school-year.js): por defecto el actual, con el filtro Ciclo lectivo sin aplicar,
// o el año elegido en ese filtro. Las opciones de los filtros Profesor y Materia son los profesores
// y las materias de las asignaciones de ese ciclo, y se rearman al cambiarlo. La lista filtrada se
// pagina en memoria, 10 por página, con <table-pagination>.
// La foto de perfil de cada profesor se muestra con fillAvatar (user-avatar.component.js).
// Nueva asignación y Editar abren el modal con el formulario compartido <assignment-form>
// (assignment-form.component.js), que resuelve las opciones, el guardado y sus toasts: el alta,
// para un curso del ciclo lectivo del año en curso, y la edición del profesor, el curso y la
// materia; en una asignación con evaluaciones vigentes (hasEvaluations), solo el profesor. La vista
// abre y cierra el modal y, con lo guardado, actualiza la tabla.
// Eliminar la da de baja (baja lógica, window.api.teacherAssignments.delete) después de confirmarlo
// en un modal (confirm-modal.component.js) y también lo avisa con un toast: su materia vuelve a
// ofrecerse en ese curso. Una asignación con evaluaciones no se da de baja: Eliminar queda
// deshabilitado, con el motivo como title.
// El ciclo lectivo actual llega con la lista, de la base (school-year.js): las asignaciones de un
// ciclo cerrado se ven en solo lectura, con Editar y Eliminar deshabilitados.

document.addEventListener('DOMContentLoaded', () => {

  // Apertura, cierre y selección de los dropdowns: componente compartido dropdown.component.js,
  // también los del formulario (su marcado ya existe). También guarda en data-placeholder el texto
  // inicial de las etiquetas con .placeholder, que usa el reinicio del formulario. Abrir un
  // dropdown, hacer clic fuera de los buscadores o pulsar Escape cierra también los buscadores
  // (searchable-select.component.js).
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
  // Los scripts de los componentes se cargan sin defer en <head>: acá ya están definidos y
  // conectados
  const pagination = document.querySelector('.assignments-card table-pagination');
  // Formulario de Nueva asignación / Editar asignación; también da las opciones de los filtros
  // Profesor y Materia y los textos de curso, nivel educativo y materia de la tabla y los toasts
  const form = document.querySelector('#newAssignmentOverlay assignment-form');
  const teacherHeader = table.querySelector('th[data-filter="teacher"]');
  const subjectHeader = table.querySelector('th[data-filter="subject"]');
  // Curso: el componente del panel guarda los grados, las divisiones y los turnos elegidos
  // (course-filter.js)
  const courseFilter = table.querySelector('th[data-filter="course"] course-filter');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar las asignaciones docentes. Intentá nuevamente.';

  // En el orden en que llegan del proceso principal
  let assignments = [];
  let isLoaded = false;
  // El ciclo lectivo actual ({ year, today }), que llega con la lista: null hasta entonces
  let currentSchoolYear = null;

  // Un grado se repite entre niveles educativos (hay un 1° de primaria y otro de secundaria): se lo
  // identifica con los dos datos
  const gradeKey = (level, name) => `${level}:${name}`;

  // Lo que filtra cada dato de la asignación: el profesor elegido y las materias marcadas (por su
  // id), el año completo y, del curso, los grados marcados, las divisiones escritas y los turnos
  // activos. Vacío (nada elegido, "Todas" o sin texto) no filtra, salvo el año, que vacío muestra el
  // ciclo actual.
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

  // Si la asignación pasa cada filtro con ese valor, que no está vacío (el del año, también vacío:
  // entonces es el del ciclo actual). Con los dos turnos activos pasan todas, igual que sin ninguno.
  const FILTER_MATCHERS = {
    teacher: ({ teacher }, ids) => ids.includes(String(teacher.id)),
    grade: ({ course }, grades) => grades.includes(gradeKey(course.educationLevel, course.gradeName)),
    division: ({ course }, divisions) => divisions.includes(course.division),
    shift: ({ course }, shifts) => shifts.includes(course.shift),
    subject: ({ subject }, ids) => ids.includes(String(subject.id)),
    year: ({ course }, year) => course.schoolYear === shownSchoolYear(year, currentSchoolYear),
  };

  // Entre sí se combinan con Y; un filtro vacío no descarta nada, salvo el año, que siempre deja
  // solo las asignaciones del ciclo que se muestra
  const matchesFilters = (assignment) =>
    Object.entries(activeFilters).every(([filter, value]) =>
      (value.length === 0 && filter !== 'year') || FILTER_MATCHERS[filter](assignment, value));

  // Sin resultados: si no hay ningún filtro aplicado, el ciclo actual no tiene asignaciones
  const emptyMessage = () => (Object.values(activeFilters).some((value) => value.length > 0)
    ? 'Ninguna asignación coincide con los filtros.'
    : `No hay asignaciones docentes del ciclo lectivo ${currentSchoolYear.year}.`);

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Motivo de Eliminar deshabilitado en una asignación con evaluaciones vigentes
  const HAS_EVALUATIONS_TITLE = 'No se puede eliminar: la asignación tiene evaluaciones.';

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // asignacion_docente_id en data-assignment-id. La de una asignación de un ciclo cerrado lleva
  // Editar y Eliminar deshabilitados, y la de una con evaluaciones, solo Eliminar, con el motivo como
  // title; <row-actions> lo lee al conectarse.
  const createRow = ({ id, teacher, course, subject, hasEvaluations }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.assignmentId = String(id);
    fillAvatar(row.querySelector('.avatar-circle'), teacher);
    row.querySelector('.teacher-name').textContent = `${teacher.firstName} ${teacher.lastName}`;
    row.querySelector('.teacher-email').textContent = teacher.email;
    // "1° A · Mañana" y "Primaria", como los dice el formulario
    const texts = [
      form.courseName(course),
      form.levelLabel(course.educationLevel),
      subject.name,
      course.schoolYear,
    ];
    // La primera celda es la del profesor
    texts.forEach((text, index) => {
      row.cells[index + 1].textContent = text ?? '';
    });
    const rowActions = row.querySelector('row-actions');
    if (course.schoolYear < currentSchoolYear.year) {
      rowActions.setAttribute('read-only-title', closedSchoolYearTitle(course.schoolYear));
    } else if (hasEvaluations) {
      rowActions.setAttribute('delete-disabled-title', HAS_EVALUATIONS_TITLE);
    }
    return row;
  };

  // Los profesores o las materias de las asignaciones cargadas, una vez cada uno
  const uniqueById = (items) => [...new Map(items.map((item) => [item.id, item])).values()];

  const nameCollator = new Intl.Collator('es');
  const compareTeachers = (a, b) =>
    nameCollator.compare(a.lastName, b.lastName) || nameCollator.compare(a.firstName, b.firstName) || a.id - b.id;
  const compareSubjects = (a, b) => nameCollator.compare(a.name, b.name) || a.id - b.id;

  // Los profesores (por apellido y nombre) y las materias (por nombre) que tienen alguna asignación
  // del ciclo que se muestra en la lista cargada: las opciones de sus filtros
  const shownAssignments = () => assignments.filter((assignment) => FILTER_MATCHERS.year(assignment, activeFilters.year));
  const listedTeachers = () => uniqueById(shownAssignments().map(({ teacher }) => teacher)).sort(compareTeachers);
  const listedSubjects = () => uniqueById(shownAssignments().map(({ subject }) => subject)).sort(compareSubjects);

  // Opciones de Profesor y de Materia (replaceColumnFilterOptions, column-filter.js), las mismas
  // del formulario: las de Profesor van antes de .dropdown-empty y las de Materia, después de
  // "Todas". Se rearman al cargar la lista, al cambiar el ciclo que se muestra y después de crear,
  // editar o eliminar: las elegidas que siguen siendo opciones quedan marcadas y las demás dejan de
  // filtrar.
  const fillFilterOptions = () => {
    const teacherOptions = listedTeachers().map((teacher) => form.createTeacherOption(teacher));
    const subjectOptions = listedSubjects().map((subject) => form.createSubjectOption(subject));
    activeFilters.teacher = replaceColumnFilterOptions(teacherHeader, teacherOptions, activeFilters.teacher);
    activeFilters.subject = replaceColumnFilterOptions(subjectHeader, subjectOptions, activeFilters.subject);
  };

  // Muestra la página `page` (por defecto, la actual) de las asignaciones que pasan los filtros (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar un filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const visibleAssignments = assignments.filter(matchesFilters);
    const pageAssignments = pagination.slice(visibleAssignments, { page });
    if (pageAssignments.length) tbody.replaceChildren(...pageAssignments.map(createRow));
    else showMessage(emptyMessage());
  };

  // Pide la lista junto con el ciclo lectivo actual, que dice qué asignaciones son de solo lectura,
  // y, al llegar los dos, arma las opciones de Profesor y Materia y muestra las asignaciones con lo
  // que se haya elegido mientras tanto en Curso y Ciclo lectivo. Si no llega alguno, la tabla
  // muestra el error.
  async function loadAssignments() {
    isLoaded = false;
    showMessage('Cargando asignaciones docentes…');
    let response;
    let schoolYear = null;
    try {
      [response, schoolYear] = await Promise.all([window.api?.teacherAssignments?.list(), loadCurrentSchoolYear()]);
    } catch (error) {
      console.error('Error al cargar las asignaciones docentes:', error);
    }
    if (!response?.ok || !schoolYear) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    assignments = response.teacherAssignments;
    currentSchoolYear = schoolYear;
    isLoaded = true;
    fillFilterOptions();
    renderRows();
    // Nueva asignación pudo abrirse antes de que llegara el año que anuncia
    form.setCurrentSchoolYear(schoolYear);
  }

  // Cada filtro de columna avisa sus cambios (column-filter.js). Si lo que filtra no cambió (el
  // campo de año avisa cada tecla, aunque el año incompleto todavía no filtre, y Curso, cada clic
  // dentro de su panel), la tabla y la página quedan como están. Mientras carga o si la carga
  // falló, se guardan los valores sin reemplazar el mensaje de la tabla. Un cambio de ciclo
  // (elegir otro año o limpiar el filtro) rearma antes las opciones de Profesor y Materia.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const values = FILTER_VALUES[event.target.dataset.filter](event.detail);
    const hasChanged = Object.entries(values).some(([filter, value]) => String(value) !== String(activeFilters[filter]));
    if (!hasChanged) return;
    Object.assign(activeFilters, values);
    if (!isLoaded) return;
    if ('year' in values) fillFilterOptions();
    renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva
  pagination.addEventListener('page-change', () => {
    if (isLoaded) renderRows();
  });

  loadAssignments();

  // ---------- Tabla: cambios después de crear, editar o eliminar ----------

  // Orden aproximado al del listado (FIND_BY_INSTITUTION_SQL, teacher-assignment.repository.js):
  // ciclo lectivo (el más reciente primero), profesor, curso (nivel educativo, grado, división y
  // turno, con el orden de cursos del formulario) y materia; el id desempata. El orden exacto de los
  // nombres depende de la intercalación de la base y se aplica en la próxima carga.
  const compareAssignments = (a, b) =>
    b.course.schoolYear - a.course.schoolYear ||
    compareTeachers(a.teacher, b.teacher) ||
    form.compareCourses(a.course, b.course) ||
    compareSubjects(a.subject, b.subject) ||
    a.id - b.id;

  // Agrega la asignación a la lista en memoria, en su lugar, sin recargarla ni tocar los filtros.
  const addAssignment = (newAssignment) => {
    assignments = form.insertSorted(assignments, newAssignment, compareAssignments);
  };

  // Si la asignación coincide con los filtros activos, la tabla pasa a la página donde quedó; si
  // no, no se muestra y la página se conserva.
  const showAssignment = (assignment) => {
    const visibleIndex = assignments.filter(matchesFilters).indexOf(assignment);
    renderRows(visibleIndex === -1 ? {} : { page: Math.floor(visibleIndex / pagination.pageSize) + 1 });
  };

  // Agrega la asignación creada a la lista en memoria (addAssignment), rearma las opciones de los
  // filtros (si es del ciclo que se muestra, su profesor y su materia pasan a ser opciones) y la
  // muestra (showAssignment). Si la lista no se había podido cargar, se vuelve a pedir: mostrar solo
  // la asignación nueva taparía el error.
  const insertAssignment = (newAssignment) => {
    if (!isLoaded) {
      loadAssignments();
      return;
    }
    addAssignment(newAssignment);
    fillFilterOptions();
    showAssignment(newAssignment);
  };

  // Reemplaza en la lista en memoria la asignación editada, que pasa al lugar que le toca con sus
  // datos nuevos, como una recién creada: si coincide con los filtros activos, la tabla pasa a la
  // página donde quedó; si no, su fila deja de mostrarse. Las opciones de los filtros se rearman
  // después de sumarla: así el profesor y la materia que conserva no pierden su marca, y los que ya
  // no tienen asignaciones en el ciclo dejan de ser opciones.
  const replaceAssignment = (updatedAssignment) => {
    assignments = assignments.filter(({ id }) => id !== updatedAssignment.id);
    addAssignment(updatedAssignment);
    fillFilterOptions();
    showAssignment(updatedAssignment);
  };

  // Quita de la lista en memoria la asignación dada de baja, sin recargarla, y rearma las opciones
  // de los filtros (fillFilterOptions). La página se conserva; si era la última y quedó vacía, el
  // componente pasa a la anterior.
  const removeAssignment = (deletedAssignment) => {
    assignments = assignments.filter((assignment) => assignment.id !== deletedAssignment.id);
    fillFilterOptions();
    renderRows();
  };

  // Posición en la página de la fila del botón que abrió el último modal, solo para devolver el
  // foco a la que ocupe su lugar si esa fila ya no se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit o delete) de la fila que quedó en su lugar (o de la última de la
  // página), o "Nueva asignación" si la tabla quedó sin asignaciones. Saltea los deshabilitados
  // (los de un ciclo cerrado y Eliminar de una asignación con evaluaciones), que no toman el foco.
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]:not(:disabled)`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openAssignmentModalBtn;
  };

  // ---------- Modal: Nueva asignación / Editar asignación ----------

  // El formulario es el componente compartido assignment-form.component.js; la vista abre y cierra
  // el modal, lleva el foco y actualiza la tabla con lo guardado
  const assignmentOverlay = document.getElementById('newAssignmentOverlay');
  const openAssignmentModalBtn = document.getElementById('openNewAssignmentModalBtn');
  let modalTrigger = null;
  // Asignación que se edita, la de la lista en memoria al abrir el modal desde su fila; null en un
  // alta
  let editingAssignment = null;

  // `trigger` es el botón que lo abre, al que vuelve el foco al cerrarlo; `row`, la fila de la
  // asignación que se edita. La fila la identifica solo por su data-assignment-id (el
  // asignacion_docente_id): los datos del formulario salen de la asignación cargada de la base, no
  // del texto de las celdas.
  function openAssignmentModal(trigger, row = null) {
    const assignment = row ? assignments.find((candidate) => String(candidate.id) === row.dataset.assignmentId) : null;
    if (row && !assignment) return;
    editingAssignment = assignment;
    form.open({ assignment });
    modalTrigger = trigger;
    triggerRowIndex = row ? Math.max(0, Array.from(tbody.rows).indexOf(row)) : 0;
    assignmentOverlay.classList.add('is-open');
    form.focusFirst();
  }

  function closeAssignmentModal() {
    assignmentOverlay.classList.remove('is-open');
    form.closeMenus();
    // Después de guardar, o si la asignación quedó vieja, la tabla se volvió a dibujar: el foco pasa
    // a Editar en la fila de la asignación o, si ya no se muestra o quedó en solo lectura, en la que
    // quedó en su lugar
    const focusTarget = modalTrigger?.isConnected
      ? modalTrigger
      : tbody.querySelector(`tr[data-assignment-id="${editingAssignment?.id}"] [data-action="edit"]:not(:disabled)`) ?? focusAfterRemoval('edit');
    focusTarget.focus();
  }

  // Al guardar, la asignación entra en la tabla (creada o con sus datos nuevos) y el modal se
  // cierra; el toast lo muestra el formulario. Si la asignación que se editaba quedó vieja (ya no
  // está vigente, su ciclo lectivo se cerró o tiene evaluaciones que la lista no mostraba), la lista
  // se vuelve a pedir antes de cerrarlo: al volver a abrirla, el curso y la materia ya se ven
  // bloqueados.
  form.setup({
    closeDropdown,
    closeAllDropdowns,
    onSaved: ({ teacherAssignment, mode }) => {
      if (mode === 'edit') replaceAssignment(teacherAssignment);
      else insertAssignment(teacherAssignment);
      closeAssignmentModal();
    },
    onCancel: closeAssignmentModal,
    onStale: async () => {
      await loadAssignments();
      closeAssignmentModal();
    },
  });

  openAssignmentModalBtn.addEventListener('click', () => openAssignmentModal(openAssignmentModalBtn));
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
    if (event.key === 'Escape' && assignmentOverlay.classList.contains('is-open') && !form.isSaving) closeAssignmentModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  form.reloadOptions();

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
    const isStaleAssignment = form.staleAssignmentCodes.includes(response?.error?.code);
    // La fila va a dejar de mostrarse, o a quedar en solo lectura: su posición se toma antes de
    // volver a dibujar la tabla
    if (response?.ok || isStaleAssignment) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      const { teacher, course } = response.teacherAssignment;
      removeAssignment(response.teacherAssignment);
      showToast({
        type: 'success',
        title: 'Asignación eliminada',
        description: `${teacher.firstName} ${teacher.lastName} ya no dicta ${form.subjectInCourse(response.teacherAssignment)}, en el ciclo lectivo ${course.schoolYear}.`,
      });
      return;
    }
    if (isStaleAssignment) await loadAssignments();
    showToast({ type: 'error', title: 'No se pudo eliminar la asignación', description: form.errorDescription(response?.error) });
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
