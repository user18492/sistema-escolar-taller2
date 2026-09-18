// Vista Evaluaciones de una asignación (Profesor) — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Datos de la asignación seleccionada ----------

  // La fila de Asignaciones abre esta vista pasando sus valores en la URL; si se
  // entra directamente se conservan los que ya trae el HTML.
  const params = new URLSearchParams(window.location.search);
  document.querySelectorAll('.summary-value[data-field]').forEach((valueEl) => {
    const value = params.get(valueEl.dataset.field);
    if (value) valueEl.textContent = value;
  });

  // El enlace de vuelta a Gestión conserva esos mismos datos.
  const query = params.toString();
  if (query) {
    const managementLink = document.querySelector('.breadcrumb a[href*="assignment-management"]');
    if (managementLink) managementLink.href = `${managementLink.getAttribute('href')}?${query}`;
  }

  // ---------- Filtros: Título y Tipo ----------

  // Los filtros viven en los encabezados de la tabla y los gestiona el componente
  // compartido column-filter.js (mismo patrón usado en Alumnos de la asignación).

  // ---------- Navegación a las calificaciones de la evaluación ----------

  // Cada fila abre las calificaciones de esa evaluación y le pasa los datos de la
  // asignación junto con los de la evaluación elegida, así esa vista puede
  // encabezar ambos bloques de contexto.
  const SCORES_VIEW_URL = '../evaluation-scores/index.html';
  const EVALUATION_FIELDS = ['evaluation', 'type', 'date', 'weight'];

  document.querySelectorAll('.data-table tbody tr').forEach((row) => {
    const openScores = () => {
      const scoresParams = new URLSearchParams(params);
      EVALUATION_FIELDS.forEach((field, index) => {
        const cell = row.cells[index];
        if (cell) scoresParams.set(field, cell.textContent.trim());
      });
      window.location.href = `${SCORES_VIEW_URL}?${scoresParams.toString()}`;
    };

    row.addEventListener('click', (event) => {
      // Editar abre el alta de la evaluación, no sus calificaciones.
      if (event.target.closest('.btn')) return;
      openScores();
    });

    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openScores();
      }
    });
  });

});
