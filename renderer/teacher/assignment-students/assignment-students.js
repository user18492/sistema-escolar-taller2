// Vista Alumnos de una asignación (Profesor) — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Datos de la asignación seleccionada ----------

  // Gestión abre esta vista pasando los datos de la asignación en la URL; si se
  // entra directamente se conservan los que ya trae el HTML.
  const params = new URLSearchParams(window.location.search);
  document.querySelectorAll('.summary-value[data-field]').forEach((valueEl) => {
    const value = params.get(valueEl.dataset.field);
    if (value) valueEl.textContent = value;
  });

  // El enlace de vuelta a Gestión conserva esos mismos datos, con el id que usa para cargarla.
  const query = params.toString();
  if (query) {
    const managementLink = document.querySelector('.breadcrumb a[href*="assignment-management"]');
    if (managementLink) managementLink.href = `${managementLink.getAttribute('href')}?${query}`;
  }

  // ---------- Filtro: Alumno ----------

  // El filtro de Alumno vive en el encabezado de la tabla y lo gestiona el componente
  // compartido column-filter.js (mismo patrón usado en Asignaciones y en Inscripciones).
});
