// Comprobante de inscripción: el documento HTML que pdf.service.js convierte en PDF. Es lo único que
// define su contenido: el resto del flujo (la inscripción que se busca, la ventana oculta, el archivo
// temporal y el visor) no depende de lo que tenga.
// Por ahora es una página en blanco: el contenido queda para una tarea posterior.
// La ventana que lo carga no ejecuta JavaScript ni puede abrir archivos locales (ver renderPdf en
// pdf.service.js): tiene que ser HTML y CSS estáticos, con las imágenes incrustadas. El tamaño de la
// página y los márgenes se pueden fijar con @page; si no, es A4. Los datos de la base que se agreguen
// tienen que ir escapados como HTML.

// Documento HTML completo del comprobante de `enrollment`, la inscripción con los campos de
// listEnrollments (enrollment.service.js). El título queda en las propiedades del PDF, no en la página.
function buildEnrollmentReceiptHtml(enrollment) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Comprobante de inscripción ${enrollment.number}</title>
</head>
<body></body>
</html>
`;
}

module.exports = { buildEnrollmentReceiptHtml };
