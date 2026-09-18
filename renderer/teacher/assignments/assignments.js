// Vista Asignaciones del Profesor — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // Los filtros de Curso / Materia / Ciclo lectivo viven en los encabezados de la tabla y los
  // gestiona el componente compartido column-filter.js; Curso incrusta <course-filter>, el mismo
  // filtro compuesto de Docencia. Nivel educativo es solo una columna informativa.

  // ---------- Navegación a la gestión de la asignación ----------

  // La acción "Gestionar" de cada fila abre la vista intermedia de gestión de la asignación
  // y le pasa los datos de la fila para encabezar esa vista y las que se abran desde ella.
  const SUMMARY_FIELDS = ['course', 'level', 'subject', 'year'];

  document.querySelectorAll('.data-table tbody tr').forEach((row) => {
    const manageLink = row.querySelector('.manage-link');
    if (!manageLink) return;

    const params = new URLSearchParams();
    SUMMARY_FIELDS.forEach((field, index) => {
      const cell = row.cells[index];
      if (cell) params.set(field, cell.textContent.trim());
    });
    manageLink.href = `${manageLink.getAttribute('href')}?${params.toString()}`;
  });
});
