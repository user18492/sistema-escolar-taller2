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
// La calificación se carga y se corrige en la propia fila y se guarda al salir del campo
// (window.api.scores.save). Una ya cargada no se quita vaciando el campo, y la de una inscripción
// finalizada es de solo lectura. Cada guardado se refleja arriba, en <save-status>: "Guardando…"
// mientras está en curso y después "Guardado" o, si falló, "No se pudo guardar".
// Cada fila lleva la acción "Eliminar calificación", disponible si hay una calificación guardada
// que se puede modificar: la da de baja (baja lógica, window.api.scores.delete) después de
// confirmarlo en un modal (confirm-modal.component.js). La fila se conserva, porque el alumno sigue
// inscripto en el curso: su campo queda vacío y admite otra nota.
// Si al guardar o al eliminar una calificación el proceso principal responde que la inscripción
// del alumno se dio de baja (la vista estaba abierta desde antes de la baja), un toast lo avisa y
// la lista se vuelve a pedir, sin esa inscripción.

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
  // Estado del guardado, en el encabezado de la página (save-status.component.js)
  const saveStatus = document.querySelector('save-status');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar las calificaciones. Intentá nuevamente.';

  // En el orden en que llegan del proceso principal: por alumno. `value` es la nota guardada (null
  // si todavía no tiene) y, mientras se guarda una nueva, `savingValue` es la que se envió.
  let scores = [];
  // La inscripción elegida en el filtro Alumno, por su id. Vacío (nada elegido) no filtra.
  let selectedEnrollmentIds = [];
  // true mientras reloadScores le quita el foco al campo que se estaba editando: lo escrito no se
  // guarda, pasa a la fila nueva
  let isReleasingFocus = false;

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

  // Eliminar está disponible si hay una calificación guardada y se puede modificar (la inscripción
  // está activa). El atributo vale antes y después de que <row-actions> genere su botón.
  const syncDeleteAction = (row, { value, isEnrollmentActive }) => {
    row.querySelector('row-actions').toggleAttribute('disabled', value === null || !isEnrollmentActive);
  };

  // Vuelve a generar la celda de esa calificación, si está a la vista, con lo que quedó en memoria.
  // El resto de la fila se conserva: su botón Eliminar pudo recibir el foco o un clic mientras se
  // guardaba.
  const refreshRow = (score) => {
    const row = tbody.querySelector(`tr[data-enrollment-id="${score.enrollmentId}"]`);
    if (!row) return;
    row.querySelector('.col-score').replaceWith(createRow(score).querySelector('.col-score'));
    syncDeleteAction(row, score);
  };

  // Guarda la nota del alumno: el proceso principal crea su calificación en la evaluación o, si ya
  // tenía una, la modifica. Hasta que responde, el control de la fila no admite cambios (inert),
  // así no se cruzan dos guardados de la misma calificación. El encabezado muestra "Guardando…"
  // hasta la respuesta y después el resultado. Si no se pudo guardar, un toast avisa el motivo y el
  // campo vuelve a mostrar la nota guardada; si fue porque la inscripción dejó de estar activa,
  // queda además deshabilitado, y si fue porque se dio de baja, la lista se vuelve a pedir
  // (reloadScores) y la fila deja de mostrarse. reloadScores espera a este guardado, así que acá no
  // se la espera.
  const saveScore = async (score, value, stepper) => {
    score.savingValue = value;
    stepper.inert = true;
    saveStatus.start();
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
    saveStatus.finish(Boolean(response?.ok));
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
    if (response?.error?.code === 'ENROLLMENT_DELETED') reloadScores();
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
    // cambió, se guarda. Una calificación ya cargada no se quita vaciando el campo, sino con
    // Eliminar, que pide confirmación: si el campo quedó vacío, vuelve la guardada y un toast lo
    // explica, salvo que el foco haya pasado justamente al Eliminar de su fila. El guardado en
    // curso queda en `pendingSave`, para la baja que se confirme mientras tanto. Si el foco lo quita
    // reloadScores, no hace nada.
    input.addEventListener('blur', (event) => {
      if (isReleasingFocus) return;
      const typed = parseScore(input.value);
      const value = typed === null ? null : clamp(typed);
      const isRemoval = value === null && score.value !== null;
      input.value = lastValid = scoreText(isRemoval ? score.value : value);
      syncState();
      if (isRemoval) {
        const deleteButton = stepper.closest('tr')?.querySelector('[data-action="delete"]');
        if (deleteButton && event.relatedTarget === deleteButton) return;
        showToast({
          type: 'error',
          title: 'La calificación no se quitó',
          description: 'Para quitarla, usá Eliminar calificación, en la columna Acciones.',
        });
      } else if (value !== score.value) {
        score.pendingSave = saveScore(score, value, stepper);
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
    syncDeleteAction(row, score);
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

  // Vuelve a pedir la lista, que quedó vieja: una inscripción se dio de baja con la vista abierta y
  // deja de mostrarse. Las filas se quitan enseguida y la lista se pide cuando terminan los
  // guardados en curso, así ya los trae. El campo o el botón Eliminar que tenía el foco lo recupera
  // en la fila nueva de su inscripción, si está a la vista; el campo, con lo que se estaba
  // escribiendo, sin guardarlo: se guarda al salir de él, como siempre. Si la lista ya se estaba
  // volviendo a pedir, espera ese pedido.
  let reloading = null;
  const reloadScores = () => {
    reloading ??= (async () => {
      const focused = tbody.contains(document.activeElement) ? document.activeElement : null;
      const enrollmentId = focused?.closest('tr')?.dataset.enrollmentId;
      const draft = focused?.matches('.numeric-stepper-input')
        ? { value: focused.value, start: focused.selectionStart, end: focused.selectionEnd }
        : null;
      isReleasingFocus = true;
      focused?.blur();
      isReleasingFocus = false;
      showMessage('Cargando calificaciones…');
      await Promise.all(scores.map(({ pendingSave }) => pendingSave));
      await loadScores();

      const row = enrollmentId && tbody.querySelector(`tr[data-enrollment-id="${enrollmentId}"]`);
      if (!row) return;
      if (!draft) {
        row.querySelector('[data-action="delete"]:not(:disabled)')?.focus();
        return;
      }
      const input = row.querySelector('.numeric-stepper-input');
      if (input.disabled) return;
      // El evento input lo valida y actualiza − y +, como al escribirlo
      input.value = draft.value;
      input.dispatchEvent(new Event('input'));
      input.focus();
      input.setSelectionRange(draft.start, draft.end);
    })().finally(() => {
      reloading = null;
    });
    return reloading;
  };

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

  // ---------- Modal: Eliminar calificación ----------

  // Fila de la última calificación que se pidió eliminar y su posición en la página, para devolver
  // el foco a la que ocupe su lugar si deja de mostrarse
  let deletedScoreRow = null;
  let deletedRowIndex = 0;

  // Da de baja la calificación de la fila del botón: la inscripción sale de su data-enrollment-id
  // (el inscripcion_id, fijado al crearla) y se envía con los ids de la URL. La fila no se quita ni
  // se oculta: lo que cambia es su campo, que queda vacío, y Eliminar deja de estar disponible. Si
  // la nota se estaba guardando (el clic en Eliminar sacó el foco del campo), la baja espera a que
  // termine. Sin calificación que dar de baja (ya la eliminó otra sesión), el campo también queda
  // vacío; si la inscripción dejó de estar activa, queda deshabilitado con su nota, y si se dio de
  // baja, la lista se vuelve a pedir antes de avisar, sin su fila.
  // Avisa el resultado con un toast y no resuelve ningún mensaje, así el modal se cierra siempre.
  const deleteScore = async (trigger) => {
    deletedScoreRow = trigger.closest('tr');
    const enrollmentId = Number(deletedScoreRow.dataset.enrollmentId);
    const score = scores.find((item) => item.enrollmentId === enrollmentId);
    await score.pendingSave;
    let response;
    try {
      response = await window.api?.scores?.delete(Number(assignmentId), Number(evaluationId), enrollmentId);
    } catch (error) {
      console.error('Error al eliminar la calificación:', error);
    }
    const errorCode = response?.error?.code;
    if (response?.ok || errorCode === 'SCORE_NOT_FOUND') score.value = null;
    if (errorCode === 'ENROLLMENT_NOT_ACTIVE') score.isEnrollmentActive = false;
    refreshRow(score);
    if (response?.ok) {
      showToast({
        type: 'success',
        title: 'Calificación eliminada',
        description: `Se eliminó la calificación de ${studentName(score.student)}.`,
      });
      return;
    }
    if (errorCode === 'ENROLLMENT_DELETED') {
      deletedRowIndex = Math.max(0, Array.from(tbody.rows).indexOf(deletedScoreRow));
      await reloadScores();
    }
    showToast({
      type: 'error',
      title: 'No se pudo eliminar la calificación',
      description: errorDescription(response?.error),
    });
  };

  // Componente compartido confirm-modal.component.js: espera la respuesta abierto y después se
  // cierra. Si Eliminar quedó deshabilitado, el foco pasa al campo de la calificación de su fila; si
  // la fila dejó de mostrarse, al de la que quedó en su lugar (o la última de la página), si se
  // puede editar.
  setupConfirmModal(document.getElementById('deleteScoreOverlay'), {
    onConfirm: deleteScore,
    fallbackFocus: () => {
      const row = deletedScoreRow?.isConnected
        ? deletedScoreRow
        : tbody.rows[Math.min(deletedRowIndex, tbody.rows.length - 1)];
      return row?.querySelector('.numeric-stepper-input:not(:disabled)');
    },
  });

  loadScores();
});
