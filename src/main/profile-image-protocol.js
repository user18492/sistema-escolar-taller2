const { pathToFileURL } = require('node:url');
const { protocol, net } = require('electron');
const sessionService = require('./services/session.service');
const { PROFILE_IMAGE_SCHEME, resolveImageUrl } = require('./services/profile-image.service');

// Protocolo con el que las vistas muestran las fotos de perfil (<img src="profile-image://avatars/…">)
// sin conocer la carpeta donde se guardan.

// Se llama una vez, antes de que la aplicación esté lista (requisito de Electron). Como esquema
// estándar, sus URLs tienen host y ruta como las http; como seguro, Chromium lo trata como https.
function registerProfileImageScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: PROFILE_IMAGE_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

function notFound() {
  return new Response(null, { status: 404 });
}

// Se llama una vez, con la aplicación lista. Sin sesión iniciada, con una URL que no es de una foto
// o si falta el archivo (p. ej., se subió desde otra PC), responde 404 y la vista muestra las
// iniciales.
function handleProfileImageRequests() {
  protocol.handle(PROFILE_IMAGE_SCHEME, async (request) => {
    if (!sessionService.getCurrentUser()) return notFound();

    const filePath = resolveImageUrl(request.url);
    if (!filePath) return notFound();

    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      // net.fetch rechaza (ERR_FILE_NOT_FOUND) si el archivo no existe.
      return notFound();
    }
  });
}

module.exports = { registerProfileImageScheme, handleProfileImageRequests };
