document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const assignmentId = params.has('assignmentId') ? Number(params.get('assignmentId')) : null;
  const backLink = document.getElementById('backLink');
  const assignmentContext = document.getElementById('assignmentContext');
  const assignmentFilter = document.getElementById('assignmentFilter');
  const assignmentSelect = document.getElementById('assignmentSelect');
  const controls = document.getElementById('reportControls');
  const list = document.getElementById('followUpList');
  const rowTemplate = document.getElementById('followUpRow');
  const statusButtons = Array.from(controls.querySelectorAll('[data-status]'));
  const badge = controls.querySelector('follow-up-badge');
  const error = document.getElementById('followUpError');
  const statusMessage = document.getElementById('followUpStatus');

  const REASONS = { LOW: 'Desempeño bajo', DROP: 'Caída de desempeño' };
  const EMPTY = {
    PENDING: 'No hay alertas pendientes.',
    ATTENDED: 'No hay seguimientos atendidos.',
    RESOLVED: 'No hay seguimientos resueltos.',
  };
  const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
  const date = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' });
  const assignmentLabel = ({ course, subject }) =>
    `${subject.name} · ${courseLabel(course, { level: true, schoolYear: true })}`;

  let assignments = new Map();
  let cases = [];
  let status = 'PENDING';
  let saving = false;

  if (assignmentId !== null) {
    backLink.textContent = 'Gestión';
    backLink.href = `../assignment-management/index.html?${new URLSearchParams({ assignmentId })}`;
    assignmentFilter.hidden = true;
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  function createRow(entry) {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const fields = Object.fromEntries(Array.from(row.querySelectorAll('[data-field]'),
      (element) => [element.dataset.field, element]));
    const { recent, previous, scores } = entry.evidence;
    const name = `${entry.lastName}, ${entry.firstName}`;
    row.dataset.status = entry.status;
    fields.name.textContent = name;
    fields.assignment.textContent = assignmentLabel(assignments.get(entry.assignmentId));
    fields.assignment.hidden = assignmentId !== null;
    fields.reasons.textContent = entry.reasons.map((reason) => REASONS[reason]).join(' · ');

    const dates = [];
    if (entry.attendedAt) dates.push(`Última atención el ${date.format(new Date(entry.attendedAt))}`);
    if (entry.resolvedAt) dates.push(`Resuelto el ${date.format(new Date(entry.resolvedAt))}`);
    fields.dates.textContent = dates.join(' · ');
    fields.dates.hidden = dates.length === 0;

    const recentText = recent === null ? 'Datos insuficientes para el promedio reciente' : `Reciente ${number.format(recent)}`;
    const previousText = previous === null ? 'Datos insuficientes para comparar' : `Anterior ${number.format(previous)}`;
    fields.averages.textContent = `${recentText} · ${previousText} · Ver notas`;
    const scoreList = row.querySelector('.follow-up-scores');
    for (const score of scores) {
      const item = document.createElement('li');
      item.textContent = `${score.date.split('-').reverse().join('/')} · ${score.title} · ${number.format(score.grade)}`;
      scoreList.append(item);
    }
    if (!scores.length) {
      const item = document.createElement('li');
      item.textContent = 'No hay notas vigentes para mostrar.';
      scoreList.append(item);
    }

    const button = row.querySelector('.follow-up-action');
    button.hidden = entry.status === 'RESOLVED';
    const attended = entry.status === 'PENDING';
    button.textContent = attended ? 'Marcar como atendido' : 'Volver a pendientes';
    button.setAttribute('aria-label', `${button.textContent} — ${name}`);
    button.addEventListener('click', () => updateCase(entry, attended, button));
    return row;
  }

  function render(notice = '') {
    const selected = Number(assignmentSelect.value);
    const scopedCases = cases.filter((entry) => !selected || entry.assignmentId === selected);
    const visible = scopedCases.filter((entry) => entry.status === status);
    badge.setAttribute('count', scopedCases.filter((entry) => entry.status === 'PENDING').length);
    statusButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.status === status));
    });
    list.replaceChildren(...visible.map(createRow));
    statusMessage.textContent = [notice, visible.length ? '' : EMPTY[status]].filter(Boolean).join(' ');
    statusMessage.hidden = !statusMessage.textContent;
  }

  async function loadReport(notice) {
    let response;
    try {
      response = await window.api.reports.getStudentFollowUp({ assignmentId });
    } catch (loadError) {
      console.error('Error al cargar seguimientos:', loadError);
    }
    if (!response?.ok) {
      statusMessage.hidden = true;
      showError(response?.error?.message ?? 'No se pudieron cargar los seguimientos. Intentá nuevamente.');
      return false;
    }

    const report = response.report;
    assignments = new Map(report.assignments.map((assignment) => [assignment.id, assignment]));
    cases = report.cases.filter((entry) => assignments.has(entry.assignmentId));
    document.getElementById('passingGrade').textContent = number.format(report.passingGrade);

    if (assignmentId !== null) {
      assignmentContext.textContent = assignmentLabel(assignments.get(assignmentId));
    } else {
      const selected = assignmentSelect.value;
      const options = report.assignments.map((assignment) => new Option(assignmentLabel(assignment), assignment.id));
      assignmentSelect.replaceChildren(new Option('Todas mis asignaciones', ''), ...options);
      assignmentSelect.value = assignments.has(Number(selected)) ? selected : '';
    }
    controls.hidden = false;
    render(notice);
    return true;
  }

  async function updateCase(entry, attended, button) {
    if (saving) return;
    saving = true;
    button.setAttribute('aria-disabled', 'true');
    showError('');
    try {
      const response = await window.api.reports.setStudentFollowUpAttended({
        assignmentId: entry.assignmentId, caseId: entry.id, version: entry.version, attended,
      });
      const changed = response.error?.code === 'FOLLOW_UP_CHANGED';
      if (response.ok || changed) {
        const notice = response.ok ? (attended ? 'Seguimiento marcado como atendido.' : 'Seguimiento devuelto a pendientes.') : '';
        if (await loadReport(notice)) {
          statusButtons.find((filter) => filter.dataset.status === status).focus();
          if (changed) showError(response.error.message);
        }
      } else {
        showError(response.error.message);
      }
    } catch (saveError) {
      console.error('Error al actualizar el seguimiento:', saveError);
      showError('No se pudo actualizar el seguimiento. Intentá nuevamente.');
    } finally {
      saving = false;
      button.removeAttribute('aria-disabled');
    }
  }

  statusButtons.forEach((button) => button.addEventListener('click', () => {
    status = button.dataset.status;
    render();
  }));
  assignmentSelect.addEventListener('change', () => render());
  loadReport();
});
