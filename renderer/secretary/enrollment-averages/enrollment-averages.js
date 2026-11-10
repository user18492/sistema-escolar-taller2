// Vista Promedios de una inscripción (Secretario), abierta desde Inscripciones con el id de la
// inscripción en la URL (?enrollmentId=). Le pide al proceso principal la inscripción y sus
// promedios (window.api.enrollments.getAverages): la tarjeta superior muestra el alumno, el curso y
// el ciclo lectivo, y la tabla, una fila por materia con docente asignado en el curso, con los tres
// trimestres y el anual (<term-average>). Hasta que llegan, cada dato de la tarjeta muestra una raya.
// Si la inscripción no existe en la institución, fue dada de baja o está cancelada, si la URL no
// trae un id o si la carga falla, la tarjeta y la tabla se ocultan y queda solo el mensaje de error.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('.enrollment-summary');
  const averagesCard = document.querySelector('.averages-card');
  const loadError = document.getElementById('enrollmentLoadError');
  const table = averagesCard.querySelector('.data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('subjectRowTemplate');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar los promedios. Intentá nuevamente.';

  // Cargando o sin materias, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // Texto de cada dato de la tarjeta, por su data-field, como en la fila de Inscripciones: el alumno
  // es "Apellido, Nombre" y el curso, "1° A, Mañana, Primaria"
  const summaryTexts = ({ student, course }) => ({
    student: `${student.lastName}, ${student.firstName}`,
    course: courseLabel(course, { level: true }),
    year: String(course.schoolYear),
  });

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. La fila lleva el nombre
  // de la materia en data-subject.
  const createRow = ({ subjectName, terms, annual }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.subject = subjectName;
    row.cells[0].querySelector('.text-truncate').textContent = subjectName;
    const averages = row.querySelectorAll('term-average');
    [...terms, annual].forEach(({ value, isFinal }, index) => {
      if (value !== null) averages[index].setAttribute('value', String(value));
      averages[index].toggleAttribute('is-final', isFinal);
    });
    return row;
  };

  const showLoadError = (message) => {
    summary.hidden = true;
    averagesCard.hidden = true;
    loadError.textContent = message;
    loadError.hidden = false;
  };

  // Sin id en la URL, o con uno que no es un número, el proceso principal responde que no pudo
  // identificar la inscripción.
  async function loadAverages() {
    showMessage('Cargando promedios…');
    const enrollmentId = Number(new URLSearchParams(window.location.search).get('enrollmentId'));
    let response;
    try {
      response = await window.api?.enrollments?.getAverages(enrollmentId);
    } catch (error) {
      console.error('Error al cargar los promedios:', error);
    }
    if (!response?.ok) {
      showLoadError(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }

    const texts = summaryTexts(response.enrollment);
    summary.querySelectorAll('.summary-value[data-field]').forEach((value) => {
      value.textContent = texts[value.dataset.field];
    });
    if (response.subjects.length) tbody.replaceChildren(...response.subjects.map(createRow));
    else showMessage('El curso no tiene materias con docente asignado.');
  }

  loadAverages();
});
