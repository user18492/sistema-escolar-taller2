// Componente reutilizable: card de contexto con los datos de la asignación seleccionada en las
// vistas del Profesor que se abren desde Asignaciones.
// Uso: <assignment-summary course="—" level="—" subject="—" year="—"></assignment-summary>
// Si además recibe "evaluation" y "evaluation-date", genera la variante en dos bloques
// (.assignment-summary-split): asignación a la izquierda y evaluación a la derecha.
// Los atributos son el texto de cada dato mientras no llega el real: una raya.
//   - loadAssignment(loadError): pide al proceso principal (window.api.teacherAssignments.getOwn)
//     la asignación elegida en Asignaciones, por el id que trae la URL de la vista
//     (?assignmentId=), y completa con ella los datos de la asignación. Resuelve la asignación, o
//     null si no existe o no está a cargo del profesor de la sesión, o si la carga falla: en ese
//     caso la tarjeta se oculta y el mensaje queda en "loadError", el .form-error de la vista.
//   - showEvaluation(evaluation): completa los datos de la evaluación en la variante en dos
//     bloques, con la que la vista ya cargó ({ title, evaluationDate }, con la fecha como
//     'AAAA-MM-DD', que se muestra DD/MM/AAAA).
// Estilos en assignment-summary.css.

(() => {
  const GENERIC_LOAD_ERROR = 'No se pudo cargar la asignación. Intentá nuevamente.';

  // Textos de Turno y Nivel educativo, los mismos del filtro Curso de Asignaciones, que estas
  // vistas no tienen. Llegan como MORNING o AFTERNOON y PRIMARY o SECONDARY.
  const SHIFT_LABELS = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
  const LEVEL_LABELS = { PRIMARY: 'Primaria', SECONDARY: 'Secundaria' };

  // Texto de cada dato de la asignación, por su data-field, como en la fila de Asignaciones: el
  // curso es "1° A · Mañana"
  const assignmentTexts = ({ course, subject }) => ({
    course: `${course.gradeName} ${course.division} · ${SHIFT_LABELS[course.shift] ?? course.shift}`,
    level: LEVEL_LABELS[course.educationLevel] ?? course.educationLevel,
    subject: subject.name,
    year: String(course.schoolYear),
  });

  const ASSIGNMENT_FIELDS = [
    { field: 'course', attribute: 'course', label: 'Curso' },
    { field: 'level', attribute: 'level', label: 'Nivel educativo' },
    { field: 'subject', attribute: 'subject', label: 'Materia' },
    { field: 'year', attribute: 'year', label: 'Ciclo lectivo' },
  ];

  const EVALUATION_FIELDS = [
    { field: 'evaluation', attribute: 'evaluation', label: 'Evaluación' },
    { field: 'date', attribute: 'evaluation-date', label: 'Fecha' },
  ];

  const itemsHtml = (fields) => fields.map(({ field, label }) => `<div class="summary-item">
              <span class="summary-label">${label}</span>
              <span class="summary-value text-truncate" data-field="${field}"></span>
            </div>`).join('\n');

  class AssignmentSummary extends HTMLElement {
    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      const isSplit = this.hasAttribute('evaluation');
      const fields = isSplit ? [...ASSIGNMENT_FIELDS, ...EVALUATION_FIELDS] : ASSIGNMENT_FIELDS;

      this.innerHTML = isSplit
        ? `<section class="card assignment-summary assignment-summary-split">
            <div class="summary-group">
              ${itemsHtml(ASSIGNMENT_FIELDS)}
            </div>
            <div class="summary-group">
              ${itemsHtml(EVALUATION_FIELDS)}
            </div>
          </section>`
        : `<section class="card assignment-summary">
            ${itemsHtml(ASSIGNMENT_FIELDS)}
          </section>`;

      fields.forEach(({ field, attribute }) => {
        this.querySelector(`.summary-value[data-field="${field}"]`).textContent = this.getAttribute(attribute);
      });
    }

    async loadAssignment(loadError) {
      // Sin id en la URL, o con uno que no es un número, el proceso principal responde que no pudo
      // identificar la asignación.
      const assignmentId = Number(new URLSearchParams(window.location.search).get('assignmentId'));
      let response;
      try {
        response = await window.api?.teacherAssignments?.getOwn(assignmentId);
      } catch (error) {
        console.error('Error al cargar la asignación:', error);
      }
      if (!response?.ok) {
        this.hidden = true;
        loadError.textContent = response?.error?.message || GENERIC_LOAD_ERROR;
        loadError.hidden = false;
        return null;
      }

      // Los datos de la base se asignan siempre con textContent, nunca como HTML.
      const texts = assignmentTexts(response.teacherAssignment);
      ASSIGNMENT_FIELDS.forEach(({ field }) => {
        this.querySelector(`.summary-value[data-field="${field}"]`).textContent = texts[field];
      });
      return response.teacherAssignment;
    }

    showEvaluation({ title, evaluationDate }) {
      const texts = { evaluation: title, date: evaluationDate.split('-').reverse().join('/') };
      EVALUATION_FIELDS.forEach(({ field }) => {
        this.querySelector(`.summary-value[data-field="${field}"]`).textContent = texts[field];
      });
    }
  }

  customElements.define('assignment-summary', AssignmentSummary);
})();
