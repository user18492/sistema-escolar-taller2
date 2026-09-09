// Vista Calificaciones de una evaluación (Profesor) — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Datos de la asignación y de la evaluación seleccionada ----------

  // La fila de Evaluaciones abre esta vista pasando los datos de la asignación y de
  // la evaluación en la URL; si se entra directamente se conservan los que ya trae
  // el HTML.
  const params = new URLSearchParams(window.location.search);

  const applyValue = (element) => {
    const value = params.get(element.dataset.field);
    if (value) element.textContent = value;
  };

  document.querySelectorAll('.summary-value[data-field]').forEach(applyValue);
  document.querySelectorAll('.breadcrumb-item[data-field]').forEach(applyValue);

  // ---------- Vuelta por el breadcrumb ----------

  // Las vistas anteriores solo encabezan la asignación, así que los enlaces de vuelta
  // conservan esos datos y descartan los de la evaluación.
  const ASSIGNMENT_FIELDS = ['course', 'level', 'subject', 'year'];

  const assignmentParams = new URLSearchParams();
  ASSIGNMENT_FIELDS.forEach((field) => {
    const value = params.get(field);
    if (value) assignmentParams.set(field, value);
  });

  const query = assignmentParams.toString();
  if (query) {
    document
      .querySelectorAll('.breadcrumb a[href*="assignment-management"], .breadcrumb a[href*="assignment-evaluations"]')
      .forEach((link) => {
        link.href = `${link.getAttribute('href')}?${query}`;
      });
  }
});
