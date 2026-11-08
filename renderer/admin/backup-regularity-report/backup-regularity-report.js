// Reporte Regularidad de los backups (Administrador), abierto desde Reportes. Cuántos backups de la
// institución se hicieron en cada mes de un ciclo lectivo (window.api.reports.getBackupRegularity),
// como un gráfico de 12 columnas (chart.css), y arriba, en una card, cuántos días pasaron desde el
// último backup de la institución, que no depende del ciclo elegido.
// El ciclo lectivo es el actual por defecto, con el campo AAAA vacío, o el año completo que se
// escriba (shownSchoolYear, school-year.js): con cada cambio de la barra (column-filter.js), la vista
// vuelve a pedir el reporte con el año resuelto. Los meses que todavía no llegaron (en el ciclo
// actual, los posteriores al de hoy; en uno futuro, todos) se ven atenuados, sin el "0", para no
// confundirlos con meses sin backup; un mes pasado sin backups deja la columna vacía con el "0".
// Cada columna muestra su detalle como tooltip ("Marzo 2026: 2 backups" o "Mes futuro").

document.addEventListener('DOMContentLoaded', () => {
  const filterBar = document.querySelector('.report-filters');
  const lastBackupSummary = document.querySelector('.last-backup-summary');
  const lastBackupDate = document.querySelector('.last-backup-date');
  const card = document.querySelector('.backup-chart-card');
  const chart = card.querySelector('.backup-chart');
  const yAxis = chart.querySelector('.chart-y-axis');
  const gridlines = chart.querySelector('.chart-gridlines');
  const columns = chart.querySelector('.chart-bars');
  const labels = chart.querySelector('.chart-labels');
  const legend = card.querySelector('.chart-legend');
  const futureLegendItem = legend.querySelector('.legend-item-future');
  const message = card.querySelector('.backup-chart-message');
  const columnTemplate = document.getElementById('backupColumnTemplate');

  const GENERIC_LOAD_ERROR = 'No se pudo cargar el reporte. Intentá nuevamente.';
  const LAST_BACKUP_ERROR = 'No se pudo cargar el último backup.';
  const NO_BACKUPS = 'Todavía no se registró ningún backup';
  const EMPTY_VALUE = '—';
  const FUTURE_TITLE = 'Mes futuro';
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  // Cantidad máxima de tramos del eje: con más backups, las marcas saltan de a 2, 5, 10… y el eje
  // se extiende hasta la marca siguiente (como en Carga docente por profesor)
  const MAX_TICKS = 5;
  const TICK_STEPS = [1, 2, 5];

  // createdAt llega en ISO 8601 y se muestra en la hora local como DD/MM/AAAA hh:mm, el formato de
  // la vista Backup (admin/backups/backups.js)
  const dateTimeFormat = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const formatDateTime = (isoDateTime) => {
    const parts = Object.fromEntries(
      dateTimeFormat.formatToParts(new Date(isoDateTime)).map(({ type, value }) => [type, value])
    );
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
  };

  // El valor vigente que muestra el botón del filtro (report-filters.css)
  const yearFilterValue = filterBar.querySelector('[data-filter="year"] .report-filter-value');

  // El ciclo lectivo actual ({ year, today }): null hasta que llega
  let currentSchoolYear = null;
  // El año completo que filtra el campo AAAA ('' = el ciclo actual)
  let chosenYear = '';
  // Cada pedido lleva un número: si llega la respuesta de uno anterior al último, se descarta
  let requestNumber = 0;
  // true desde que se mostró el último backup una vez: después, los pedidos siguientes lo
  // actualizan sin volver a "Cargando…"
  let isLastBackupShown = false;

  // "Ciclo lectivo · 2026"
  const renderFilterValue = () => {
    yearFilterValue.textContent = currentSchoolYear
      ? String(shownSchoolYear(chosenYear, currentSchoolYear))
      : EMPTY_VALUE;
  };

  // ---------- Indicador del último backup ----------

  // "hoy", "hace 1 día", "hace 12 días"
  const daysAgoText = (days) => {
    if (days === 0) return 'hoy';
    return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  };

  // Los datos de la base se asignan siempre con textContent, nunca como HTML
  const renderLastBackup = (lastBackup) => {
    isLastBackupShown = true;
    if (!lastBackup) {
      lastBackupSummary.textContent = NO_BACKUPS;
      lastBackupDate.hidden = true;
      return;
    }
    lastBackupSummary.textContent = `Último backup: ${daysAgoText(lastBackup.daysAgo)}`;
    lastBackupDate.textContent = formatDateTime(lastBackup.createdAt);
    lastBackupDate.hidden = false;
  };

  // Si falla antes de mostrarse una vez; después queda el último que se mostró
  const showLastBackupError = () => {
    if (isLastBackupShown) return;
    lastBackupSummary.textContent = LAST_BACKUP_ERROR;
    lastBackupDate.hidden = true;
  };

  // ---------- Gráfico ----------

  // Cargando o error, en lugar del gráfico y su leyenda
  const showMessage = (text) => {
    message.textContent = text;
    message.hidden = false;
    chart.hidden = true;
    legend.hidden = true;
  };

  // Paso entre marcas: el menor de 1, 2, 5, 10, 20, 50… que deja a lo sumo MAX_TICKS tramos
  const tickStep = (max) => {
    for (let magnitude = 1; ; magnitude *= 10) {
      const step = TICK_STEPS.map((base) => base * magnitude).find((candidate) => max / candidate <= MAX_TICKS);
      if (step) return step;
    }
  };

  // El eje va de 0 a la mayor cantidad (al menos 1), extendido hasta la siguiente marca entera si
  // las marcas saltan de a más de 1
  const scaleOf = (months) => {
    const top = Math.max(1, ...months.map((month) => month.count));
    const step = tickStep(top);
    return { max: Math.ceil(top / step) * step, step };
  };

  const percentOf = (value, max) => `${(value / max) * 100}%`;

  // Las marcas del eje, de arriba (el máximo) a abajo (0), y una línea de la grilla por marca
  const renderScale = ({ max, step }) => {
    const marks = [];
    const lines = [];
    for (let value = max; value >= 0; value -= step) {
      const mark = document.createElement('span');
      mark.textContent = String(value);
      marks.push(mark);
      lines.push(document.createElement('span'));
    }
    yAxis.replaceChildren(...marks);
    gridlines.replaceChildren(...lines);
  };

  // "Marzo 2026: 2 backups", "Abril 2026: 1 backup"; "Mes futuro"
  const columnTitle = ({ month, count, future }, schoolYear) => {
    if (future) return FUTURE_TITLE;
    return `${MONTH_NAMES[month - 1]} ${schoolYear}: ${count} ${count === 1 ? 'backup' : 'backups'}`;
  };

  // La columna lleva el mes (1 a 12) en data-month. Un mes futuro no muestra su cantidad, salvo que
  // tenga backups.
  const createColumn = (month, schoolYear, scaleMax) => {
    const column = columnTemplate.content.firstElementChild.cloneNode(true);
    const height = percentOf(month.count, scaleMax);
    column.dataset.month = String(month.month);
    column.classList.toggle('is-future', month.future);
    column.title = columnTitle(month, schoolYear);
    column.setAttribute('aria-label', column.title);
    column.style.setProperty('--backup-bar-height', height);
    column.querySelector('.backup-bar').style.height = height;
    const value = column.querySelector('.backup-value');
    value.textContent = String(month.count);
    value.hidden = month.future && month.count === 0;
    return column;
  };

  const createLabel = (month) => {
    const label = document.createElement('span');
    label.className = 'chart-col-label';
    label.classList.toggle('is-future', month.future);
    label.textContent = MONTH_LABELS[month.month - 1];
    return label;
  };

  // Las columnas crecen desde la base en cada carga (chart.css): primero sin transición, para que
  // todas partan del mismo estado, y después con ella
  const playEntrance = () => {
    columns.classList.add('is-resetting');
    columns.classList.remove('is-loaded');
    void columns.offsetWidth; // aplica scaleY(0) de forma inmediata
    columns.classList.remove('is-resetting');
    void columns.offsetWidth; // reactiva la transición antes de animar
    columns.classList.add('is-loaded');
  };

  const renderChart = ({ schoolYear, months }) => {
    const scale = scaleOf(months);
    renderScale(scale);
    columns.replaceChildren(...months.map((month) => createColumn(month, schoolYear, scale.max)));
    labels.replaceChildren(...months.map(createLabel));
    futureLegendItem.hidden = !months.some((month) => month.future);
    message.hidden = true;
    chart.hidden = false;
    legend.hidden = false;
    playEntrance();
  };

  // Pide el reporte del ciclo vigente y lo muestra. Si en el medio llega otro cambio, la respuesta
  // de este pedido se descarta.
  async function loadReport() {
    const number = ++requestNumber;
    showMessage('Cargando reporte…');
    let response;
    try {
      response = await window.api?.reports?.getBackupRegularity({
        schoolYear: shownSchoolYear(chosenYear, currentSchoolYear),
      });
    } catch (error) {
      console.error('Error al cargar el reporte:', error);
    }
    if (number !== requestNumber) return;
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      showLastBackupError();
      return;
    }
    renderLastBackup(response.report.lastBackup);
    renderChart(response.report);
  }

  // El filtro avisa cada tecla (column-filter.js), aunque el año incompleto todavía no filtre: si
  // el año no cambió, el reporte queda como está. Antes de que llegue el ciclo actual, solo se
  // guarda el valor.
  filterBar.addEventListener('column-filter-change', (event) => {
    const { text } = event.detail;
    if (text === chosenYear) return;
    chosenYear = text;
    if (!currentSchoolYear) return;
    renderFilterValue();
    loadReport();
  });

  // Primero el ciclo lectivo actual, de la base: sin él no se sabe qué ciclo pedir
  (async () => {
    showMessage('Cargando reporte…');
    currentSchoolYear = await loadCurrentSchoolYear();
    if (!currentSchoolYear) {
      showMessage(GENERIC_LOAD_ERROR);
      showLastBackupError();
      return;
    }
    renderFilterValue();
    loadReport();
  })();
});
