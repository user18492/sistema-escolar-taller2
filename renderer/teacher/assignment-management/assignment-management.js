// Vista Gestión de una asignación (Profesor): la tarjeta superior muestra el curso, el nivel
// educativo, la materia y el ciclo lectivo de la asignación elegida en Asignaciones, que llegan del
// proceso principal (window.api.teacherAssignments.getOwn) a partir del id que trae la URL
// (?assignmentId=). Hasta que llegan, cada dato muestra una raya y las opciones quedan inertes.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta y las opciones se ocultan y queda solo el mensaje de error.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const optionsCard = document.querySelector('.options-card');
  const loadError = document.getElementById('assignmentLoadError');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar la asignación. Intentá nuevamente.';

  // Sin id en la URL, o con uno que no es un número, el proceso principal responde que no pudo
  // identificar la asignación.
  const assignmentId = Number(new URLSearchParams(window.location.search).get('assignmentId'));

  // ---------- Datos de la asignación seleccionada ----------

  // Textos de Turno y Nivel educativo, los mismos del filtro Curso de Asignaciones, que esta vista
  // no tiene. Llegan como MORNING o AFTERNOON y PRIMARY o SECONDARY.
  const SHIFT_LABELS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
  const LEVEL_LABELS = { PRIMARY: 'Primaria', SECONDARY: 'Secundaria' };

  // Texto de cada dato de la tarjeta, por su data-field, como en la fila de Asignaciones: el curso
  // es "1° A · Mañana"
  const summaryTexts = ({ course, subject }) => ({
    course: `${course.gradeName} ${course.division} · ${SHIFT_LABELS[course.shift] ?? course.shift}`,
    level: LEVEL_LABELS[course.educationLevel] ?? course.educationLevel,
    subject: subject.name,
    year: String(course.schoolYear),
  });

  // Los datos de la base se asignan siempre con textContent, nunca como HTML.
  const showAssignment = (assignment) => {
    const texts = summaryTexts(assignment);
    summary.querySelectorAll('.summary-value[data-field]').forEach((valueEl) => {
      valueEl.textContent = texts[valueEl.dataset.field];
    });

    // Cada opción abre su vista con el id de la asignación y con esos mismos textos, con los que
    // esa vista todavía se encabeza.
    const query = new URLSearchParams({ assignmentId: String(assignment.id), ...texts }).toString();
    optionsCard.querySelectorAll('.option-item[href]').forEach((option) => {
      option.href = `${option.getAttribute('href')}?${query}`;
    });
    optionsCard.inert = false;
  };

  // Si la asignación no llega, no hay nada que gestionar.
  async function loadAssignment() {
    optionsCard.inert = true;
    let response;
    try {
      response = await window.api?.teacherAssignments?.getOwn(assignmentId);
    } catch (error) {
      console.error('Error al cargar la asignación:', error);
    }
    if (!response?.ok) {
      summary.hidden = true;
      optionsCard.hidden = true;
      loadError.textContent = response?.error?.message || GENERIC_LOAD_ERROR;
      loadError.hidden = false;
      return;
    }
    showAssignment(response.teacherAssignment);
  }

  loadAssignment();
});
