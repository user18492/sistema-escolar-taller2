// Vista Inicio (dashboard) del Secretario: el título saluda al usuario de la sesión
// (dashboard-greeting.component.js) y la tarjeta "Inscripciones activas" muestra el indicador de su
// institución, que llega del proceso principal (window.api.dashboard.getSecretarySummary) y carga
// dashboard-summary.component.js. "Requiere atención" sigue siendo una maqueta.

document.addEventListener('DOMContentLoaded', () => {
  loadGreeting(document.getElementById('welcomeTitle'));
  loadSummary(() => window.api?.dashboard?.getSecretarySummary());
});
