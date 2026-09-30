const { nativeImage } = require('electron');
const profileImageRepository = require('../repositories/profile-image.repository');

// Foto de perfil: el renderer envía el recorte (PNG de PROFILE_IMAGE_SIZE × PROFILE_IMAGE_SIZE) y
// se guarda reencodado a JPEG por nativeImage, así el archivo siempre sale de este encoder, sin
// metadatos ni contenido extra. Debe coincidir con el width y el height de #avatarCropCanvas
// (admin/users/index.html).
const PROFILE_IMAGE_SIZE = 512;
// El PNG de 512 × 512 sin comprimir ocupa alrededor de 1 MiB.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const JPEG_QUALITY = 85;

// La interfaz nunca ve rutas del disco: las fotos se muestran con URLs de este protocolo
// (profile-image-protocol.js), del tipo profile-image://avatars/<archivo>.
const PROFILE_IMAGE_SCHEME = 'profile-image';
const PROFILE_IMAGE_HOST = 'avatars';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes) {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

// Recibe los bytes enviados por el renderer (un Uint8Array). Devuelve el JPEG a guardar, o null si
// no son un PNG válido de exactamente PROFILE_IMAGE_SIZE × PROFILE_IMAGE_SIZE.
function prepareImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_UPLOAD_BYTES || !isPng(bytes)) {
    return null;
  }

  const image = nativeImage.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width !== PROFILE_IMAGE_SIZE || height !== PROFILE_IMAGE_SIZE) return null;
  return image.toJPEG(JPEG_QUALITY);
}

// Guarda el JPEG de prepareImage en un archivo nuevo y devuelve su nombre, para usuarios.imagen_url.
function storeImage(jpeg) {
  return profileImageRepository.save(jpeg);
}

// Borra el archivo de una foto que la base ya no usa. Acepta null y nombres que no son de un archivo
// guardado (no hace nada). Nunca rechaza: la operación que la llama ya terminó o ya falló por otro
// motivo, así que un error solo queda en la consola.
async function discardImage(fileName) {
  if (!profileImageRepository.isStoredFileName(fileName)) return;
  try {
    await profileImageRepository.remove(fileName);
  } catch (error) {
    console.error('No se pudo borrar la foto de perfil:', error);
  }
}

// URL para mostrar la foto de usuarios.imagen_url, o null si no tiene una válida.
function toImageUrl(fileName) {
  if (!profileImageRepository.isStoredFileName(fileName)) return null;
  return `${PROFILE_IMAGE_SCHEME}://${PROFILE_IMAGE_HOST}/${fileName}`;
}

// Ruta absoluta del archivo que pide una URL de toImageUrl, o null si no es una de ellas.
function resolveImageUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== `${PROFILE_IMAGE_SCHEME}:` || parsedUrl.host !== PROFILE_IMAGE_HOST) {
    return null;
  }
  // Sin decodificar: los nombres válidos no tienen caracteres que se codifiquen.
  return profileImageRepository.getFilePath(parsedUrl.pathname.slice(1));
}

module.exports = {
  PROFILE_IMAGE_SCHEME,
  prepareImage,
  storeImage,
  discardImage,
  toImageUrl,
  resolveImageUrl,
};
