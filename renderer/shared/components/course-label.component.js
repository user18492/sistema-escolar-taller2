// Formateador reutilizable: el texto de un curso, con sus datos separados por comas ("1° A, Mañana").
// Es el único lugar donde se arma ese texto: toda vista que muestre un curso (celdas de tablas,
// opciones de formularios y filtros, tarjetas, listas) lo toma de acá.
// Uso en JS: window.courseLabel(course, { level, schoolYear })
//   - course: { gradeName, division, shift, educationLevel, schoolYear }, como llega del proceso
//     principal (shift MORNING o AFTERNOON, educationLevel PRIMARY o SECONDARY).
//   - level: agrega el nivel educativo; schoolYear: agrega el ciclo lectivo.
//   courseLabel(course) → "1° B, Mañana"
//   courseLabel(course, { level: true }) → "1° B, Mañana, Secundaria"
//   courseLabel(course, { level: true, schoolYear: true }) → "1° B, Mañana, Secundaria, 2026"
// Se carga como script sin defer en <head>, antes que las vistas y componentes que lo usan.

(() => {
  // Los mismos textos de Turno y de Nivel educativo que los filtros y las columnas Nivel
  const SHIFT_LABELS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
  const LEVEL_LABELS = { PRIMARY: 'Primaria', SECONDARY: 'Secundaria' };
  const SEPARATOR = ', ';

  window.courseLabel = (course, { level = false, schoolYear = false } = {}) => {
    const parts = [`${course.gradeName} ${course.division}`, SHIFT_LABELS[course.shift] ?? course.shift];
    if (level) parts.push(LEVEL_LABELS[course.educationLevel] ?? course.educationLevel);
    if (schoolYear) parts.push(String(course.schoolYear));
    return parts.join(SEPARATOR);
  };
})();
