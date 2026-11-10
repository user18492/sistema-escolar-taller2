const LEVELS = { PRIMARY: 'primario', SECONDARY: 'secundario' };
const SHIFTS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
const AVERAGE_FORMAT = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
const formatDni = (dni) => dni.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function averageCell({ value, isFinal }) {
  if (value === null) return '<td class="no-average">Sin promedio</td>';
  const mark = isFinal ? '' : ' <span class="partial">Parcial</span>';
  return `<td><strong>${AVERAGE_FORMAT.format(value)}</strong>${mark}</td>`;
}

function subjectRow({ name, terms, annual }) {
  return `<tr><th scope="row">${escapeHtml(name)}</th>${[...terms, annual].map(averageCell).join('')}<td></td></tr>`;
}

function reportCard({ student, subjects }, institution, course) {
  const studentName = `${student.lastName}, ${student.firstName}`;
  const rows = subjects.length
    ? subjects.map(subjectRow).join('\n')
    : '<tr><td colspan="6">El curso no tiene materias en su plan de estudios.</td></tr>';
  return `<article class="report-card">
    <header class="letterhead">
      <h1>Boletín de calificaciones</h1>
      <p class="level">Nivel de educación ${LEVELS[course.educationLevel]}</p>
      <div class="details">
        <dl>
          <div><dt>Escuela</dt><dd>${escapeHtml(institution.name)}</dd></div>
          <div><dt>Estudiante</dt><dd>${escapeHtml(studentName)}</dd></div>
          <div><dt>DNI</dt><dd>${escapeHtml(formatDni(student.dni))}</dd></div>
        </dl>
        <dl>
          <div><dt>Ciclo lectivo</dt><dd>${course.schoolYear}</dd></div>
          <div><dt>Año y división</dt><dd>${escapeHtml(course.gradeName)} ${escapeHtml(course.division)}</dd></div>
          <div><dt>Turno</dt><dd>${SHIFTS[course.shift]}</dd></div>
        </dl>
      </div>
      <p class="institution-contact">CUIT ${escapeHtml(institution.cuit)} · ${escapeHtml(institution.street)} ${escapeHtml(institution.streetNumber)} · ${escapeHtml(institution.email)} · Tel. ${escapeHtml(institution.phone)}</p>
    </header>
    <table aria-label="Promedios por materia">
      <colgroup><col class="subject-column"></colgroup>
      <colgroup><col class="term-column" span="3"></colgroup>
      <colgroup><col class="annual-column"><col></colgroup>
      <thead>
        <tr>
          <th scope="col" rowspan="2">Materias</th>
          <th scope="colgroup" colspan="3">Calificaciones</th>
          <th scope="col" rowspan="2">Promedio anual</th>
          <th scope="col" rowspan="2">Observaciones</th>
        </tr>
        <tr>
          <th scope="col">1.º trimestre</th>
          <th scope="col">2.º trimestre</th>
          <th scope="col">3.º trimestre</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <footer>
      <p class="legend"><strong>Parcial</strong> indica que el promedio todavía puede cambiar.</p>
      <div class="observations"><h2>Observaciones generales</h2><div class="writing-line"></div></div>
      <div class="signatures">
        <div>Firma de la autoridad</div>
        <div>Sello de la institución</div>
      </div>
    </footer>
  </article>`;
}

function buildReportCardsHtml({ institution, course, reportCards }) {
  return `<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="utf-8">
  <title>Boletines de calificaciones · ${course.schoolYear}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 11mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #222; font: 9pt/1.25 Arial, sans-serif; }
    .report-card { border: .7pt solid #333; padding: 5mm; }
    .report-card + .report-card { break-before: page; }
    .letterhead { margin-bottom: 7pt; break-inside: avoid; overflow-wrap: anywhere; }
    h1 { margin: 0; font-size: 15pt; letter-spacing: .015em; text-transform: uppercase; }
    .level { margin: 2pt 0 7pt; font-size: 9pt; text-transform: uppercase; }
    .details { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 18pt; }
    dl { margin: 0; }
    dl > div { display: flex; align-items: baseline; gap: 5pt; margin-bottom: 3pt; }
    dt, h2 { flex-shrink: 0; font-size: 8pt; font-weight: 700; text-transform: uppercase; }
    dd { flex: 1; min-width: 0; margin: 0; padding: 0 3pt; border-bottom: .6pt dotted #555; }
    .institution-contact { margin: 2pt 0 0; font-size: 7.5pt; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; border: .9pt solid #333; break-after: avoid; }
    .subject-column { width: 25%; }
    .term-column, .annual-column { width: 12%; }
    th, td { padding: 3pt 5pt; border: .6pt solid #333; text-align: center; overflow-wrap: anywhere; }
    thead th { background: #f0f0f0; font-size: 8pt; text-transform: uppercase; }
    tbody tr { height: 19pt; }
    tbody th { text-align: left; font-weight: 400; }
    tr { break-inside: avoid; }
    .no-average, .partial { font-size: 7.5pt; color: #444; }
    footer { break-inside: avoid; }
    .legend { margin: 4pt 0 9pt; font-size: 7.5pt; }
    .observations { display: flex; align-items: baseline; gap: 6pt; }
    h2 { margin: 0; }
    .writing-line { flex: 1; border-bottom: .6pt dotted #555; }
    .signatures { display: flex; justify-content: space-around; gap: 20pt; margin-top: 28pt; }
    .signatures div { width: 32%; padding-top: 3pt; border-top: .6pt solid #333; text-align: center; font-size: 8pt; }
  </style>
</head>
<body>
  ${reportCards.map((card) => reportCard(card, institution, course)).join('\n')}
</body>
</html>`;
}

module.exports = { buildReportCardsHtml };
