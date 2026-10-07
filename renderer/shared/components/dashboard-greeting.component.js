// Componente global: saludo de las vistas Inicio, con el nombre del usuario de la sesión
// (window.api.auth.getCurrentUser).
// Uso: loadGreeting(elemento) sobre el título de la vista, que en el HTML dice "¡Hola!": queda
// "¡Hola, Ana!". Sin sesión o sin nombre queda el título del HTML, que no nombra a nadie.
// El nombre viene de la base: se asigna con textContent, nunca como HTML.

(() => {
  window.loadGreeting = async (element) => {
    let user;
    try {
      user = await window.api?.auth?.getCurrentUser();
    } catch (error) {
      console.error('Error al obtener el usuario de la sesión:', error);
    }
    const firstName = user?.firstName?.trim();
    if (firstName) element.textContent = `¡Hola, ${firstName}!`;
  };
})();
