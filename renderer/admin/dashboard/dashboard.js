// Vista Inicio (dashboard) del Administrador: el título saluda al usuario de la sesión
// (dashboard-greeting.component.js) y las tarjetas muestran los indicadores de su institución, que
// llegan del proceso principal (window.api.dashboard.getAdminSummary) y carga
// dashboard-summary.component.js. "Requiere atención" sigue siendo una maqueta.

document.addEventListener('DOMContentLoaded', () => {
  loadGreeting(document.getElementById('welcomeTitle'));
  loadSummary(() => window.api?.dashboard?.getAdminSummary());
});
