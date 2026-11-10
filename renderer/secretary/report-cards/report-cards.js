document.addEventListener('DOMContentLoaded', () => {
  const filters = document.getElementById('courseFilters');
  const schoolYear = document.getElementById('schoolYear');
  const educationLevel = document.getElementById('educationLevel');
  const shift = document.getElementById('shift');
  const division = document.getElementById('division');
  const course = document.getElementById('course');
  const courseSummary = document.getElementById('courseSummary');
  const studentTable = document.getElementById('studentTable');
  const tbody = studentTable.querySelector('tbody');
  const rowTemplate = document.getElementById('studentRow');
  const rosterStatus = document.getElementById('rosterStatus');
  const pdfStatus = document.getElementById('pdfStatus');
  const reportError = document.getElementById('reportError');
  const printCourse = document.getElementById('printCourse');

  let courses = [];
  let rosterRequest = 0;
  let openingPdf = false;

  const formatDni = (dni) => dni.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const showMessage = (element, message = '') => {
    element.textContent = message;
    element.hidden = !message;
  };

  async function requestReport(action, payload, fallbackMessage) {
    try {
      const response = await window.api.reports[action](payload);
      if (response?.ok) return response.report;
      showMessage(reportError, response?.error?.message || fallbackMessage);
    } catch (error) {
      console.error(fallbackMessage, error);
      showMessage(reportError, fallbackMessage);
    }
    return null;
  }

  function updatePdfButtons() {
    [printCourse, ...tbody.querySelectorAll('button')].forEach((button) => {
      if (openingPdf) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    });
  }

  async function openPdf(courseId, enrollmentId = null) {
    if (openingPdf) return;
    openingPdf = true;
    updatePdfButtons();
    showMessage(reportError);
    showMessage(pdfStatus, 'Preparando PDF…');
    const report = await requestReport('openReportCards', { courseId, enrollmentId }, 'No se pudo abrir el PDF. Intentá nuevamente.');
    showMessage(pdfStatus, report ? 'PDF abierto en el visor del sistema. Desde allí podés imprimirlo o guardarlo.' : '');
    openingPdf = false;
    updatePdfButtons();
  }

  function studentRow({ enrollmentId, lastName, firstName, dni }, courseId) {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.cells[0].textContent = lastName;
    row.cells[1].textContent = firstName;
    row.cells[2].textContent = formatDni(dni);
    const button = row.querySelector('button');
    button.setAttribute('aria-label', `Ver boletín de ${firstName} ${lastName}`);
    button.addEventListener('click', () => openPdf(courseId, enrollmentId));
    return row;
  }

  function clearRoster(message) {
    rosterRequest += 1;
    tbody.replaceChildren();
    studentTable.hidden = true;
    printCourse.disabled = true;
    courseSummary.textContent = 'Seleccioná un curso para ver sus boletines.';
    showMessage(rosterStatus, message);
    showMessage(reportError);
    if (!openingPdf) showMessage(pdfStatus);
  }

  async function loadStudents() {
    const courseId = Number(course.value);
    clearRoster(courseId ? 'Cargando alumnos…' : 'Elegí un curso para continuar.');
    if (!courseId) return;

    const requestId = rosterRequest;
    let response;
    try {
      response = await window.api.reports.getReportCardStudents({ courseId });
    } catch (error) {
      console.error('No se pudieron cargar los alumnos.', error);
    }
    if (requestId !== rosterRequest) return;
    if (!response?.ok) {
      showMessage(rosterStatus);
      showMessage(reportError, response?.error?.message || 'No se pudieron cargar los alumnos. Intentá nuevamente.');
      return;
    }

    const { students } = response.report;
    const count = students.length;
    courseSummary.textContent = `${window.courseLabel(response.report.course, { level: true })} · ${count} ${count === 1 ? 'alumno' : 'alumnos'}`;
    if (!count) {
      showMessage(rosterStatus, 'El curso seleccionado no tiene alumnos para emitir boletines.');
      return;
    }
    tbody.replaceChildren(...students.map((student) => studentRow(student, courseId)));
    showMessage(rosterStatus);
    studentTable.hidden = false;
    printCourse.disabled = false;
    updatePdfButtons();
  }

  function updateCourses() {
    const matchingCourses = courses.filter((item) => item.schoolYear === Number(schoolYear.value)
      && (!educationLevel.value || item.educationLevel === educationLevel.value)
      && (!shift.value || item.shift === shift.value));
    const divisions = [...new Set(matchingCourses.map((item) => item.division))].sort();
    const selectedDivision = division.value;
    division.replaceChildren(new Option('Todas las divisiones', ''), ...divisions.map((letter) => new Option(letter, letter)));
    division.value = divisions.includes(selectedDivision) ? selectedDivision : '';

    const options = matchingCourses.filter((item) => !division.value || item.division === division.value);
    course.replaceChildren(new Option('Seleccioná un curso', ''), ...options.map((item) => (
      new Option(window.courseLabel(item, { level: true }), item.id)
    )));
    course.disabled = !options.length;
    clearRoster(options.length ? 'Elegí un curso para continuar.' : 'No hay cursos para los filtros seleccionados.');
  }

  [schoolYear, educationLevel, shift, division].forEach((select) => select.addEventListener('change', updateCourses));
  course.addEventListener('change', loadStudents);
  printCourse.addEventListener('click', () => openPdf(Number(course.value)));

  async function initialize() {
    const report = await requestReport('getReportCardCourses', undefined, 'No se pudieron cargar los cursos. Intentá nuevamente.');
    if (!report) {
      showMessage(rosterStatus);
      return;
    }
    const { currentSchoolYear } = report;
    courses = report.courses;
    const years = [...new Set([currentSchoolYear, ...courses.map((item) => item.schoolYear)])].sort((a, b) => b - a);
    schoolYear.replaceChildren(...years.map((year) => new Option(year === currentSchoolYear ? `${year} · Actual` : year, year)));
    schoolYear.value = currentSchoolYear;
    filters.disabled = false;
    updateCourses();
  }

  initialize();
});
