// Vista Alumnos de una asignación (Profesor): la tarjeta superior muestra el curso, el nivel
// educativo, la materia y el ciclo lectivo de la asignación elegida en Asignaciones, que
// <assignment-summary> le pide al proceso principal con el id que trae la URL (?assignmentId=).
// Hasta que llegan, cada dato muestra una raya.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta y la tabla se ocultan y queda solo el mensaje de error.
// La tabla de alumnos sigue siendo una maqueta: interacción puramente visual, sin lógica de negocio.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const studentsCard = document.querySelector('.students-card');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // Si la asignación no llega, tampoco hay alumnos que mostrar.
  summary.loadAssignment(loadError).then((assignment) => {
    if (!assignment) studentsCard.hidden = true;
  });

  // El enlace de vuelta a Gestión conserva el id de la asignación, con el que esa vista la carga.
  const assignmentId = new URLSearchParams(window.location.search).get('assignmentId');
  if (assignmentId) {
    const query = new URLSearchParams({ assignmentId }).toString();
    const managementLink = document.querySelector('.breadcrumb a[href*="assignment-management"]');
    if (managementLink) managementLink.href = `${managementLink.getAttribute('href')}?${query}`;
  }

  // ---------- Filtro: Alumno ----------

  // El filtro de Alumno vive en el encabezado de la tabla y lo gestiona el componente
  // compartido column-filter.js (mismo patrón usado en Asignaciones y en Inscripciones).
});
