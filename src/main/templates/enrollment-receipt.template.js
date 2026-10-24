// Comprobante de inscripción: el documento HTML que pdf.service.js convierte en PDF. Es lo único que
// define su contenido: el resto del flujo (la inscripción que se busca, la ventana oculta, el archivo
// temporal y el visor) no depende de lo que tenga.
// Es un escrito de estilo legal, en Times New Roman y solo con párrafos de texto corrido (sin
// tablas, listas ni pares "campo: valor"): el título, la institución y la inscripción, los datos del
// alumno y el cierre con la fecha de emisión. Se lo llama "comprobante", como al archivo y al título
// del PDF. La base no guarda el género del alumno, así que el texto
// lo nombra sin palabras con género ("el alumno", "inscripto", "nacido", "domiciliado"...).
// La ventana que lo carga no ejecuta JavaScript ni puede abrir archivos locales (ver renderPdf en
// pdf.service.js): tiene que ser HTML y CSS estáticos, con las imágenes incrustadas. Los datos de la
// base van siempre escapados como HTML (escapeHtml).

// Textos de los códigos del sistema, como los escribe el comprobante. El estado concuerda con
// "inscripción".
const STATUS_TEXTS = { ACTIVE: 'activa', COMPLETED: 'finalizada', CANCELLED: 'cancelada' };
const SHIFT_TEXTS = { MORNING: 'mañana', AFTERNOON: 'tarde' };
const EDUCATION_LEVEL_TEXTS = { PRIMARY: 'primario', SECONDARY: 'secundario' };
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

// 'AAAA-MM-DD' → { year, month, day }, como números
function parseIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

// '2026-03-02' → '2 de marzo de 2026'
function toLongDate(isoDate) {
  const { year, month, day } = parseIsoDate(isoDate);
  return `${day} de ${MONTH_NAMES[month - 1]} de ${year}`;
}

// Fórmula de cierre de los escritos: '2026-10-24' → 'a los 24 días del mes de octubre de 2026'; el
// día 1, 'al primer día del mes de...'.
function toIssueDateFormula(isoDate) {
  const { year, month, day } = parseIsoDate(isoDate);
  const days = day === 1 ? 'al primer día' : `a los ${day} días`;
  return `${days} del mes de ${MONTH_NAMES[month - 1]} de ${year}`;
}

// '45123456' → '45.123.456', como lo muestran las vistas del Secretario
const formatDni = (dni) => dni.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// 'LÓPEZ, Camila': apellido y nombre, con el apellido en mayúsculas, como en los escritos legales
const fullName = ({ firstName, lastName }) => `${lastName.toLocaleUpperCase('es')}, ${firstName}`;

// 'N.° 30-71234567-8', sin cortes de línea: el navegador corta la línea después de un guion, y el
// CUIT y el número de inscripción llevan guiones. `html` ya está escapado.
const numbered = (html) => `<span class="no-break">N.° ${html}</span>`;

// La institución y la inscripción: número, fecha, curso, ciclo lectivo y estado
function enrollmentParagraph({ institution, number, enrollmentDate, course, status }) {
  return 'Por medio del presente, la institución educativa ' +
    `<strong>${escapeHtml(institution.name)}</strong>, CUIT ${numbered(escapeHtml(institution.cuit))}, hace ` +
    `constar que con fecha ${toLongDate(enrollmentDate)} se registró la inscripción ` +
    `${numbered(`<strong>${escapeHtml(number)}</strong>`)} ` +
    `en el curso de ${escapeHtml(course.gradeName)}, división ${escapeHtml(course.division)}, del nivel ` +
    `${EDUCATION_LEVEL_TEXTS[course.educationLevel]}, turno ${SHIFT_TEXTS[course.shift]}, correspondiente al ` +
    `ciclo lectivo ${course.schoolYear}, la cual, a la fecha de emisión del presente, se encuentra ` +
    `${STATUS_TEXTS[status]}.`;
}

// Los datos personales del alumno
function studentParagraph({ student }) {
  return `La inscripción corresponde a <strong>${escapeHtml(fullName(student))}</strong>, ` +
    `DNI ${numbered(escapeHtml(formatDni(student.dni)))}, con fecha de nacimiento ${toLongDate(student.birthDate)} y ` +
    `domicilio en ${escapeHtml(student.street)} ${escapeHtml(student.streetNumber)}. Como datos de contacto ` +
    `constan el correo electrónico ${escapeHtml(student.email)} y el teléfono ${escapeHtml(student.phone)}.`;
}

function closingParagraph({ issueDate }) {
  return 'Se extiende el presente comprobante a pedido de la persona interesada, para ser presentado ante ' +
    `quien corresponda, ${toIssueDateFormula(issueDate)}.`;
}

// Documento HTML completo del comprobante de `receipt`, la inscripción con los campos de
// toEnrollmentReceipt (enrollment.service.js). El título del documento queda en las propiedades del
// PDF; el de la página es el <h1>. A4, con márgenes de escrito.
function buildEnrollmentReceiptHtml(receipt) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Comprobante de inscripción ${escapeHtml(receipt.number)}</title>
  <style>
    @page { size: A4; margin: 3cm 2.5cm; }
    body { margin: 0; font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.5; color: #000; }
    h1 { margin: 0 0 1.5cm; font-size: 14pt; font-weight: bold; letter-spacing: 0.05em; text-align: center; }
    p { margin: 0 0 12pt; text-align: justify; text-indent: 1.25cm; overflow-wrap: break-word; }
    .no-break { white-space: nowrap; }
  </style>
</head>
<body>
  <h1>COMPROBANTE DE INSCRIPCIÓN</h1>
  <p>${enrollmentParagraph(receipt)}</p>
  <p>${studentParagraph(receipt)}</p>
  <p>${closingParagraph(receipt)}</p>
</body>
</html>
`;
}

module.exports = { buildEnrollmentReceiptHtml };
