// Vista Calificaciones de una evaluación (Profesor): en la tarjeta superior, el curso, el nivel
// educativo, la materia y el ciclo lectivo son los de la asignación elegida en Asignaciones, que
// <assignment-summary> le pide al proceso principal con el id que trae la URL (?assignmentId=).
// Hasta que llegan, cada dato muestra una raya.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta y la tabla se ocultan y queda solo el mensaje de error.
// La evaluación es la elegida en Evaluaciones (?evaluationId=). El proceso principal
// (window.api.scores.listByOwnEvaluation) devuelve con los dos ids sus datos, que completan la
// tarjeta y la ruta de navegación, y sus calificaciones: una por cada inscripción del curso de la
// asignación, en cualquier estado, con el campo vacío si el alumno todavía no fue calificado. El
// filtro Alumno, con una opción por inscripción, las filtra en memoria. La lista filtrada se pagina
// en memoria, 10 por página, con <table-pagination>.
// La calificación se carga y se corrige en la propia fila y se guarda al salir del campo
// (window.api.scores.save). Una ya cargada no se quita, y la de una inscripción que no está activa
// solo se consulta.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const scoresCard = document.querySelector('.scores-card');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // Si la asignación no llega, tampoco hay calificaciones que mostrar.
  summary.loadAssignment(loadError).then((assignment) => {
    if (!assignment) scoresCard.hidden = true;
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
  // si todavía no tiene) y, mientras se guarda una nueva, `savingValue` es la que se envió.
  let scores = [];
  // La inscripción elegida en el filtro Alumno, por su id. Vacío (nada elegido) no filtra.
  let selectedEnrollmentIds = [];

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

  // Vuelve a generar la fila de esa calificación, si está a la vista, con lo que quedó en memoria
  const refreshRow = (score) => {
    const row = tbody.querySelector(`tr[data-enrollment-id="${score.enrollmentId}"]`);
    if (row) row.replaceWith(createRow(score));
  };

  // Guarda la nota del alumno: el proceso principal crea su calificación en la evaluación o, si ya
  // tenía una, la modifica. Hasta que responde, el control de la fila no admite cambios (inert),
  // así no se cruzan dos guardados de la misma calificación. Si no se pudo guardar, lo avisa un
  // toast y el campo vuelve a mostrar la nota guardada; si fue porque la inscripción dejó de estar
  // activa, queda además deshabilitado.
  const saveScore = async (score, value, stepper) => {
    score.savingValue = value;
    stepper.inert = true;
    let response;
    try {
      response = await window.api?.scores?.save(Number(assignmentId), Number(evaluationId), {
        enrollmentId: score.enrollmentId,
        value,
      });
    } catch (error) {
      console.error('Error al guardar la calificación:', error);
    }
    delete score.savingValue;
    if (response?.ok) {
      score.value = response.score.value;
    } else {
      if (response?.error?.code === 'ENROLLMENT_NOT_ACTIVE') score.isEnrollmentActive = false;
      showToast({
        type: 'error',
        title: 'No se pudo guardar la calificación',
        description: errorDescription(response?.error),
      });
    }
    // La fila pudo generarse de nuevo mientras tanto (otra página u otro filtro)
    refreshRow(score);
  };

  // `score` es la calificación de la fila, de la que salen la nota guardada y si se puede editar
  const initStepper = (stepper, score) => {
    const input = stepper.querySelector('.numeric-stepper-input');
    const [decrement, increment] = stepper.querySelectorAll('.numeric-stepper-btn');
    const min = Number(input.getAttribute('aria-valuemin'));
    const max = Number(input.getAttribute('aria-valuemax'));
    const clamp = (number) => Math.min(max, Math.max(min, number));
    let lastValid = input.value;

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
    });

    // Al salir del campo el valor queda en su forma final ("07," pasa a "7" y "7.5" a "7,5") y, si
    // cambió, se guarda. Una calificación ya cargada no se quita: si el campo quedó vacío, vuelve
    // la guardada y un toast lo explica.
    input.addEventListener('blur', () => {
      const typed = parseScore(input.value);
      const value = typed === null ? null : clamp(typed);
      const isRemoval = value === null && score.value !== null;
      input.value = lastValid = scoreText(isRemoval ? score.value : value);
      syncState();
      if (isRemoval) {
        showToast({
          type: 'error',
          title: 'La calificación no se puede quitar',
          description: 'Una calificación ya cargada solo se puede modificar.',
        });
      } else if (value !== score.value) {
        saveScore(score, value, stepper);
      }
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

    // Los botones quedan fuera del orden de tabulación (Tab recorre solo las
    // calificaciones) y no toman el foco: lo conserva el campo de la fila, así el borde
    // azul marca la calificación que se está editando.
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
  // inscripcion_id en data-enrollment-id. Mientras se guarda una nota, la fila muestra la que se
  // envió y su control no admite cambios; el de una inscripción que no está activa queda
  // deshabilitado, con la nota que tenga.
  function createRow(score) {
    const { enrollmentId, student, value, savingValue, isEnrollmentActive } = score;
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const name = studentName(student);
    row.dataset.enrollmentId = String(enrollmentId);
    row.cells[0].querySelector('.text-truncate').textContent = name;
    row.cells[1].textContent = formatDni(student.dni);

    const stepper = row.querySelector('.numeric-stepper');
    const input = stepper.querySelector('.numeric-stepper-input');
    const [decrement, increment] = stepper.querySelectorAll('.numeric-stepper-btn');
    input.setAttribute('aria-label', `Calificación de ${name}`);
    decrement.setAttribute('aria-label', `Restar un punto a la calificación de ${name}`);
    increment.setAttribute('aria-label', `Sumar un punto a la calificación de ${name}`);
    input.value = scoreText(savingValue ?? value);
    input.disabled = !isEnrollmentActive;
    if (!isEnrollmentActive) stepper.title = 'La inscripción del alumno no está activa';
    stepper.inert = savingValue !== undefined;
    initStepper(stepper, score);
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
  const fillFilterOptions = () => {
    const studentList = studentHeader.querySelector('[role="listbox"]');
    studentList.replaceChildren(...scores.map(createStudentOption), studentList.querySelector('.dropdown-empty'));
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

  // Pide la evaluación y sus calificaciones con los ids de la URL, a la par de la tarjeta, y al
  // llegar completa los datos de la evaluación, arma las opciones de Alumno y muestra las
  // calificaciones. Sin un id en la URL, o con uno que no es un número, el proceso principal
  // responde que no pudo identificar la asignación o la evaluación.
  async function loadScores() {
    showMessage('Cargando calificaciones…');
    let response;
    try {
      response = await window.api?.scores?.listByOwnEvaluation(Number(assignmentId), Number(evaluationId));
    } catch (error) {
      console.error('Error al cargar las calificaciones:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    summary.showEvaluation(response.evaluation);
    evaluationStep.textContent = response.evaluation.title;
    scores = response.scores;
    fillFilterOptions();
    renderRows();
  }

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

  loadScores();
});
