// Vista Gestión de una asignación (Profesor): la tarjeta superior muestra el curso, el nivel
// educativo, la materia y el ciclo lectivo de la asignación elegida en Asignaciones, que
// <assignment-summary> le pide al proceso principal con el id que trae la URL (?assignmentId=).
// Hasta que llegan, cada dato muestra una raya y las opciones quedan inertes.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta y las opciones se ocultan y queda solo el mensaje de error.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const optionsCard = document.querySelector('.options-card');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // Si la asignación no llega, no hay nada que gestionar.
  async function loadAssignment() {
    optionsCard.inert = true;
    const assignment = await summary.loadAssignment(loadError);
    if (!assignment) {
      optionsCard.hidden = true;
      return;
    }

    // Cada opción abre su vista con el id de la asignación: esa vista le pide sus datos al proceso
    // principal.
    const query = new URLSearchParams({ assignmentId: String(assignment.id) }).toString();
    optionsCard.querySelectorAll('.option-item[href]').forEach((option) => {
      option.href = `${option.getAttribute('href')}?${query}`;
    });
    optionsCard.inert = false;
  }

  loadAssignment();
});
