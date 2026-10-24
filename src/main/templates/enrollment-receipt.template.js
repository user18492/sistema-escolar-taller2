// Comprobante de inscripción: el documento HTML que pdf.service.js convierte en PDF. Es lo único que
// define su contenido: el resto del flujo (la inscripción que se busca, la ventana oculta, el archivo
// temporal y el visor) no depende de lo que tenga.
// Es un escrito de estilo legal, en Times New Roman. El cuerpo es solo de párrafos de texto corrido
// (sin tablas, listas ni pares "campo: valor"): el título, la institución y la inscripción, los datos
// del alumno y el cierre con la fecha de emisión. Se lo llama "comprobante", como al archivo y al
// título del PDF. La base no guarda el género del alumno, así que el texto
// lo nombra sin palabras con género ("el alumno", "inscripto", "nacido", "domiciliado"...).
// Encima del cuerpo va el encabezado con los datos de la institución, sin el logotipo de la
// aplicación, y debajo, las firmas: primero certifica la institución y después recibe quien lo
// retira, que puede ser el alumno u otra persona, así que tampoco esos textos tienen género ni
// nombran a un tutor. El PDF lleva dos copias iguales, una por página: el original y el duplicado.
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
// Una copia por página, en este orden, con su marca en la esquina
const COPY_MARKS = ['Original', 'Duplicado'];

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

// Encabezado: los datos de la institución, en la esquina izquierda, y la marca de la copia, en la
// derecha. Se muestran todos, uno por línea: ninguno puede faltar en la base. La marca flota, así
// que solo acorta las primeras líneas y las demás usan todo el ancho.
function letterhead({ institution }, copyMark) {
  return `<header class="letterhead">
      <div class="copy-mark">${copyMark}</div>
      <div class="institution-name">${escapeHtml(institution.name)}</div>
      <div>CUIT ${numbered(escapeHtml(institution.cuit))}</div>
      <div>${escapeHtml(institution.street)} ${escapeHtml(institution.streetNumber)}</div>
      <div>${escapeHtml(institution.email)}</div>
      <div>Tel. ${escapeHtml(institution.phone)}</div>
    </header>`;
}

// Las firmas, lado a lado y con un título encima de cada una: a la izquierda, la de quien firma por
// la institución, con el sello junto a la firma; a la derecha, la de quien retira el comprobante.
// Los títulos dicen qué avala cada firma: la de quien retira, solo que lo recibió. Los dos ocupan
// una línea y tienen el mismo espacio debajo, así que las líneas de firma y las de aclaración quedan
// a la misma altura.
function signatures() {
  return `<div class="signatures">
      <div class="signature">
        <div class="signature-title">POR LA INSTITUCIÓN</div>
        <div class="signature-line">Firma y sello</div>
        <div class="signature-line">Aclaración</div>
      </div>
      <div class="signature">
        <div class="signature-title">RECIBÍ CONFORME</div>
        <div class="signature-line">Firma</div>
        <div class="signature-line">Aclaración</div>
        <div class="signature-line">DNI</div>
      </div>
    </div>`;
}

// Una copia completa del comprobante, en su propia página
function receiptCopy(receipt, copyMark) {
  return `<section class="copy">
    ${letterhead(receipt, copyMark)}
    <h1>COMPROBANTE DE INSCRIPCIÓN</h1>
    <p>${enrollmentParagraph(receipt)}</p>
    <p>${studentParagraph(receipt)}</p>
    <p>${closingParagraph(receipt)}</p>
    ${signatures()}
  </section>`;
}

// Documento HTML completo del comprobante de `receipt`, la inscripción con los campos de
// toEnrollmentReceipt (enrollment.service.js), con una copia por página (COPY_MARKS). El título del
// documento queda en las propiedades del PDF; el de la página es el <h1>. A4: cada copia entra en una
// sola hoja también con todos los datos al largo máximo que acepta la base, salvo con textos de
// caracteres anchos sin espacios (un email de 254 "m"); entonces las firmas pasan enteras a la hoja
// siguiente.
function buildEnrollmentReceiptHtml(receipt) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Comprobante de inscripción ${escapeHtml(receipt.number)}</title>
  <style>
    @page { size: A4; margin: 1.5cm 2.5cm; }
    body { margin: 0; font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.5; color: #000; }
    .copy + .copy { break-before: page; }
    .letterhead { margin: 0 0 0.7cm; padding: 0 0 6pt; border-bottom: 0.5pt solid #999; font-size: 10pt; line-height: 1.25; overflow-wrap: anywhere; }
    .institution-name { font-size: 11pt; font-weight: bold; }
    .copy-mark { float: right; margin: 0 0 0 1cm; padding: 0 6pt; border: 0.5pt solid #666; font-size: 9pt; letter-spacing: 0.05em; color: #333; }
    h1 { margin: 0 0 0.7cm; font-size: 14pt; font-weight: bold; letter-spacing: 0.05em; text-align: center; }
    p { margin: 0 0 12pt; text-align: justify; text-indent: 1.25cm; overflow-wrap: break-word; }
    .no-break { white-space: nowrap; }
    .signatures { display: flex; gap: 2cm; margin: 1cm 0 0; font-size: 10pt; line-height: 1.25; break-inside: avoid; }
    .signature { flex: 1; }
    .signature-title { font-weight: bold; letter-spacing: 0.05em; text-align: center; }
    .signature-line { margin: 0.7cm 0 0; padding: 2pt 0 0; border-top: 0.5pt solid #000; text-align: center; }
    .signature-title + .signature-line { margin-top: 2cm; }
  </style>
</head>
<body>
  ${COPY_MARKS.map((copyMark) => receiptCopy(receipt, copyMark)).join('\n  ')}
</body>
</html>
`;
}

module.exports = { buildEnrollmentReceiptHtml };
