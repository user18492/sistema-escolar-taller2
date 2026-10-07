// Vista Inicio (dashboard) del Administrador: el título saluda al usuario de la sesión
// (dashboard-greeting.component.js) y las tarjetas muestran los indicadores de su institución, que
// llegan del proceso principal (window.api.dashboard.getAdminSummary). Hasta que llegan, cada
// tarjeta muestra una raya; si la carga falla, la raya queda y el error se avisa con un toast
// (toast.component.js). "Requiere atención" sigue siendo una maqueta.

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Indicadores ----------

  // Cada tarjeta muestra el dato de `summary` que nombra su data-stat
  const statCards = document.querySelectorAll('stat-card[data-stat]');
  // Con el separador de miles de Argentina: 1.248
  const countFormat = new Intl.NumberFormat('es-AR');

  // Descripción del toast de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  async function loadSummary() {
    let response;
    try {
      response = await window.api?.dashboard?.getAdminSummary();
    } catch (error) {
      console.error('Error al cargar los indicadores:', error);
    }
    if (!response?.ok) {
      showToast({
        type: 'error',
        title: 'No se pudieron cargar los indicadores',
        description: errorDescription(response?.error),
      });
      return;
    }
    statCards.forEach((card) => {
      card.setAttribute('value', countFormat.format(response.summary[card.dataset.stat]));
    });
  }

  loadGreeting(document.getElementById('welcomeTitle'));
  loadSummary();
});
