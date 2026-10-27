// Vista Evaluaciones de una asignación (Profesor): la tarjeta superior muestra el curso, el nivel
// educativo, la materia y el ciclo lectivo de la asignación elegida en Asignaciones, que
// <assignment-summary> le pide al proceso principal con el id que trae la URL (?assignmentId=).
// Hasta que llegan, cada dato muestra una raya.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta, el alta y la tabla se ocultan y queda solo el mensaje de error.
// La tabla muestra las evaluaciones vigentes de esa asignación, que llegan del proceso principal
// (window.api.evaluations.listByOwnAssignment) con el mismo id, y el filtro Título, con una opción
// por evaluación, las filtra en memoria. La lista filtrada se pagina en memoria, 10 por página, con
// <table-pagination>.
// Nueva evaluación la crea en esa asignación (window.api.evaluations.create), con el título y el
// día y el mes que pide el formulario: el año es el ciclo lectivo de la asignación. Editar abre el
// mismo formulario con el título y la fecha de la evaluación de la fila y guarda los cambios en esa
// evaluación (window.api.evaluations.update), que conserva su ciclo lectivo. El resultado se avisa
// con un toast (toast.component.js), salvo los errores de un campo, que se marcan en el formulario.
// Eliminar la da de baja (baja lógica, window.api.evaluations.delete) después de confirmarlo en un
// modal (confirm-modal.component.js) y también lo avisa con un toast: la evaluación sale de la
// tabla y del filtro Título, y sus calificaciones también se dan de baja. Si tiene alguna cargada
// (de las que se ven en Calificaciones, con la cantidad que llega con la lista), el modal lo
// advierte con la cantidad.
// El ciclo lectivo actual llega con la lista, de la base (school-year.js): si la asignación es de un
// ciclo cerrado, sus evaluaciones se ven en solo lectura, con Nueva evaluación, Editar y Eliminar
// deshabilitados; Gestionar sigue abriendo sus calificaciones.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const evaluationsActions = document.querySelector('.evaluations-actions');
  const evaluationsCard = document.querySelector('.evaluations-card');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // La asignación de la vista: null hasta que llega y si no se pudo cargar
  let assignment = null;

  // Si la asignación no llega, tampoco hay evaluaciones que gestionar.
  const assignmentRequest = summary.loadAssignment(loadError).then((loadedAssignment) => {
    assignment = loadedAssignment;
    if (assignment) return;
    evaluationsActions.hidden = true;
    evaluationsCard.hidden = true;
  });

  // El enlace de vuelta a Gestión conserva el id de la asignación, con el que esa vista la carga.
  const assignmentId = new URLSearchParams(window.location.search).get('assignmentId');
  const assignmentParams = new URLSearchParams(assignmentId ? { assignmentId } : {});
  const query = assignmentParams.toString();
  if (query) {
    const managementLink = document.querySelector('.breadcrumb a[href*="assignment-management"]');
    if (managementLink) managementLink.href = `${managementLink.getAttribute('href')}?${query}`;
  }

  // ---------- Tabla: evaluaciones de la asignación ----------

  const table = evaluationsCard.querySelector('.data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('evaluationRowTemplate');
  const evaluationOptionTemplate = document.getElementById('evaluationOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = evaluationsCard.querySelector('table-pagination');
  const titleHeader = table.querySelector('th[data-filter="title"]');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar las evaluaciones. Intentá nuevamente.';

  // En el orden en que llegan del proceso principal: por fecha. Cada una trae scoreCount, cuántas
  // calificaciones tiene cargadas al pedir la lista: Calificaciones es otra vista, así que al volver
  // de ella la lista se pide de nuevo.
  let evaluations = [];
  let isLoaded = false;
  // Si la asignación es de un ciclo lectivo cerrado, el motivo con el que Nueva evaluación, Editar y
  // Eliminar quedan deshabilitados; null si no, o hasta que llega con la lista
  let readOnlyTitle = null;
  // La evaluación elegida en el filtro Título, por su id. Vacío (nada elegido) no filtra.
  let selectedEvaluationIds = [];

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // La fecha llega como 'AAAA-MM-DD' y se muestra como DD/MM/AAAA
  const toDisplayDate = (isoDate) => isoDate.split('-').reverse().join('/');

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el
  // evaluacion_id en data-evaluation-id. En una asignación de un ciclo cerrado lleva Editar y
  // Eliminar deshabilitados, con el motivo como title.
  const createRow = ({ id, title, evaluationDate }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.evaluationId = String(id);
    row.cells[0].querySelector('.text-truncate').textContent = title;
    row.cells[1].textContent = toDisplayDate(evaluationDate);
    // "Gestionar" abre las calificaciones de esa evaluación y le pasa el id de la asignación y el
    // de la evaluación, con los que esa vista las carga. El destino y el motivo de solo lectura se
    // asignan antes de conectar el <row-actions>, que los lee al generarse.
    const rowActions = row.querySelector('row-actions');
    const scoresParams = new URLSearchParams(assignmentParams);
    scoresParams.set('evaluationId', String(id));
    rowActions.setAttribute('manage-href', `${rowActions.getAttribute('manage-href')}?${scoresParams.toString()}`);
    if (readOnlyTitle) rowActions.setAttribute('read-only-title', readOnlyTitle);
    return row;
  };

  // El título y, como referencia, su fecha: el buscador del panel encuentra la opción por
  // cualquiera de los dos
  const setEvaluationOptionText = (option, { title, evaluationDate }) => {
    option.querySelector('.option-name').textContent = title;
    option.querySelector('.option-detail').textContent = toDisplayDate(evaluationDate);
  };

  const createEvaluationOption = (evaluation) => {
    const option = evaluationOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(evaluation.id);
    setEvaluationOptionText(option, evaluation);
    return option;
  };

  // Opciones de Título: una por evaluación, en el orden de la tabla y antes de .dropdown-empty;
  // column-filter.js las lee al usarlas.
  // Llegan sin marcar, así que el filtro deja de aplicarse y su embudo se actualiza.
  const fillFilterOptions = () => {
    const titleList = titleHeader.querySelector('[role="listbox"]');
    titleList.replaceChildren(...evaluations.map(createEvaluationOption), titleList.querySelector('.dropdown-empty'));
    selectedEvaluationIds = [];
    titleHeader.dispatchEvent(new Event('column-filter-refresh'));
  };

  // Las evaluaciones que pasan el filtro Título
  const filteredEvaluations = () =>
    (selectedEvaluationIds.length
      ? evaluations.filter(({ id }) => selectedEvaluationIds.includes(String(id)))
      : evaluations);

  // Muestra la página `page` (por defecto, la actual) de las evaluaciones que pasan el filtro (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar el filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const pageEvaluations = pagination.slice(filteredEvaluations(), { page });
    if (pageEvaluations.length) tbody.replaceChildren(...pageEvaluations.map(createRow));
    else showMessage('No hay evaluaciones registradas para esta asignación.');
  };

  // Nueva evaluación: deshabilitado, con el motivo como title, si la asignación es de un ciclo
  // cerrado (readOnlyTitle)
  const syncCreateButton = () => {
    openEvaluationModalBtn.disabled = readOnlyTitle !== null;
    if (readOnlyTitle) openEvaluationModalBtn.title = readOnlyTitle;
    else openEvaluationModalBtn.removeAttribute('title');
  };

  // Pide la lista con el id de la URL, a la par de la tarjeta, junto con el ciclo lectivo actual. Al
  // llegar, y con la asignación de la tarjeta, que dice si su ciclo está cerrado, arma las opciones de
  // Título y muestra las evaluaciones. Si no llega la lista o el ciclo lectivo, la tabla muestra el
  // error. Sin id en la URL, o con uno que no es un número, el proceso principal responde que no pudo
  // identificar la asignación. Punto de entrada también para volver a pedirla después de un alta, si
  // no había cargado, y cuando un alta, una edición o una baja avisan que quedó vieja.
  async function loadEvaluations() {
    isLoaded = false;
    showMessage('Cargando evaluaciones…');
    let response;
    let schoolYear = null;
    try {
      [response, schoolYear] = await Promise.all([
        window.api?.evaluations?.listByOwnAssignment(Number(assignmentId)),
        loadCurrentSchoolYear(),
      ]);
    } catch (error) {
      console.error('Error al cargar las evaluaciones:', error);
    }
    await assignmentRequest;
    if (!response?.ok || !schoolYear) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    // Sin la asignación (no se pudo cargar), la tarjeta y la tabla ya se ocultaron
    const isClosed = Boolean(assignment) && assignment.course.schoolYear < schoolYear.year;
    readOnlyTitle = isClosed ? closedSchoolYearTitle(assignment.course.schoolYear) : null;
    syncCreateButton();
    evaluations = response.evaluations;
    isLoaded = true;
    fillFilterOptions();
    renderRows();
  }

  // El filtro de Título avisa sus cambios (column-filter.js). Si lo que filtra no cambió ("Limpiar
  // filtro" sin nada elegido), la tabla y la página quedan como están; eso incluye a los avisos
  // previos a la carga, cuando todavía no hay opciones que elegir.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const { values } = event.detail;
    if (String(values) === String(selectedEvaluationIds)) return;
    selectedEvaluationIds = values;
    renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva. Solo responde con la
  // lista ya cargada, que es cuando deja de ser estático.
  pagination.addEventListener('page-change', () => renderRows());

  // ---------- Tabla: cambios después de crear, editar o eliminar ----------

  // Orden aproximado al del listado (FIND_BY_TEACHER_ASSIGNMENT_SQL, evaluation.repository.js): la
  // fecha (la más antigua primero) y, entre las del mismo día, el título. El orden exacto de los
  // títulos depende de la intercalación de la base y se aplica en la próxima carga.
  const titleCollator = new Intl.Collator('es');
  const compareEvaluations = (a, b) =>
    a.evaluationDate.localeCompare(b.evaluationDate) || titleCollator.compare(a.title, b.title);

  // Agrega la evaluación a la lista en memoria, en el lugar que le toca
  const placeEvaluation = (evaluation) => {
    const index = evaluations.findIndex((candidate) => compareEvaluations(evaluation, candidate) < 0);
    evaluations = evaluations.toSpliced(index === -1 ? evaluations.length : index, 0, evaluation);
  };

  // La opción del filtro Título de la evaluación con ese id
  const evaluationOption = (evaluationId) => titleHeader.querySelector(`.dropdown-option[data-value="${evaluationId}"]`);

  // Agrega la evaluación creada a la lista en memoria, en su lugar, sin recargarla, y la tabla pasa
  // a la página donde quedó. El filtro Título elige una de las evaluaciones que ya estaban, así que
  // nunca mostraría a la nueva: se quita (fillFilterOptions), y ella pasa a ser una de sus opciones.
  // Si la lista no se había podido cargar, se vuelve a pedir: mostrar solo la evaluación nueva
  // taparía el error. La respuesta del alta no trae scoreCount: una evaluación nueva no tiene
  // calificaciones.
  const insertEvaluation = (createdEvaluation) => {
    if (!isLoaded) {
      loadEvaluations();
      return;
    }
    const newEvaluation = { ...createdEvaluation, scoreCount: 0 };
    placeEvaluation(newEvaluation);
    fillFilterOptions();
    renderRows({ page: Math.floor(evaluations.indexOf(newEvaluation) / pagination.pageSize) + 1 });
  };

  // Reemplaza en la lista en memoria la evaluación editada, que pasa al lugar que le toca con sus
  // datos nuevos, sin recargarla, y la tabla pasa a la página donde quedó. Su opción del filtro
  // Título muestra los datos nuevos y cambia de lugar con ella. El filtro elige por id: si estaba
  // aplicado, la editada es la elegida (es la única fila a la vista) y lo sigue siendo, y el
  // embudo, que la nombra por su título, se actualiza. La respuesta de la edición no trae
  // scoreCount: conserva el de la que reemplaza, porque editar no cambia sus calificaciones.
  const replaceEvaluation = (savedEvaluation) => {
    const { scoreCount } = evaluations.find(({ id }) => id === savedEvaluation.id);
    const updatedEvaluation = { ...savedEvaluation, scoreCount };
    evaluations = evaluations.filter(({ id }) => id !== updatedEvaluation.id);
    placeEvaluation(updatedEvaluation);
    const option = evaluationOption(updatedEvaluation.id);
    setEvaluationOptionText(option, updatedEvaluation);
    const nextEvaluation = evaluations[evaluations.indexOf(updatedEvaluation) + 1];
    const nextOption = nextEvaluation ? evaluationOption(nextEvaluation.id) : option.parentNode.querySelector('.dropdown-empty');
    option.parentNode.insertBefore(option, nextOption);
    titleHeader.dispatchEvent(new Event('column-filter-refresh'));
    renderRows({ page: Math.floor(filteredEvaluations().indexOf(updatedEvaluation) / pagination.pageSize) + 1 });
  };

  // Quita de la lista en memoria la evaluación dada de baja, sin recargarla, y su opción del filtro
  // Título; si era la elegida, el filtro deja de aplicarse y su embudo se actualiza. La página se
  // conserva; si era la última y quedó vacía, el componente pasa a la anterior.
  const removeEvaluation = (deletedEvaluation) => {
    evaluations = evaluations.filter(({ id }) => id !== deletedEvaluation.id);
    const option = evaluationOption(deletedEvaluation.id);
    const wasSelected = option?.classList.contains('selected');
    option?.remove();
    if (wasSelected) {
      selectedEvaluationIds = selectedEvaluationIds.filter((value) => value !== String(deletedEvaluation.id));
      titleHeader.dispatchEvent(new Event('column-filter-refresh'));
    }
    renderRows();
  };

  // Posición en la página de la fila del botón que abrió el último modal, solo para devolver el
  // foco a la que ocupe su lugar si esa fila ya no se muestra
  let triggerRowIndex = 0;

  // El botón de `action` (edit o delete) de la fila que quedó en su lugar (o de la última de la
  // página), o "Nueva evaluación" si la tabla quedó sin evaluaciones
  const focusAfterRemoval = (action) => {
    const buttons = tbody.querySelectorAll(`[data-action="${action}"]`);
    return buttons[Math.min(triggerRowIndex, buttons.length - 1)] ?? openEvaluationModalBtn;
  };

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // La evaluación o su asignación ya no están vigentes: la lista en memoria quedó vieja y se vuelve
  // a pedir
  const NO_LONGER_ACTIVE_CODES = ['EVALUATION_NOT_FOUND', 'TEACHER_ASSIGNMENT_NOT_FOUND'];

  // ---------- Modal compartido: Nueva evaluación / Editar evaluación ----------

  const evaluationOverlay = document.getElementById('evaluationOverlay');
  const evaluationModal = evaluationOverlay.querySelector('.modal');
  const evaluationModalBody = evaluationOverlay.querySelector('.modal-body');
  const openEvaluationModalBtn = document.getElementById('openNewEvaluationModalBtn');
  const cancelEvaluationBtn = document.getElementById('cancelEvaluationBtn');
  const saveEvaluationBtn = document.getElementById('saveEvaluationBtn');
  const evaluationModalTitle = document.getElementById('evaluationModalTitle');
  const evaluationModalSubtitle = evaluationOverlay.querySelector('.modal-header p');
  const cycleDescription = evaluationOverlay.querySelector('.info-box-text span');
  const cycleYear = document.getElementById('evaluationYear');

  const titleInput = document.getElementById('evaluationTitleInput');
  const dateInput = document.getElementById('evaluationDateInput');

  let modalTrigger = openEvaluationModalBtn;
  // Evaluación que se edita, la de la lista en memoria al abrir el modal desde su fila: su id es el
  // que se envía al guardar; null en un alta
  let editingEvaluation = null;
  let isSaving = false;

  // Texto del botón principal, en reposo y mientras se espera la respuesta, y de los toasts de
  // éxito y de error, según el modo del modal
  const MODAL_TEXTS = {
    create: {
      submit: 'Crear evaluación',
      saving: 'Creando…',
      successTitle: 'Evaluación creada',
      successDescription: (evaluation) => `Se registró “${evaluation.title}” para el ${toDisplayDate(evaluation.evaluationDate)}.`,
      errorTitle: 'No se pudo crear la evaluación',
    },
    edit: {
      submit: 'Guardar cambios',
      saving: 'Guardando…',
      successTitle: 'Evaluación actualizada',
      successDescription: (evaluation) => `Se guardaron los cambios de “${evaluation.title}”, del ${toDisplayDate(evaluation.evaluationDate)}.`,
      errorTitle: 'No se pudieron guardar los cambios',
    },
  };
  const modalTexts = () => MODAL_TEXTS[editingEvaluation ? 'edit' : 'create'];

  // Campos que el proceso principal puede marcar (error.fieldErrors), en el orden del formulario
  const FIELD_INPUTS = {
    title: titleInput,
    evaluationDate: dateInput,
  };

  // Máscara DD/MM de la fecha, formato del título y errores: componente compartido
  // field-validation.component.js. La fecha se valida contra el año del ciclo (cycleYear).

  function updateSaveButtonState() {
    const hasTitle = titleInput.value.trim().length > 0;
    const hasDate = /^\d{2}\/\d{2}$/.test(dateInput.value);
    saveEvaluationBtn.disabled = !(hasTitle && hasDate);
  }

  function resetEvaluationForm() {
    titleInput.value = '';
    dateInput.value = '';
    clearFieldErrors(evaluationOverlay);
  }

  // Mientras se espera la respuesta, el cuerpo del modal queda inerte, así lo enviado coincide con
  // lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled: conservan el foco,
  // como en confirm-modal.component.js.
  const setSaving = (saving) => {
    isSaving = saving;
    evaluationModalBody.inert = saving;
    evaluationModal.setAttribute('aria-busy', String(saving));
    [cancelEvaluationBtn, saveEvaluationBtn].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
    saveEvaluationBtn.textContent = saving ? modalTexts().saving : modalTexts().submit;
  };

  // `evaluation` es la evaluación de la fila que se edita; sin ella, el modal es el de alta, que
  // se abre con la asignación ya cargada.
  function openEvaluationModal(evaluation = null, trigger = openEvaluationModalBtn) {
    const isEditing = Boolean(evaluation);
    editingEvaluation = evaluation;
    modalTrigger = trigger;
    resetEvaluationForm();

    evaluationModalTitle.textContent = isEditing ? 'Editar evaluación' : 'Nueva evaluación';
    evaluationModalSubtitle.textContent = isEditing
      ? 'Modifica los datos de la evaluación'
      : 'Completa los datos para crear una nueva evaluación';
    cycleDescription.textContent = isEditing
      ? 'Pertenece al ciclo lectivo:'
      : 'Se creará para el ciclo lectivo:';
    saveEvaluationBtn.textContent = modalTexts().submit;

    if (evaluation) {
      titleInput.value = evaluation.title;
      // La fecha llega como 'AAAA-MM-DD'; el campo la espera como DD/MM y el año va aparte: es el
      // ciclo lectivo de la asignación, que la evaluación conserva.
      const [year, month, day] = evaluation.evaluationDate.split('-');
      dateInput.value = `${day}/${month}`;
      cycleYear.textContent = year;
    } else {
      // Una evaluación nueva es del ciclo lectivo de la asignación
      cycleYear.textContent = String(assignment.course.schoolYear);
    }

    updateSaveButtonState();
    document.querySelectorAll('.column-filter-panel:popover-open').forEach((panel) => panel.hidePopover());
    evaluationOverlay.classList.add('is-open');
    evaluationOverlay.querySelector('.modal').scrollTop = 0;
    titleInput.focus();
  }

  function closeEvaluationModal() {
    evaluationOverlay.classList.remove('is-open');
    // Después de guardar los cambios, o si la evaluación ya no está vigente, la tabla se volvió a
    // dibujar: el foco pasa a Editar en la fila de la evaluación o, si ya no se muestra, en la que
    // quedó en su lugar
    const focusTarget = modalTrigger.isConnected
      ? modalTrigger
      : tbody.querySelector(`tr[data-evaluation-id="${editingEvaluation?.id}"] [data-action="edit"]`) ?? focusAfterRemoval('edit');
    focusTarget.focus();
  }

  // Marca los campos que rechazó el proceso principal (título repetido, datos inválidos) y enfoca
  // el primero. Devuelve false si no había ninguno para marcar.
  const showFieldErrors = (fieldErrors = {}) => {
    const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
    invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
    invalidFields[0]?.[1].focus();
    return invalidFields.length > 0;
  };

  // Crea la evaluación en la asignación de la vista o guarda los cambios de la que se edita, según
  // el modo; al terminar cierra el modal y lo avisa con un toast. Los errores de un campo se marcan
  // en el formulario y los demás salen en un toast: en ambos casos el modal sigue abierto con lo
  // que se escribió. Solo se cierra si la evaluación que se editaba ya no está vigente o si el ciclo
  // lectivo de la asignación se cerró.
  const saveEvaluation = async () => {
    // El campo ya validado (DD/MM) se envía como 'AAAA-MM-DD', con el año que anuncia el modal: el
    // ciclo lectivo de la asignación
    const [day, month] = dateInput.value.split('/');
    const data = {
      title: titleInput.value,
      evaluationDate: `${cycleYear.textContent}-${month}-${day}`,
    };
    setSaving(true);
    let response;
    try {
      // La evaluación se edita en la asignación con la que se pidió la lista, como en la baja
      response = await (editingEvaluation
        ? window.api?.evaluations?.update(Number(assignmentId), editingEvaluation.id, data)
        : window.api?.evaluations?.create(assignment.id, data));
    } catch (error) {
      console.error('Error al guardar la evaluación:', error);
    }
    // La evaluación que se editaba ya no está vigente o, con la vista abierta desde antes del cambio
    // de año, el ciclo lectivo de la asignación se cerró: la lista se vuelve a pedir antes de liberar
    // el modal, que se cierra más abajo
    const errorCode = response?.error?.code;
    const isStale = (Boolean(editingEvaluation) && NO_LONGER_ACTIVE_CODES.includes(errorCode))
      || errorCode === 'SCHOOL_YEAR_CLOSED';
    if (isStale) await loadEvaluations();
    setSaving(false);

    if (response?.ok) {
      const { evaluation } = response;
      if (editingEvaluation) replaceEvaluation(evaluation);
      else insertEvaluation(evaluation);
      closeEvaluationModal();
      showToast({
        type: 'success',
        title: modalTexts().successTitle,
        description: modalTexts().successDescription(evaluation),
      });
      return;
    }
    const error = response?.error;
    if (showFieldErrors(error?.fieldErrors)) return;
    if (isStale) closeEvaluationModal();
    showToast({ type: 'error', title: modalTexts().errorTitle, description: errorDescription(error) });
  };

  titleInput.addEventListener('input', updateSaveButtonState);
  dateInput.addEventListener('input', updateSaveButtonState);

  // El alta necesita el ciclo lectivo de la asignación: si todavía no llegó, el modal la espera.
  // Si no se pudo cargar, no hay alta que abrir.
  openEvaluationModalBtn.addEventListener('click', async () => {
    await assignmentRequest;
    if (assignment) openEvaluationModal();
  });
  // Por delegación: las filas se generan después de cargar y al cambiar de página o de filtro. La
  // fila identifica a la evaluación solo por su data-evaluation-id (el evaluacion_id): los datos del
  // formulario salen de la evaluación cargada de la base, no del texto de las celdas.
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (!button) return;
    const row = button.closest('tr');
    const evaluation = evaluations.find(({ id }) => String(id) === row.dataset.evaluationId);
    if (!evaluation) return;
    triggerRowIndex = Array.from(tbody.rows).indexOf(row);
    openEvaluationModal(evaluation, button);
  });

  // Escape cierra el modal. Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control. Mientras se guarda, ni Escape ni Cancelar lo cierran.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && evaluationOverlay.classList.contains('is-open') && !isSaving) closeEvaluationModal();
  });

  cancelEvaluationBtn.addEventListener('click', () => {
    if (!isSaving) closeEvaluationModal();
  });

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  saveEvaluationBtn.addEventListener('click', () => {
    if (isSaving) return;
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(evaluationOverlay)) return;
    // El proceso principal vuelve a validar todo antes de guardar la evaluación.
    saveEvaluation();
  });

  // ---------- Modal: Eliminar evaluación ----------

  // Descripción del modal para la evaluación de la fila del botón (la de la lista en memoria, por su
  // data-evaluation-id): si tiene calificaciones cargadas, cuántas (de la lista cargada) y que
  // también se dan de baja; sin ninguna, queda la del marcado.
  const describeDeletion = (trigger) => {
    const evaluationId = trigger.closest('tr')?.dataset.evaluationId;
    const scoreCount = evaluations.find(({ id }) => String(id) === evaluationId)?.scoreCount ?? 0;
    if (scoreCount === 0) return '';
    return scoreCount === 1
      ? '¿Quieres eliminar esta evaluación? Tiene 1 calificación cargada, que también se dará de baja.'
      : `¿Quieres eliminar esta evaluación? Tiene ${scoreCount} calificaciones cargadas, que también se darán de baja.`;
  };

  // El id sale del data-evaluation-id de la fila del botón (el evaluacion_id, fijado al crearla),
  // no de su posición en la tabla, y se envía con el de la asignación con el que se pidió la lista.
  // La base da de baja con ella sus calificaciones vigentes, o rechaza la baja si alguna es de una
  // inscripción finalizada (EVALUATION_HAS_COMPLETED_SCORES): ese rechazo sale en el toast de error
  // como cualquier otro, y la lista no se recarga porque no cambió nada.
  // Avisa el resultado con un toast y no resuelve ningún mensaje, así el modal se cierra siempre.
  const deleteEvaluation = async (trigger) => {
    const row = trigger.closest('tr');
    const evaluationId = Number(row?.dataset.evaluationId);
    let response;
    try {
      response = await window.api?.evaluations?.delete(Number(assignmentId), evaluationId);
    } catch (error) {
      console.error('Error al eliminar la evaluación:', error);
    }
    const isGone = NO_LONGER_ACTIVE_CODES.includes(response?.error?.code);
    // La fila va a dejar de mostrarse: su posición se toma antes de volver a dibujar la tabla
    if (response?.ok || isGone) triggerRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(row));
    if (response?.ok) {
      const { evaluation } = response;
      removeEvaluation(evaluation);
      showToast({
        type: 'success',
        title: 'Evaluación eliminada',
        description: `Se eliminó “${evaluation.title}” del ${toDisplayDate(evaluation.evaluationDate)}.`,
      });
      return;
    }
    // También si el ciclo lectivo de la asignación se cerró con la vista abierta desde antes del
    // cambio de año: la lista vuelve en solo lectura
    if (isGone || response?.error?.code === 'SCHOOL_YEAR_CLOSED') await loadEvaluations();
    showToast({ type: 'error', title: 'No se pudo eliminar la evaluación', description: errorDescription(response?.error) });
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y después se
  // cierra. Si la fila ya no está, el foco pasa a Eliminar en la que quedó en su lugar.
  setupConfirmModal(document.getElementById('deleteEvaluationOverlay'), {
    describe: describeDeletion,
    onConfirm: deleteEvaluation,
    fallbackFocus: () => focusAfterRemoval('delete'),
  });

  loadEvaluations();
});
