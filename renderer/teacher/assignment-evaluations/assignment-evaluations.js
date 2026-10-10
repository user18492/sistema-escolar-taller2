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
// Los modales de alta, edición y eliminación siguen siendo una maqueta: interacción puramente
// visual, sin lógica de negocio.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const evaluationsActions = document.querySelector('.evaluations-actions');
  const evaluationsCard = document.querySelector('.evaluations-card');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // Si la asignación no llega, tampoco hay evaluaciones que gestionar.
  summary.loadAssignment(loadError).then((assignment) => {
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
    // "Gestionar" abre las calificaciones de esa evaluación y le pasa el id de la asignación, con
    // el que esa vista la carga, junto con el título, que es el paso de la evaluación en su ruta
    // de navegación. El destino se asigna antes de conectar el <row-actions>, que lo lee al
    // generarse.
    const rowActions = row.querySelector('row-actions');
    const scoresParams = new URLSearchParams(assignmentParams);
    scoresParams.set('evaluation', title);
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
  const fillFilterOptions = () => {
    const titleList = titleHeader.querySelector('[role="listbox"]');
    titleList.replaceChildren(...evaluations.map(createEvaluationOption), titleList.querySelector('.dropdown-empty'));
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
  // principal responde que no pudo identificar la asignación.
  async function loadEvaluations() {
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

  // ---------- Modal compartido: Nueva evaluación / Editar evaluación ----------

  const evaluationOverlay = document.getElementById('evaluationOverlay');
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

  // `evaluation` es la evaluación de la fila que se edita; sin ella, el modal es el de alta.
  function openEvaluationModal(evaluation = null, trigger = openEvaluationModalBtn) {
    const isEditing = Boolean(evaluation);
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
    cycleYear.textContent = String(new Date().getFullYear());

    if (evaluation) {
      titleInput.value = evaluation.title;
      // La fecha llega como 'AAAA-MM-DD'; el campo la espera como DD/MM y el año va aparte.
      const [year, month, day] = evaluation.evaluationDate.split('-');
      dateInput.value = `${day}/${month}`;
      cycleYear.textContent = year;
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

  titleInput.addEventListener('input', updateSaveButtonState);
  dateInput.addEventListener('input', updateSaveButtonState);

  openEvaluationModalBtn.addEventListener('click', () => openEvaluationModal());
  // Por delegación: las filas se generan después de cargar y al cambiar de página o de filtro
  tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit"]');
    if (!button) return;
    const { evaluationId } = button.closest('tr').dataset;
    openEvaluationModal(evaluations.find(({ id }) => String(id) === evaluationId), button);
  });

  // Escape cierra el modal. Se escucha en el documento para que funcione aunque el foco haya
  // quedado fuera de un control.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && evaluationOverlay.classList.contains('is-open')) closeEvaluationModal();
  });

  cancelEvaluationBtn.addEventListener('click', closeEvaluationModal);

  // El overlay no cierra el modal al hacer clic fuera de él: sin listener de cierre en overlay/backdrop.

  saveEvaluationBtn.addEventListener('click', () => {
    // Con algún campo inválido, el modal sigue abierto con el foco en el primero.
    if (validateFields(evaluationOverlay)) return;
    // Vista puramente visual: crear y guardar no modifican datos persistidos.
    closeEvaluationModal();
  });

  // ---------- Modal: Eliminar evaluación ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la eliminación
  // real se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteEvaluationOverlay'));

  loadEvaluations();
});
