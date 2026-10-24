const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

// Error previsto, con un mensaje apto para la UI (como EnrollmentError en enrollment.service.js).
class PdfError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
  }
}

// Prefijo de la carpeta propia de cada PDF, dentro de la carpeta temporal del sistema.
const TEMP_DIRECTORY_PREFIX = 'sistema-escolar-pdf-';

// A4, salvo que el documento fije otro tamaño o los márgenes con @page, y con los fondos del
// documento.
const PRINT_OPTIONS = { pageSize: 'A4', preferCSSPageSize: true, printBackground: true };

// PDF (un Buffer) de `html`, un documento HTML completo. Se carga en una ventana oculta, que el
// usuario no llega a ver y que se cierra al terminar, también si falla. La ventana no ejecuta
// JavaScript ni tiene acceso a Node.js, y el documento se carga como URL data:, así que no puede
// abrir archivos locales: tiene que ser HTML y CSS estáticos, con las imágenes incrustadas.
async function renderPdf(html) {
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await pdfWindow.webContents.printToPDF(PRINT_OPTIONS);
  } finally {
    pdfWindow.destroy();
  }
}

// Guarda `pdf` como `fileName` en una carpeta nueva dentro de la carpeta temporal del sistema y
// devuelve su ruta. Cada PDF va en su propia carpeta: conserva su nombre, que el visor muestra y
// propone al guardarlo, aunque el anterior con ese nombre siga abierto. No se borran: quedan en la
// carpeta temporal.
async function saveTempFile(pdf, fileName) {
  const directory = await fs.mkdtemp(path.join(app.getPath('temp'), TEMP_DIRECTORY_PREFIX));
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, pdf, { flag: 'wx' });
  return filePath;
}

// Lanza el PdfError PDF_VIEWER_UNAVAILABLE si el sistema no pudo abrir el archivo con su programa
// predeterminado para los PDF. Que no haya ninguno no es un error: Windows muestra su propio diálogo
// para elegir un programa y shell.openPath ya resolvió sin error.
async function openWithDefaultViewer(filePath) {
  const errorMessage = await shell.openPath(filePath);
  if (errorMessage) {
    throw new PdfError(
      'PDF_VIEWER_UNAVAILABLE',
      'No se pudo abrir el PDF con el visor predeterminado. Comprobá que haya un programa instalado para abrir archivos PDF.'
    );
  }
}

// Genera el PDF de `html` (ver renderPdf), lo guarda como `fileName` en un archivo temporal y lo abre
// con el visor de PDF predeterminado de Windows, desde donde el usuario lo imprime o lo guarda: la
// aplicación no muestra ventanas ni diálogos propios. Resuelve cuando el sistema abrió el visor (o,
// sin ninguno, su diálogo para elegir un programa).
// Lanza el PdfError de openWithDefaultViewer si no se pudo abrir; los errores al generarlo o al
// guardarlo no son previstos.
async function openHtmlAsPdf(html, fileName) {
  const pdf = await renderPdf(html);
  const filePath = await saveTempFile(pdf, fileName);
  await openWithDefaultViewer(filePath);
}

module.exports = { openHtmlAsPdf, PdfError };
