// Componente global: copia del usuario de la sesión para la vista siguiente (sessionStorage).
// Cada vista es un documento propio, así que el menú lateral (sidebar.js) se vuelve a armar en cada
// navegación. Si esperara a auth.getCurrentUser para completar la institución, el perfil y (con
// nav-role="session") el menú, se pintaría primero sin esos datos y las opciones saltarían cuando
// llegan. Con esta copia el menú se arma completo desde el primer cuadro; los datos de la sesión los
// sigue informando el proceso principal y, si cambiaron, el menú se actualiza con ellos.
// Guarda solo lo que el menú muestra (lo que informa auth.getCurrentUser), nunca ids ni email. La
// vista del login la borra al abrirse (la sesión anterior ya no corresponde) y la escribe con el
// usuario que acaba de iniciar sesión.
// Uso: sessionUserCache.read() → usuario o null; sessionUserCache.write(user); sessionUserCache.clear().

(() => {
  const STORAGE_KEY = 'sessionUser';

  // sessionStorage puede no estar disponible: sin la copia, el menú espera a la sesión como antes.
  window.sessionUserCache = {
    read() {
      try {
        const user = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        return user && typeof user === 'object' ? user : null;
      } catch {
        return null;
      }
    },
    write(user) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          role: user.role ?? null,
          imageUrl: user.imageUrl ?? null,
          institutionName: user.institutionName ?? null,
        }));
      } catch {
        // Sin la copia, la vista siguiente espera a la sesión.
      }
    },
    clear() {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nada que borrar.
      }
    },
  };
})();
