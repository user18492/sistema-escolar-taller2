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
// día y el mes que pide el formulario: el año es el ciclo lectivo de la asignación. El resultado se
// avisa con un toast (toast.component.js), salvo los errores de un campo, que se marcan en el
// formulario.
// La edición y la eliminación siguen siendo una maqueta: interacción puramente visual, sin lógica
// de negocio.

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

  // En el orden en que llegan del proceso principal: por fecha
  let evaluations = [];
  let isLoaded = false;
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
  // evaluacion_id en data-evaluation-id.
  const createRow = ({ id, title, evaluationDate }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.evaluationId = String(id);
    row.cells[0].querySelector('.text-truncate').textContent = title;
    row.cells[1].textContent = toDisplayDate(evaluationDate);
    // "Gestionar" abre las calificaciones de esa evaluación y le pasa el id de la asignación y el
    // de la evaluación, con los que esa vista las carga. El destino se asigna antes de conectar el
    // <row-actions>, que lo lee al generarse.
    const rowActions = row.querySelector('row-actions');
    const scoresParams = new URLSearchParams(assignmentParams);
    scoresParams.set('evaluationId', String(id));
    rowActions.setAttribute('manage-href', `${rowActions.getAttribute('manage-href')}?${scoresParams.toString()}`);
    return row;
  };

  // El título y, como referencia, su fecha: el buscador del panel encuentra la opción por
  // cualquiera de los dos
  const createEvaluationOption = ({ id, title, evaluationDate }) => {
    const option = evaluationOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(id);
    option.querySelector('.option-name').textContent = title;
    option.querySelector('.option-detail').textContent = toDisplayDate(evaluationDate);
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

  // Muestra la página `page` (por defecto, la actual) de las evaluaciones que pasan el filtro (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar el filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const visibleEvaluations = selectedEvaluationIds.length
      ? evaluations.filter(({ id }) => selectedEvaluationIds.includes(String(id)))
      : evaluations;
    const pageEvaluations = pagination.slice(visibleEvaluations, { page });
    if (pageEvaluations.length) tbody.replaceChildren(...pageEvaluations.map(createRow));
    else showMessage('No hay evaluaciones registradas para esta asignación.');
  };

  // Pide la lista con el id de la URL, a la par de la tarjeta, y al llegar arma las opciones de
  // Título y muestra las evaluaciones. Sin id en la URL, o con uno que no es un número, el proceso
  // principal responde que no pudo identificar la asignación. Punto de entrada también para volver
  // a pedirla después de un alta, si no había cargado.
  async function loadEvaluations() {
    isLoaded = false;
    showMessage('Cargando evaluaciones…');
    let response;
    try {
      response = await window.api?.evaluations?.listByOwnAssignment(Number(assignmentId));
    } catch (error) {
      console.error('Error al cargar las evaluaciones:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
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

  // ---------- Tabla: cambios después de crear ----------

  // Orden aproximado al del listado (FIND_BY_TEACHER_ASSIGNMENT_SQL, evaluation.repository.js): la
  // fecha (la más antigua primero) y, entre las del mismo día, el título. El orden exacto de los
  // títulos depende de la intercalación de la base y se aplica en la próxima carga.
  const titleCollator = new Intl.Collator('es');
  const compareEvaluations = (a, b) =>
    a.evaluationDate.localeCompare(b.evaluationDate) || titleCollator.compare(a.title, b.title);

  // Agrega la evaluación creada a la lista en memoria, en su lugar, sin recargarla, y la tabla pasa
  // a la página donde quedó. El filtro Título elige una de las evaluaciones que ya estaban, así que
  // nunca mostraría a la nueva: se quita (fillFilterOptions), y ella pasa a ser una de sus opciones.
  // Si la lista no se había podido cargar, se vuelve a pedir: mostrar solo la evaluación nueva
  // taparía el error.
  const insertEvaluation = (newEvaluation) => {
    if (!isLoaded) {
      loadEvaluations();
      return;
    }
    const index = evaluations.findIndex((evaluation) => compareEvaluations(newEvaluation, evaluation) < 0);
    evaluations = evaluations.toSpliced(index === -1 ? evaluations.length : index, 0, newEvaluation);
    fillFilterOptions();
    renderRows({ page: Math.floor(evaluations.indexOf(newEvaluation) / pagination.pageSize) + 1 });
  };

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

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
  // Evaluación que se edita, la de la lista en memoria al abrir el modal desde su fila; null en un
  // alta
  let editingEvaluation = null;
  let isSaving = false;

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
    saveEvaluationBtn.textContent = saving ? 'Creando…' : 'Crear evaluación';
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
    saveEvaluationBtn.textContent = isEditing ? 'Guardar cambios' : 'Crear evaluación';

    if (evaluation) {
      titleInput.value = evaluation.title;
      // La fecha llega como 'AAAA-MM-DD'; el campo la espera como DD/MM y el año va aparte.
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
    modalTrigger?.focus();
  }

  // Marca los campos que rechazó el proceso principal (título repetido, datos inválidos) y enfoca
  // el primero. Devuelve false si no había ninguno para marcar.
  const showFieldErrors = (fieldErrors = {}) => {
    const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
    invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
    invalidFields[0]?.[1].focus();
    return invalidFields.length > 0;
  };

  // Crea la evaluación en la asignación de la vista; al terminar cierra el modal y lo avisa con un
  // toast. Los errores de un campo se marcan en el formulario y los demás salen en un toast: en
  // ambos casos el modal sigue abierto con lo que se escribió.
  const createEvaluation = async () => {
    // El campo ya validado (DD/MM) se envía como 'AAAA-MM-DD', con el año que anuncia el modal: el
    // ciclo lectivo de la asignación
    const [day, month] = dateInput.value.split('/');
    const data = {
      title: titleInput.value,
      evaluationDate: `${assignment.course.schoolYear}-${month}-${day}`,
    };
    setSaving(true);
    let response;
    try {
      response = await window.api?.evaluations?.create(assignment.id, data);
    } catch (error) {
      console.error('Error al crear la evaluación:', error);
    }
    setSaving(false);

    if (response?.ok) {
      const { evaluation } = response;
      insertEvaluation(evaluation);
      closeEvaluationModal();
      showToast({
        type: 'success',
        title: 'Evaluación creada',
        description: `Se registró “${evaluation.title}” para el ${toDisplayDate(evaluation.evaluationDate)}.`,
      });
      return;
    }
    const error = response?.error;
    if (showFieldErrors(error?.fieldErrors)) return;
    showToast({ type: 'error', title: 'No se pudo crear la evaluación', description: errorDescription(error) });
  };

  titleInput.addEventListener('input', updateSaveButtonState);
  dateInput.addEventListener('input', updateSaveButtonState);

  // El alta necesita el ciclo lectivo de la asignación: si todavía no llegó, el modal la espera.
  // Si no se pudo cargar, no hay alta que abrir.
  openEvaluationModalBtn.addEventListener('click', async () => {
    await assignmentRequest;
    if (assignment) openEvaluationModal();
  });
  // Por delegación: las filas se generan después de cargar y al cambiar de página o de filtro
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (!button) return;
    const { evaluationId } = button.closest('tr').dataset;
    openEvaluationModal(evaluations.find(({ id }) => String(id) === evaluationId), button);
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
    // La edición sigue siendo una maqueta: guardar los cambios no modifica datos persistidos.
    if (editingEvaluation) {
      closeEvaluationModal();
      return;
    }
    // El proceso principal vuelve a validar todo antes de guardar la evaluación.
    createEvaluation();
  });

  // ---------- Modal: Eliminar evaluación ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteEvaluationOverlay'));

  loadEvaluations();
});
