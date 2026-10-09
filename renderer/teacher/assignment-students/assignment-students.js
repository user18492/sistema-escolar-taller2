// Vista Alumnos de una asignación (Profesor): la tarjeta superior muestra el curso, el nivel
// educativo, la materia y el ciclo lectivo de la asignación elegida en Asignaciones, que
// <assignment-summary> le pide al proceso principal con el id que trae la URL (?assignmentId=).
// Hasta que llegan, cada dato muestra una raya.
// Si la asignación no existe o no está a cargo del profesor de la sesión, o si la carga falla, la
// tarjeta y la tabla se ocultan y queda solo el mensaje de error.
// La tabla muestra las inscripciones del curso de esa asignación, en cualquier estado, que llegan
// del proceso principal (window.api.enrollments.listByOwnAssignment) con el mismo id, y el filtro
// Alumno, con una opción por inscripción, las filtra en memoria. La lista filtrada se pagina en
// memoria, 10 por página, con <table-pagination>.

document.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('assignment-summary');
  const studentsCard = document.querySelector('.students-card');
  const loadError = document.getElementById('assignmentLoadError');

  // ---------- Datos de la asignación seleccionada ----------

  // Si la asignación no llega, tampoco hay alumnos que mostrar.
  summary.loadAssignment(loadError).then((assignment) => {
    if (!assignment) studentsCard.hidden = true;
  });

  // El enlace de vuelta a Gestión conserva el id de la asignación, con el que esa vista la carga.
  const assignmentId = new URLSearchParams(window.location.search).get('assignmentId');
  if (assignmentId) {
    const query = new URLSearchParams({ assignmentId }).toString();
    const managementLink = document.querySelector('.breadcrumb a[href*="assignment-management"]');
    if (managementLink) managementLink.href = `${managementLink.getAttribute('href')}?${query}`;
  }

  // ---------- Tabla: inscripciones del curso de la asignación ----------

  const table = studentsCard.querySelector('.data-table');
  const tbody = table.tBodies[0];
  const rowTemplate = document.getElementById('enrollmentRowTemplate');
  const studentOptionTemplate = document.getElementById('studentOptionTemplate');
  // El script del componente se carga sin defer en <head>: acá ya está definido y conectado
  const pagination = studentsCard.querySelector('table-pagination');
  const studentHeader = table.querySelector('th[data-filter="student"]');

  const GENERIC_LOAD_ERROR = 'No se pudieron cargar los alumnos. Intentá nuevamente.';

  // En el orden en que llegan del proceso principal: por alumno
  let enrollments = [];
  // La inscripción elegida en el filtro Alumno, por su id. Vacío (nada elegido) no filtra.
  let selectedEnrollmentIds = [];

  // Cargando, error o sin resultados, en una única fila de todo el ancho
  const showMessage = (message) => {
    const row = document.createElement('tr');
    const cell = row.insertCell();
    cell.colSpan = table.tHead.rows[0].cells.length;
    cell.className = 'table-message';
    cell.textContent = message;
    tbody.replaceChildren(row);
  };

  // "Apellido, Nombre"
  const studentName = ({ firstName, lastName }) => `${lastName}, ${firstName}`;
  // La fecha llega como 'AAAA-MM-DD' y se muestra como DD/MM/AAAA
  const toDisplayDate = (isoDate) => isoDate.split('-').reverse().join('/');

  // Los datos de la base se asignan siempre con textContent, nunca como HTML. El número de
  // inscripción llega armado del proceso principal y la fila lleva el inscripcion_id en
  // data-enrollment-id.
  const createRow = ({ id, number, enrollmentDate, student }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.enrollmentId = String(id);
    row.cells[0].textContent = number;
    row.cells[1].querySelector('.text-truncate').textContent = studentName(student);
    row.cells[2].textContent = formatDni(student.dni);
    row.cells[3].textContent = toDisplayDate(enrollmentDate);
    return row;
  };

  // El alumno y, como referencia, su número de inscripción: el buscador del panel encuentra la
  // opción por cualquiera de los dos
  const createStudentOption = ({ id, number, student }) => {
    const option = studentOptionTemplate.content.firstElementChild.cloneNode(true);
    option.dataset.value = String(id);
    option.querySelector('.option-name').textContent = studentName(student);
    option.querySelector('.option-detail').textContent = number;
    return option;
  };

  // Opciones de Alumno: una por inscripción, en el orden de la tabla y antes de .dropdown-empty;
  // column-filter.js las lee al usarlas.
  const fillFilterOptions = () => {
    const studentList = studentHeader.querySelector('[role="listbox"]');
    studentList.replaceChildren(...enrollments.map(createStudentOption), studentList.querySelector('.dropdown-empty'));
  };

  // Muestra la página `page` (por defecto, la actual) de las inscripciones que pasan el filtro (10
  // por página, en memoria): el total y los números de página salen de esa lista filtrada. Al
  // cambiar el filtro se vuelve a la página 1.
  const renderRows = ({ page } = {}) => {
    const visibleEnrollments = selectedEnrollmentIds.length
      ? enrollments.filter(({ id }) => selectedEnrollmentIds.includes(String(id)))
      : enrollments;
    const pageEnrollments = pagination.slice(visibleEnrollments, { page });
    if (pageEnrollments.length) tbody.replaceChildren(...pageEnrollments.map(createRow));
    else showMessage('No hay alumnos inscriptos en este curso.');
  };

  // Pide la lista con el id de la URL, a la par de la tarjeta, y al llegar arma las opciones de
  // Alumno y muestra las inscripciones. Sin id en la URL, o con uno que no es un número, el proceso
  // principal responde que no pudo identificar la asignación.
  async function loadEnrollments() {
    showMessage('Cargando alumnos…');
    let response;
    try {
      response = await window.api?.enrollments?.listByOwnAssignment(Number(assignmentId));
    } catch (error) {
      console.error('Error al cargar los alumnos:', error);
    }
    if (!response?.ok) {
      showMessage(response?.error?.message || GENERIC_LOAD_ERROR);
      return;
    }
    enrollments = response.enrollments;
    fillFilterOptions();
    renderRows();
  }

  // El filtro de Alumno avisa sus cambios (column-filter.js). Si lo que filtra no cambió ("Limpiar
  // filtro" sin nada elegido), la tabla y la página quedan como están; eso incluye a los avisos
  // previos a la carga, cuando todavía no hay opciones que elegir.
  table.tHead.addEventListener('column-filter-change', (event) => {
    const { values } = event.detail;
    if (String(values) === String(selectedEnrollmentIds)) return;
    selectedEnrollmentIds = values;
    renderRows({ page: 1 });
  });

  // Previo, Siguiente o un número: el componente ya marcó la página nueva. Solo responde con la
  // lista ya cargada, que es cuando deja de ser estático.
  pagination.addEventListener('page-change', () => renderRows());

  loadEnrollments();
});
