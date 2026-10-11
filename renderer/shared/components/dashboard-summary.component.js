// Componente global: indicadores de las vistas Inicio, que llegan del proceso principal.
// Uso: loadSummary(getSummary), con `getSummary` la operación de window.api.dashboard de la vista
// (resuelve { ok: true, summary } o { ok: false, error: { code, message } }). Cada
// <stat-card data-stat="..."> pasa a mostrar el dato de `summary` que nombra su data-stat, un
// entero, con el formato de Argentina.
// Hasta que llegan, cada tarjeta muestra el "value" del HTML (una raya); si la carga falla, la raya
// queda y el error se avisa con un toast (toast.component.js).

(() => {
  // Configuración regional de Argentina: punto como separador de miles (2.256)
  const countFormat = new Intl.NumberFormat('es-AR');

  // Descripción del toast de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  window.loadSummary = async (getSummary) => {
    let response;
    try {
      response = await getSummary();
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
    document.querySelectorAll('stat-card[data-stat]').forEach((card) => {
      card.setAttribute('value', countFormat.format(response.summary[card.dataset.stat]));
    });
  };
})();
