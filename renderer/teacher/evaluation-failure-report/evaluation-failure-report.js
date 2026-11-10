document.addEventListener('DOMContentLoaded', () => {
  const controls = document.querySelector('.failure-controls');
  const yearFilter = document.getElementById('schoolYear');
  const termFilter = document.getElementById('term');
  const courseFilter = document.getElementById('course');
  const criteriaForm = document.querySelector('.failure-criteria');
  const summary = document.querySelector('.failure-summary');
  const summaryTiles = [...summary.querySelectorAll('.summary-tile')];
  const results = document.getElementById('results');
  const message = results.querySelector('.report-message');
  const tbody = results.querySelector('tbody');
  const pagination = results.querySelector('table-pagination');
  const template = document.getElementById('evaluationRowTemplate');
  const query = new URLSearchParams(location.search);
  const percent = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 1 });
  const statusLabels = {
    review: 'Revisar',
    incomplete: 'Carga insuficiente',
    ungraded: 'Sin notas',
    regular: 'Bajo el umbral',
  };
  const statusOrder = ['review', 'incomplete', 'ungraded', 'regular'];
  const hasInsufficientData = ({ status }) => status === 'incomplete' || status === 'ungraded';

  let criteria;
  let selectedStatus = 'all';
  let evaluations = [];
  let loaded = false;
  let requestId = 0;

  function readCriteria() {
    return Object.fromEntries(['failure', 'minimum', 'coverage'].map((key) => [
      key, criteriaForm.elements.namedItem(key).valueAsNumber,
    ]));
  }

  function restoreCriteria() {
    for (const input of criteriaForm.querySelectorAll('input')) {
      if (!query.has(input.name)) continue;
      input.value = query.get(input.name);
      if (!input.validity.valid) input.value = input.defaultValue;
    }
    criteria = readCriteria();
    if (summaryTiles.some((tile) => tile.dataset.status === query.get('status'))) {
      selectedStatus = query.get('status');
    }
  }

  function getMetrics(evaluation) {
    const { failedCount, gradedCount, studentCount } = evaluation;
    const failureRate = gradedCount ? failedCount / gradedCount : null;
    const coverage = studentCount ? gradedCount / studentCount : null;
    let status = 'ungraded';
    if (gradedCount) {
      if (gradedCount < criteria.minimum || gradedCount * 100 < criteria.coverage * studentCount) {
        status = 'incomplete';
      } else {
        status = failedCount * 100 >= criteria.failure * gradedCount ? 'review' : 'regular';
      }
    }
    return { ...evaluation, failureRate, coverage, status };
  }

  function createRow(evaluation, reportQuery) {
    const row = template.content.firstElementChild.cloneNode(true);
    const setText = (selector, value) => { row.querySelector(selector).textContent = value; };
    row.dataset.evaluationId = evaluation.id;
    row.dataset.status = evaluation.status;
    setText('.evaluation-title', evaluation.title);
    setText('.evaluation-subject', evaluation.subjectName);
    setText('.evaluation-course', courseLabel(evaluation.course, { level: true }));
    const time = row.querySelector('time');
    time.dateTime = evaluation.evaluationDate;
    time.textContent = evaluation.evaluationDate.split('-').reverse().join('/');
    row.querySelector('term-label').setAttribute('term', evaluation.term);

    setText('.failure-rate', evaluation.failureRate === null ? '—' : percent.format(evaluation.failureRate));
    setText('.coverage-rate', evaluation.coverage === null ? '' : percent.format(evaluation.coverage));
    setText('.coverage-count', `${evaluation.gradedCount} de ${evaluation.studentCount}`);
    setText('.passed-count', `${evaluation.passedCount} aprobados`);
    setText('.failed-count', `${evaluation.failedCount} desaprobados`);
    setText('.pending-count', `${evaluation.pendingCount} sin nota`);
    const failureBar = row.querySelector('.failure-bar');
    failureBar.hidden = evaluation.failureRate === null;
    failureBar.value = (evaluation.failureRate ?? 0) * 100;
    const coverageBar = row.querySelector('.coverage-bar');
    coverageBar.hidden = evaluation.coverage === null;
    coverageBar.value = (evaluation.coverage ?? 0) * 100;
    setText('.failure-badge', statusLabels[evaluation.status]);
    row.querySelector('.provisional').hidden = !evaluation.isProvisional;

    const link = row.querySelector('.manage-link');
    const params = new URLSearchParams({
      assignmentId: evaluation.teacherAssignmentId,
      evaluationId: evaluation.id,
      failureReport: reportQuery,
    });
    link.setAttribute('href', `${link.getAttribute('href')}?${params}`);
    link.setAttribute('aria-label', `Ver notas de ${evaluation.title}`);
    return row;
  }

  function showMessage(text) {
    message.textContent = text;
    message.hidden = !text;
    results.classList.toggle('has-no-data', Boolean(text));
  }

  function renderRows(page = 1) {
    if (!loaded) return;
    const reportQuery = new URLSearchParams({
      schoolYear: yearFilter.value,
      term: termFilter.value,
      course: courseFilter.value,
      status: selectedStatus,
      ...criteria,
    }).toString();
    history.replaceState(null, '', `?${reportQuery}`);

    const filtered = evaluations.filter((evaluation) =>
      (!termFilter.value || evaluation.term === Number(termFilter.value)) &&
      (!courseFilter.value || evaluation.course.id === Number(courseFilter.value))
    ).map(getMetrics);
    const forReview = filtered.filter(({ status }) => status === 'review');
    const insufficient = filtered.filter(hasInsufficientData);
    const groups = { all: filtered, review: forReview, incomplete: insufficient };
    for (const tile of summaryTiles) {
      const status = tile.dataset.status;
      tile.setAttribute('aria-pressed', String(status === selectedStatus));
      tile.querySelector('.summary-count').textContent = groups[status].length;
    }
    const visible = groups[selectedStatus].sort((a, b) =>
      statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) ||
      (b.failureRate ?? -1) - (a.failureRate ?? -1)
    );
    const items = pagination.slice(visible, { page });
    tbody.replaceChildren(...items.map((evaluation) => createRow(evaluation, reportQuery)));
    showMessage(visible.length ? '' : 'No hay evaluaciones que coincidan con los filtros.');
  }

  async function loadReport(courseId = '') {
    const request = ++requestId;
    loaded = false;
    summary.hidden = true;
    courseFilter.disabled = true;
    showMessage('Cargando evaluaciones…');
    let response;
    try {
      response = await window.api.reports.getEvaluationFailureRates({ schoolYear: Number(yearFilter.value) });
    } catch (error) {
      console.error('Error al cargar el reporte de evaluaciones:', error);
    }
    if (request !== requestId) return;
    if (!response?.ok) {
      showMessage(response?.error?.message ?? 'No se pudo cargar el reporte. Intentá nuevamente.');
      return;
    }

    evaluations = response.report.evaluations;
    const courses = new Map(evaluations.map(({ course }) => [course.id, courseLabel(course, { level: true })]));
    const courseOptions = [...courses].sort((a, b) => a[1].localeCompare(b[1], 'es-AR', { numeric: true }));
    courseFilter.replaceChildren(new Option('Todos', ''), ...courseOptions.map(([id, label]) => new Option(label, id)));
    courseFilter.value = courses.has(Number(courseId)) ? courseId : '';
    courseFilter.disabled = false;
    document.getElementById('passingGrade').textContent = response.report.passingGrade;
    loaded = true;
    summary.hidden = false;
    renderRows();
  }

  yearFilter.addEventListener('change', () => loadReport());
  termFilter.addEventListener('change', () => renderRows());
  courseFilter.addEventListener('change', () => renderRows());
  pagination.addEventListener('page-change', ({ detail }) => renderRows(detail.page));
  criteriaForm.addEventListener('submit', (event) => {
    event.preventDefault();
    criteria = readCriteria();
    renderRows();
  });
  for (const tile of summaryTiles) {
    tile.addEventListener('click', () => {
      selectedStatus = tile.dataset.status;
      renderRows();
    });
  }

  async function initialize() {
    restoreCriteria();
    const [currentYear, assignments] = await Promise.all([
      loadCurrentSchoolYear(),
      window.api.teacherAssignments.listOwn(),
    ]);
    if (!currentYear || !assignments.ok) {
      showMessage('No se pudieron cargar los ciclos lectivos.');
      return;
    }
    const years = new Set([currentYear.year, ...assignments.teacherAssignments.map(({ course }) => course.schoolYear)]);
    yearFilter.replaceChildren(...[...years].sort((a, b) => b - a).map((year) => new Option(year, year)));
    const requestedYear = Number(query.get('schoolYear'));
    yearFilter.value = years.has(requestedYear) ? requestedYear : currentYear.year;
    const requestedTerm = query.get('term');
    if (['1', '2', '3'].includes(requestedTerm)) termFilter.value = requestedTerm;
    controls.hidden = false;
    await loadReport(query.get('course'));
  }

  initialize().catch((error) => {
    console.error('Error al iniciar el reporte de evaluaciones:', error);
    showMessage('No se pudo cargar el reporte. Intentá nuevamente.');
  });
});
