const path = require('node:path');
const { fileURLToPath } = require('node:url');

const RENDERER_PATH = path.join(__dirname, '..', '..', 'renderer');

// Ruta de `url` dentro de renderer/, con los segmentos separados por '/' ('admin/users/index.html'),
// o null si la URL no es un archivo de renderer/.
function toRendererPath(url) {
  let filePath;
  try {
    filePath = fileURLToPath(url);
  } catch {
    // No es una URL file://.
    return null;
  }

  const relativePath = path.relative(RENDERER_PATH, filePath);
  const isInsideRenderer = relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);

  return isInsideRenderer ? relativePath.split(path.sep).join('/') : null;
}

// Ruta absoluta del archivo de renderer/ indicado con el formato de toRendererPath().
function toRendererFile(rendererPath) {
  return path.join(RENDERER_PATH, ...rendererPath.split('/'));
}

module.exports = { toRendererPath, toRendererFile };
