// Vista Gestión de una asignación (Profesor) — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Datos de la asignación seleccionada ----------

  // La fila de Asignaciones abre esta vista pasando sus valores en la URL; si se
  // entra directamente se conservan los que ya trae el HTML.
  const params = new URLSearchParams(window.location.search);
  document.querySelectorAll('.summary-value[data-field]').forEach((valueEl) => {
    const value = params.get(valueEl.dataset.field);
    if (value) valueEl.textContent = value;
  });

  // ---------- Navegación a las opciones de gestión ----------

  // Cada opción abre su vista con los mismos datos de la asignación, así esa vista
  // puede encabezarse con el curso, el nivel, la materia y el ciclo lectivo.
  const query = params.toString();
  if (query) {
    document.querySelectorAll('.option-item[href]').forEach((option) => {
      option.href = `${option.getAttribute('href')}?${query}`;
    });
  }
});
