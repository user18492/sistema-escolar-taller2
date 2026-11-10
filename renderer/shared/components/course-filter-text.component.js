// Formateador reutilizable: lo elegido en un <course-filter> (course-filter.js), en pocas palabras,
// para el botón del filtro Curso de una barra de filtros de reporte (report-filters.css).
// Uso en JS: window.courseFilterText(courseFilter)
//   → "1° Primaria, División A, Mañana", "3 grados, Divisiones A, B" o "Todos"
// Los textos de nivel educativo y de turno se toman del propio componente (los niveles de Grado y
// los botones de Turno), así el botón dice lo mismo que el panel. Los dos turnos equivalen a no
// filtrar por turno.
// Se carga como script sin defer en <head>, antes que las vistas que lo usan.

(() => {
  const ALL_LABEL = 'Todos';
  // Con más grados elegidos, el texto dice cuántos en lugar de nombrarlos
  const MAX_NAMED_GRADES = 2;

  // { PRIMARY: 'Primaria', … } o { MORNING: 'Mañana', … }, según el componente
  const labelsOf = (courseFilter, selector, keyOf, labelOf) => Object.fromEntries(
    Array.from(courseFilter.querySelectorAll(selector), (element) => [keyOf(element), labelOf(element).textContent.trim()])
  );

  window.courseFilterText = (courseFilter) => {
    const levelLabels = labelsOf(courseFilter, '[data-level-header]',
      (header) => header.dataset.levelHeader, (header) => header.querySelector('.grade-level-label'));
    const shiftLabels = labelsOf(courseFilter, '.course-filter-shift', (button) => button.dataset.value, (button) => button);
    const grades = courseFilter.selectedGrades;
    const divisions = courseFilter.selectedDivisions;
    const shifts = courseFilter.selectedShifts;
    const parts = [];
    if (grades.length > MAX_NAMED_GRADES) parts.push(`${grades.length} grados`);
    else grades.forEach(({ level, name }) => parts.push(`${name} ${levelLabels[level] ?? level}`));
    if (divisions.length) parts.push(`${divisions.length === 1 ? 'División' : 'Divisiones'} ${divisions.join(', ')}`);
    if (shifts.length === 1) parts.push(shiftLabels[shifts[0]] ?? shifts[0]);
    return parts.length ? parts.join(', ') : ALL_LABEL;
  };
})();
