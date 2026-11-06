// Vista Calificaciones de una evaluación (Profesor): en la tarjeta superior, el curso, el nivel
// educativo, la materia y el ciclo lectivo son los de la asignación elegida en Asignaciones, que
// <assignment-summary> le pide al proceso principal con el id que trae la URL (?assignmentId=).
// Hasta que llegan, cada dato muestra una raya.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta y la tabla se ocultan y queda solo el mensaje de error.
// La evaluación es la elegida en Evaluaciones (?evaluationId=). El proceso principal
// (window.api.scores.listByOwnEvaluation) devuelve con los dos ids sus datos, que completan la
// tarjeta y la ruta de navegación, y sus calificaciones: una por cada inscripción vigente, activa o
// finalizada, del curso de la asignación (las canceladas y las dadas de baja no llegan), con el
// campo vacío si el alumno todavía no fue calificado. El filtro Alumno, con una opción por
// inscripción, las filtra en memoria. La lista filtrada se pagina en memoria, 10 por página, con
// <table-pagination>.
// La calificación se carga y se corrige en la propia fila, pero no se guarda enseguida: queda como
// un cambio sin guardar, que se conserva al cambiar de página o de filtro. Una ya cargada no se
// quita vaciando el campo, y la de una inscripción finalizada es de solo lectura.
// Cada fila lleva la acción "Eliminar calificación", disponible si hay una calificación guardada
// que se puede modificar: vacía el campo y la baja (baja lógica) queda como un cambio sin guardar
// más. La fila se conserva, porque el alumno sigue inscripto en el curso, y el campo admite otra
// nota; volver a escribir la guardada deshace la baja.
// "Guardar calificaciones", habilitado mientras haya cambios sin guardar, abre un modal de
// confirmación (confirm-modal.component.js) con cuántas calificaciones se cargan o corrigen y
// cuántas se eliminan; al confirmar, el proceso principal guarda todos los cambios o ninguno
// (window.api.scores.saveMany), y un toast avisa el resultado. Si falla, los cambios siguen sin
// guardar, salvo el que el proceso principal rechazó por su inscripción, que se descarta.
// Mientras tanto, las filas con un cambio sin guardar llevan un punto naranja junto a la calificación
// y el botón dice cuántos cambios hay en total, de todas las páginas.
// hasUnsavedChanges dice si quedan cambios sin guardar. Con cambios, salir de la vista por el menú
// lateral, la ruta de navegación, "Configuración" o "Cerrar sesión" pide confirmación en un modal
// (unsaved-changes-guard.component.js): "Cancelar" se queda con los cambios y "Salir sin guardar"
// los descarta y sale. En solo lectura o si la carga falló no hay cambios, así que no pregunta.
// Si al guardar el proceso principal responde que la inscripción de un alumno se dio de baja (la
// vista estaba abierta desde antes de la baja), un toast lo avisa y la lista se vuelve a pedir, sin
// esa inscripción y con el resto de los cambios sin guardar.
// El ciclo lectivo actual llega con la lista, de la base (school-year.js): si la asignación es de un
// ciclo cerrado, las calificaciones se ven en solo lectura, con el campo, Eliminar y "Guardar
// calificaciones" deshabilitados. Si la vista estaba abierta desde antes del cambio de año, el
// proceso principal rechaza el guardado, un toast lo avisa y la lista se vuelve a pedir, ya en solo
// lectura y sin los cambios.
// También se ven en solo lectura si la evaluación tiene una fecha futura (posterior a hoy, con la
// fecha de la base): se califica a partir de ese día. Si pasó a una fecha futura con la vista
// abierta, el proceso principal rechaza el guardado, un toast lo avisa y la lista se vuelve a pedir,
// ya en solo lectura.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const scoresCard = document.querySelector('.scores-card');
  const scoresActions = document.querySelector('.scores-actions');
  const saveScoresBtn = document.getElementById('saveScoresBtn');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // La asignación de la vista: null hasta que llega y si no se pudo cargar
  let assignment = null;

  // Si la asignación no llega, tampoco hay calificaciones que mostrar ni que guardar.
  const assignmentRequest = summary.loadAssignment(loadError).then((loadedAssignment) => {
    assignment = loadedAssignment;
    if (!assignment) {
      scoresActions.hidden = true;
      scoresCard.hidden = true;
    }
  });

  // ---------- Vuelta por el breadcrumb ----------

  // Las vistas anteriores cargan la asignación con su id, así que los enlaces de vuelta lo
  // conservan y descartan el de la evaluación.
  const params = new URLSearchParams(window.location.search);
  const assignmentId = params.get('assignmentId');
  const evaluationId = params.get('evaluationId');

  if (assignmentId) {
    const query = new URLSearchParams({ assignmentId }).toString();
    document
      .querySelectorAll('.breadcrumb a[href*="assignment-management"], .breadcrumb a[href*="assignment-evaluations"]')
      .forEach((link) => {
        link.href = `${link.getAttribute('href')}?${query}`;
      });
  }

  // ---------- Tabla: calificaciones de la evaluación ----------

  const table = scoresCard.querySelector('.data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('scoreRowTemplate');
  const studentOptionTemplate = document.getElementById('studentOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = scoresCard.querySelector('table-pagination');
  const studentHeader = table.querySelector('th[data-filter="student"]');
  // Paso de la evaluación en la ruta de navegación
  const evaluationStep = document.querySelector('.breadcrumb-item[data-field="evaluation"]');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar las calificaciones. Intentá nuevamente.';

  // En el orden en que llegan del proceso principal: por alumno. `value` es la nota guardada (null
  // si todavía no tiene) y `draft`, si la calificación tiene un cambio sin guardar, la nota nueva
  // (null si se eliminó la calificación); sin cambios, no tiene `draft` (ver "Cambios sin guardar").
  let scores = [];
  // La inscripción elegida en el filtro Alumno, por su id. Vacío (nada elegido) no filtra.
  let selectedEnrollmentIds = [];
  // Si la asignación es de un ciclo lectivo cerrado o la evaluación tiene una fecha futura, el
  // motivo con el que las notas y Eliminar quedan deshabilitados (el del ciclo cerrado, si son las
  // dos cosas); null si no, o hasta que llega con la lista
  let readOnlyTitle = null;

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // "Apellido, Nombre"
  const studentName = ({ firstName, lastName }) => `${lastName}, ${firstName}`;

  // La fecha llega como 'AAAA-MM-DD' y se muestra como DD/MM/AAAA
  const toDisplayDate = (isoDate) => isoDate.split('-').reverse().join('/');

  // ---------- Calificación: numeric stepper ----------

  // La calificación se escribe en el campo o se ajusta con − y +, que restan o suman un
  // punto. Los límites de la escala (0 a 10) salen de aria-valuemin/aria-valuemax del
  // campo. Se aceptan enteros y decimales de hasta dos dígitos, con coma o punto como
  // separador; el valor final se muestra con coma.
  const SCORE_STEP = 1;

  // Hasta dos dígitos enteros y dos decimales. Admite el campo vacío y los estados
  // intermedios de la escritura ("7," o ",5").
  const SCORE_PATTERN = /^\d{0,2}([.,]\d{0,2})?$/;

  // Número que representa el texto del campo, o null si todavía no hay calificación
  const parseScore = (text) => {
    const number = Number(text.replace(',', '.'));
    return text === '' || Number.isNaN(number) ? null : number;
  };

  const formatScore = (number) => String(number).replace('.', ',');

  // Texto del campo para una nota: vacío si todavía no hay
  const scoreText = (value) => (value === null ? '' : formatScore(value));

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // Rechazos de un guardado con los que la lista quedó vieja y se vuelve a pedir: la inscripción se
  // dio de baja, el ciclo lectivo se cerró con la vista abierta desde antes del cambio de año, o la
  // evaluación pasó a una fecha futura
  const STALE_LIST_CODES = ['ENROLLMENT_DELETED', 'SCHOOL_YEAR_CLOSED', 'EVALUATION_IN_FUTURE'];

  // ---------- Cambios sin guardar ----------

  // Los cambios quedan en cada calificación de `scores` (`draft`) y no en las filas, así que se
  // conservan al cambiar de página o de filtro, hasta guardarlos o salir de la vista.
  const hasDraft = (score) => Object.hasOwn(score, 'draft');

  // La nota que muestra la fila: la del cambio sin guardar, si lo hay, o la guardada
  const displayedValue = (score) => (hasDraft(score) ? score.draft : score.value);

  // Los cambios sin guardar, como los recibe window.api.scores.saveMany: [{ enrollmentId, value }],
  // con value null en las calificaciones eliminadas
  const pendingChanges = () => scores.filter(hasDraft).map(({ enrollmentId, draft }) => ({ enrollmentId, value: draft }));

  // true si hay cambios sin guardar. Habilita "Guardar calificaciones" y lo consulta el aviso de
  // calificaciones sin guardar al salir de la vista (setupUnsavedChangesGuard, al final).
  const hasUnsavedChanges = () => scores.some(hasDraft);

  // "Guardar calificaciones" está disponible si hay cambios sin guardar; en solo lectura
  // (readOnlyTitle), deshabilitado con el motivo como title. Con cambios, dice cuántos son entre
  // paréntesis, de todas las páginas y aunque el filtro oculte sus filas: "Guardar calificaciones (3)".
  const syncSaveButton = () => {
    const changeCount = scores.filter(hasDraft).length;
    saveScoresBtn.textContent = changeCount ? `Guardar calificaciones (${changeCount})` : 'Guardar calificaciones';
    saveScoresBtn.disabled = readOnlyTitle !== null || !changeCount;
    if (readOnlyTitle) saveScoresBtn.title = readOnlyTitle;
    else saveScoresBtn.removeAttribute('title');
  };

  // La nota `value` (null: sin nota) pasa a ser la de la calificación: si es la guardada, deja de
  // haber un cambio.
  const setDraft = (score, value) => {
    if (value === score.value) delete score.draft;
    else score.draft = value;
    syncSaveButton();
  };

  const findScore = (enrollmentId) => scores.find((score) => score.enrollmentId === enrollmentId);

  // Eliminar está disponible si hay una calificación guardada, la fila todavía muestra una nota (no
  // se eliminó ya) y se puede modificar (la inscripción está activa; en un ciclo cerrado o una
  // evaluación con fecha futura, además, lo deshabilita el read-only-title de createRow). El
  // atributo vale antes y después de que <row-actions> genere su botón.
  // La marca de cambio sin guardar (.unsaved-mark) se ve mientras la calificación tenga un cambio
  // (alta, corrección o baja, sin distinguirlos), y su texto queda como descripción del campo para
  // los lectores de pantalla. aria-describedby se quita sin el cambio porque también leería la
  // marca oculta.
  const syncRowState = (row, score) => {
    const isAvailable = score.value !== null && displayedValue(score) !== null && score.isEnrollmentActive;
    row.querySelector('row-actions').toggleAttribute('disabled', !isAvailable);
    const mark = row.querySelector('.unsaved-mark');
    const input = row.querySelector('.numeric-stepper-input');
    mark.hidden = !hasDraft(score);
    if (mark.hidden) input.removeAttribute('aria-describedby');
    else input.setAttribute('aria-describedby', mark.id);
  };

  // Vuelve a generar la celda de esa calificación, si está a la vista, con lo que quedó en memoria.
  // El resto de la fila se conserva.
  const refreshRow = (score) => {
    const row = tbody.querySelector(`tr[data-enrollment-id="${score.enrollmentId}"]`);
    if (!row) return;
    row.querySelector('.col-score').replaceWith(createRow(score).querySelector('.col-score'));
    syncRowState(row, score);
  };

  // `score` es la calificación de la fila, de la que salen la nota guardada, el cambio sin guardar y
  // si se puede editar
  const initStepper = (stepper, score) => {
    const input = stepper.querySelector('.numeric-stepper-input');
    const [decrement, increment] = stepper.querySelectorAll('.numeric-stepper-btn');
    const min = Number(input.getAttribute('aria-valuemin'));
    const max = Number(input.getAttribute('aria-valuemax'));
    const clamp = (number) => Math.min(max, Math.max(min, number));
    let lastValid = input.value;
    // La nota que mostraba el campo al recibir el foco: si se vacía y había una calificación
    // guardada, es la que vuelve (ver el blur)
    let valueOnFocus = displayedValue(score);

    // Si el campo quedó vacío habiendo una nota guardada que la fila todavía mostraba, eso sería
    // quitarla, y eso se hace con Eliminar
    const isRemoval = (value) => value === null && score.value !== null && valueOnFocus !== null;

    // Lo que muestra el campo pasa a ser, mientras se escribe, el cambio de la calificación:
    // "Guardar calificaciones" y Eliminar se actualizan sin esperar a que se salga del campo. Un
    // campo vacío que quitaría la nota guardada no cambia nada: lo resuelve el blur.
    const applyInput = () => {
      const typed = parseScore(input.value);
      const value = typed === null ? null : clamp(typed);
      if (isRemoval(value)) return;
      setDraft(score, value);
      const row = stepper.closest('tr');
      if (row) syncRowState(row, score);
    };

    // − y + se deshabilitan en los límites y cuando la calificación no se puede editar;
    // aria-valuenow informa el valor a los lectores de pantalla.
    const syncState = () => {
      const value = parseScore(input.value);
      decrement.disabled = input.disabled || value === null || value <= min;
      increment.disabled = input.disabled || (value !== null && value >= max);
      if (value === null) {
        input.removeAttribute('aria-valuenow');
      } else {
        input.setAttribute('aria-valuenow', value);
      }
    };

    // Sin calificación, + parte del mínimo (el primer punto da 1)
    const step = (direction) => {
      if ((direction < 0 ? decrement : increment).disabled) return;
      const current = parseScore(input.value) ?? min;
      const next = clamp(Math.round((current + direction * SCORE_STEP) * 100) / 100);
      input.value = lastValid = formatScore(next);
      syncState();
      applyInput();
    };

    // Lo escrito o pegado que no respeta el formato o supera el máximo se descarta y el
    // cursor vuelve a donde estaba.
    input.addEventListener('input', () => {
      const value = parseScore(input.value);
      if (SCORE_PATTERN.test(input.value) && (value === null || value <= max)) {
        lastValid = input.value;
      } else {
        const caret = input.selectionStart - (input.value.length - lastValid.length);
        input.value = lastValid;
        input.setSelectionRange(caret, caret);
      }
      syncState();
      applyInput();
    });

    input.addEventListener('focus', () => {
      valueOnFocus = displayedValue(score);
    });

    // Al salir del campo el valor queda en su forma final ("07," pasa a "7" y "7.5" a "7,5") como
    // cambio de la calificación, que se guarda con "Guardar calificaciones". Una calificación ya
    // cargada no se quita vaciando el campo, sino con Eliminar: si el campo quedó vacío, vuelve la
    // nota que mostraba al recibir el foco y un toast lo explica, salvo que el foco haya pasado
    // justamente al Eliminar de su fila.
    input.addEventListener('blur', (event) => {
      const typed = parseScore(input.value);
      const value = typed === null ? null : clamp(typed);
      const removal = isRemoval(value);
      const finalValue = removal ? valueOnFocus : value;
      input.value = lastValid = scoreText(finalValue);
      syncState();
      setDraft(score, finalValue);
      const row = stepper.closest('tr');
      if (row) syncRowState(row, score);
      if (!removal) return;
      const deleteButton = row?.querySelector('[data-action="delete"]');
      if (deleteButton && event.relatedTarget === deleteButton) return;
      showToast({
        type: 'error',
        title: 'La calificación no se quitó',
        description: 'Para quitarla, usá Eliminar calificación, en la columna Acciones.',
      });
    });

    // Las flechas del teclado equivalen a − y +, como en un campo numérico nativo, y Enter
    // confirma la calificación como al salir del campo
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        input.blur();
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      step(event.key === 'ArrowUp' ? 1 : -1);
    });

    // Los botones − y + quedan fuera del orden de tabulación (Tab pasa de la calificación
    // a Eliminar, si está disponible, o a la fila siguiente) y no toman el foco: lo conserva
    // el campo de la fila, así el borde azul marca la calificación que se está editando.
    stepper.addEventListener('mousedown', (event) => {
      if (!event.target.closest('.numeric-stepper-btn')) return;
      event.preventDefault();
      input.focus();
    });

    decrement.addEventListener('click', () => step(-1));
    increment.addEventListener('click', () => step(1));

    syncState();
  };

  // ---------- Filas y filtro: Alumno ----------

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // inscripcion_id en data-enrollment-id. La fila muestra la nota del cambio sin guardar, si lo hay,
  // o la guardada. El control de una inscripción que no está activa queda deshabilitado, con la
  // nota que tenga, igual que todos si la asignación es de un ciclo cerrado o la evaluación tiene
  // una fecha futura (readOnlyTitle), que también deshabilita Eliminar. El title del control dice
  // por qué.
  function createRow(score) {
    const { enrollmentId, student, isEnrollmentActive } = score;
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const name = studentName(student);
    row.dataset.enrollmentId = String(enrollmentId);
    row.cells[0].querySelector('.text-truncate').textContent = name;
    row.cells[1].textContent = formatDni(student.dni);

    const stepper = row.querySelector('.numeric-stepper');
    const input = stepper.querySelector('.numeric-stepper-input');
    const [decrement, increment] = stepper.querySelectorAll('.numeric-stepper-btn');
    input.setAttribute('aria-label', `Calificación de ${name}`);
    row.querySelector('.unsaved-mark').id = `unsavedMark${enrollmentId}`;
    decrement.setAttribute('aria-label', `Restar un punto a la calificación de ${name}`);
    increment.setAttribute('aria-label', `Sumar un punto a la calificación de ${name}`);
    input.value = scoreText(displayedValue(score));
    input.disabled = !isEnrollmentActive || readOnlyTitle !== null;
    if (readOnlyTitle) stepper.title = readOnlyTitle;
    else if (!isEnrollmentActive) stepper.title = 'La inscripción del alumno no está activa';
    initStepper(stepper, score);
    if (readOnlyTitle) row.querySelector('row-actions').setAttribute('read-only-title', readOnlyTitle);
    syncRowState(row, score);
    return row;
  }

  // El alumno y, como referencia, su DNI: el buscador del panel encuentra la opción por
  // cualquiera de los dos
  const createStudentOption = ({ enrollmentId, student }) => {
    const option = studentOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(enrollmentId);
    option.querySelector('.option-name').textContent = studentName(student);
    option.querySelector('.option-detail').textContent = formatDni(student.dni);
    return option;
  };

  // Opciones de Alumno: una por inscripción, en el orden de la tabla y antes de .dropdown-empty;
  // column-filter.js las lee al usarlas.
  // Llegan sin marcar, así que, si la lista se vuelve a pedir, el filtro deja de aplicarse y su
  // embudo se actualiza.
  const fillFilterOptions = () => {
    const studentList = studentHeader.querySelector('[role="listbox"]');
    studentList.replaceChildren(...scores.map(createStudentOption), studentList.querySelector('.dropdown-empty'));
    selectedEnrollmentIds = [];
    studentHeader.dispatchEvent(new Event('column-filter-refresh'));
  };

  // Muestra la página `page` (por defecto, la actual) de las calificaciones que pasan el filtro (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar el filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const visibleScores = selectedEnrollmentIds.length
      ? scores.filter(({ enrollmentId }) => selectedEnrollmentIds.includes(String(enrollmentId)))
      : scores;
    const pageScores = pagination.slice(visibleScores, { page });
    if (pageScores.length) tbody.replaceChildren(...pageScores.map(createRow));
    else showMessage('No hay alumnos inscriptos en este curso.');
  };

  // Pide la evaluación y sus calificaciones con los ids de la URL, a la par de la tarjeta, junto con
  // el ciclo lectivo actual. Al llegar, y con la asignación de la tarjeta, que dice si su ciclo está
  // cerrado, y la fecha de hoy, que dice si la evaluación es futura, completa los datos de la
  // evaluación, arma las opciones de Alumno y muestra las calificaciones. Si no llegan las
  // calificaciones o el ciclo lectivo, la tabla muestra el error.
  // Sin un id en la URL, o con uno que no es un número, el proceso principal responde que no pudo
  // identificar la asignación o la evaluación.
  // `drafts` son los cambios sin guardar que se conservan (reloadScores): Map enrollmentId → nota
  // (null: eliminada). Solo vuelven en las calificaciones que se pueden modificar.
  async function loadScores(drafts = new Map()) {
    showMessage('Cargando calificaciones…');
    let response;
    let schoolYear = null;
    try {
      [response, schoolYear] = await Promise.all([
        window.api?.scores?.listByOwnEvaluation(Number(assignmentId), Number(evaluationId)),
        loadCurrentSchoolYear(),
      ]);
    } catch (error) {
      console.error('Error al cargar las calificaciones:', error);
    }
    await assignmentRequest;
    if (!response?.ok || !schoolYear) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    // Sin la asignación (no se pudo cargar), la tarjeta y la tabla ya se ocultaron
    const isClosed = Boolean(assignment) && assignment.course.schoolYear < schoolYear.year;
    const { evaluationDate } = response.evaluation;
    if (isClosed) {
      readOnlyTitle = closedSchoolYearTitle(assignment.course.schoolYear);
    } else if (evaluationDate > schoolYear.today) {
      readOnlyTitle = `La evaluación es del ${toDisplayDate(evaluationDate)}: se puede calificar a partir de ese día.`;
    } else {
      readOnlyTitle = null;
    }
    summary.showEvaluation(response.evaluation);
    evaluationStep.textContent = response.evaluation.title;
    scores = response.scores;
    if (readOnlyTitle === null) {
      scores
        .filter(({ enrollmentId, isEnrollmentActive }) => isEnrollmentActive && drafts.has(enrollmentId))
        .forEach((score) => setDraft(score, drafts.get(score.enrollmentId)));
    }
    syncSaveButton();
    fillFilterOptions();
    renderRows();
  }

  // Vuelve a pedir la lista, que quedó vieja: una inscripción se dio de baja con la vista abierta y
  // deja de mostrarse, o el ciclo lectivo se cerró o la evaluación pasó a una fecha futura y la
  // lista vuelve en solo lectura. Los cambios sin guardar del resto de las calificaciones se
  // conservan (en solo lectura, ninguno).
  const reloadScores = () =>
    loadScores(new Map(scores.filter(hasDraft).map(({ enrollmentId, draft }) => [enrollmentId, draft])));

  // El filtro de Alumno avisa sus cambios (column-filter.js). Si lo que filtra no cambió ("Limpiar
  // filtro" sin nada elegido), la tabla y la página quedan como están; eso incluye a los avisos
  // previos a la carga, cuando todavía no hay opciones que elegir.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const { values } = event.detail;
    if (String(values) === String(selectedEnrollmentIds)) return;
    selectedEnrollmentIds = values;
    renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva. Solo responde con la
  // lista ya cargada, que es cuando deja de ser estático.
  pagination.addEventListener('page-change', () => renderRows());

  // ---------- Eliminar calificación ----------

  // Eliminar no da de baja la calificación enseguida: vacía el campo y la baja queda como un cambio
  // sin guardar, que se confirma junto con el resto en "Guardar calificaciones" (por eso no tiene un
  // modal propio). Eliminar deja de estar disponible y el foco pasa al campo vacío de la fila, donde
  // se puede volver a escribir la nota guardada para deshacer la baja, u otra para corregirla. Por
  // delegación, para abarcar las filas que se generan con cada página.
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="delete"]');
    if (!button || button.disabled) return;
    const row = button.closest('tr');
    const score = findScore(Number(row.dataset.enrollmentId));
    setDraft(score, null);
    refreshRow(score);
    row.querySelector('.numeric-stepper-input').focus();
  });

  // ---------- Guardar calificaciones ----------

  // "1 calificación" / "3 calificaciones"
  const countScores = (count) => `${count} ${count === 1 ? 'calificación' : 'calificaciones'}`;

  // Descripción del modal: cuántas calificaciones se cargan o corrigen y cuántas se eliminan. Sin
  // cambios (el botón no lo abre así), queda la del marcado.
  const describeChanges = () => {
    const changes = pendingChanges();
    if (!changes.length) return '';
    const deletedCount = changes.filter(({ value }) => value === null).length;
    const savedCount = changes.length - deletedCount;
    const actions = [];
    if (savedCount) actions.push(`guardar ${countScores(savedCount)}`);
    if (deletedCount) actions.push(`eliminar ${countScores(deletedCount)}`);
    return `¿Quieres ${actions.join(' y ')}?`;
  };

  // Guarda todos los cambios sin guardar con los ids de la URL: el proceso principal los guarda
  // todos o ninguno. Si los guardó, las notas pasan a ser las guardadas y la página se vuelve a
  // generar con ellas. Si no, los cambios siguen sin guardar, salvo el de la calificación que el
  // proceso principal rechazó por su inscripción (error.enrollmentId), que se descarta: no se va a
  // poder guardar (si la inscripción dejó de estar activa, su fila queda además deshabilitada). Si
  // la lista quedó vieja (STALE_LIST_CODES), se vuelve a pedir antes de avisar.
  // Avisa el resultado con un toast y no resuelve ningún mensaje, así el modal se cierra siempre.
  const saveScores = async () => {
    const changes = pendingChanges();
    if (!changes.length) return;
    let response;
    try {
      response = await window.api?.scores?.saveMany(Number(assignmentId), Number(evaluationId), changes);
    } catch (error) {
      console.error('Error al guardar las calificaciones:', error);
    }
    if (response?.ok) {
      response.scores.forEach(({ enrollmentId, value }) => {
        const score = findScore(enrollmentId);
        if (!score) return;
        score.value = value;
        delete score.draft;
      });
      syncSaveButton();
      renderRows();
      showToast({
        type: 'success',
        title: 'Calificaciones guardadas',
        description: `Se guardaron los cambios en ${countScores(response.scores.length)}.`,
      });
      return;
    }

    const error = response?.error;
    const rejectedScore = error?.enrollmentId === undefined ? null : findScore(error.enrollmentId);
    if (rejectedScore) {
      if (error.code === 'ENROLLMENT_NOT_ACTIVE') rejectedScore.isEnrollmentActive = false;
      delete rejectedScore.draft;
      syncSaveButton();
      refreshRow(rejectedScore);
    }
    if (STALE_LIST_CODES.includes(error?.code)) await reloadScores();
    let description = errorDescription(error);
    if (rejectedScore) {
      description = `${studentName(rejectedScore.student)}: ${description}`;
      if (hasUnsavedChanges()) description += ' Los demás cambios siguen sin guardar.';
    }
    showToast({ type: 'error', title: 'No se pudieron guardar las calificaciones', description });
  };

  // Componente compartido confirm-modal.component.js: lo abre "Guardar calificaciones", espera la
  // respuesta abierto y después se cierra. Si el botón quedó deshabilitado (no quedan cambios sin
  // guardar), el foco pasa al primer campo de la página que se puede editar.
  setupConfirmModal(document.getElementById('saveScoresOverlay'), {
    triggerSelector: '#saveScoresBtn',
    describe: describeChanges,
    onConfirm: saveScores,
    fallbackFocus: () => tbody.querySelector('.numeric-stepper-input:not(:disabled)'),
  });

  // Componente compartido unsaved-changes-guard.component.js: con cambios sin guardar, salir de la
  // vista pide confirmación. Al cancelar, el foco vuelve al control que lo abrió o, si ya no está,
  // al primer campo de la página que se puede editar.
  setupUnsavedChangesGuard(document.getElementById('leaveScoresOverlay'), {
    hasUnsavedChanges,
    fallbackFocus: () => tbody.querySelector('.numeric-stepper-input:not(:disabled)'),
  });

  loadScores();
});
