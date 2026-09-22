const sessionService = require('./services/session.service');
const { hasRole } = require('./services/access.service');
const { toRendererPath, toRendererFile } = require('./renderer-path');

// Carpeta de renderer/ en la que está la vista → roles que pueden abrirla (usuario_roles.nombre).
// null indica una vista pública. Lo que no figura, como shared/, no se puede abrir como vista.
const ROLES_BY_AREA = {
  auth: null,
  admin: ['ADMIN'],
  secretary: ['SECRETARIO'],
  teacher: ['PROFESOR'],
};

const LOGIN_VIEW = 'auth/login/index.html';

// Código de Chromium de una carga interrumpida por otra navegación.
const ERR_ABORTED = -3;

// Vista inicial de cada rol: la misma que abre login.js después de iniciar sesión.
const HOME_VIEW_BY_ROLE = {
  ADMIN: 'admin/dashboard/index.html',
  SECRETARIO: 'secretary/dashboard/index.html',
  PROFESOR: 'teacher/assignments/index.html',
};

function canOpenView(url) {
  const rendererPath = toRendererPath(url);
  if (!rendererPath) return false;

  const area = rendererPath.split('/')[0];
  if (!Object.hasOwn(ROLES_BY_AREA, area)) return false;

  const allowedRoles = ROLES_BY_AREA[area];
  return allowedRoles === null || hasRole(allowedRoles);
}

// Sin sesión, el login; con sesión, la vista inicial del rol del usuario.
function getEntryView() {
  const user = sessionService.getCurrentUser();
  return Object.hasOwn(HOME_VIEW_BY_ROLE, user?.role) ? HOME_VIEW_BY_ROLE[user.role] : LOGIN_VIEW;
}

function showEntryView(browserWindow) {
  browserWindow.loadFile(toRendererFile(getEntryView())).catch((error) => {
    // Se interrumpe la carga de la vista rechazada, o una navegación posterior reemplaza a esta (y
    // también se comprueba): la promesa se rechaza aunque la ventana termine en una vista permitida.
    if (error.errno === ERR_ABORTED) return;
    console.error('No se pudo abrir la vista inicial:', error);
  });
}

// Cada navegación de la ventana se comprueba con la sesión del proceso principal, no con el menú visible:
// sin sesión solo se abre el login, y con sesión, además, las vistas del rol del usuario.
function guardNavigation(browserWindow) {
  const { webContents } = browserWindow;

  // Las vistas no abren otras ventanas: una ventana nueva no tendría estas comprobaciones.
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Enlaces y cambios de window.location: la navegación rechazada no se inicia y se mantiene la
  // vista actual, salvo que esta tampoco corresponda a la sesión.
  webContents.on('will-navigate', (event) => {
    if (canOpenView(event.url)) return;
    event.preventDefault();
    if (!canOpenView(webContents.getURL())) showEntryView(browserWindow);
  });

  // Navegaciones que no pasan por will-navigate (historial, recarga): se comprueba la vista abierta.
  webContents.on('did-navigate', (_event, url) => {
    if (!canOpenView(url)) showEntryView(browserWindow);
  });
}

module.exports = { guardNavigation, showEntryView };
