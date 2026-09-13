// Vista Asignaciones del Profesor — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // Los filtros de Curso / Materia / Ciclo lectivo viven en los encabezados de la tabla y los
  // gestiona el componente compartido column-filter.js; Curso incrusta <course-filter>, el mismo
  // filtro compuesto de Docencia. Nivel educativo es solo una columna informativa.

  // ---------- Navegación a la gestión de la asignación ----------

  // Cada fila abre la vista intermedia de gestión de la asignación y le pasa sus
  // datos para encabezar esa vista y las que se abran desde ella.
  const MANAGEMENT_VIEW_URL = '../assignment-management/index.html';
  const SUMMARY_FIELDS = ['course', 'level', 'subject', 'year'];

  document.querySelectorAll('.data-table tbody tr').forEach((row) => {
    const openManagement = () => {
      const params = new URLSearchParams();
      SUMMARY_FIELDS.forEach((field, index) => {
        const cell = row.cells[index];
        if (cell) params.set(field, cell.textContent.trim());
      });
      window.location.href = `${MANAGEMENT_VIEW_URL}?${params.toString()}`;
    };

    row.addEventListener('click', openManagement);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openManagement();
      }
    });
  });
});
