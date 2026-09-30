// Componente reutilizable: card de contexto con los datos de la asignación seleccionada en las
// vistas del Profesor que se abren desde Asignaciones.
// Uso: <assignment-summary course="1° A · Mañana" level="Primaria" subject="Matemática" year="2026"></assignment-summary>
// Si además recibe "evaluation", "evaluation-type" y "evaluation-date", genera la variante en dos
// bloques (.assignment-summary-split): asignación a la izquierda y evaluación a la derecha.
// Cada vista reemplaza los valores con los que llegan por URL mediante
// .summary-value[data-field], así que los data-field se mantienen.
// Estilos en assignment-summary.css.

(() => {
  const ASSIGNMENT_FIELDS = [
    { field: 'course', attribute: 'course', label: 'Curso' },
    { field: 'level', attribute: 'level', label: 'Nivel educativo' },
    { field: 'subject', attribute: 'subject', label: 'Materia' },
    { field: 'year', attribute: 'year', label: 'Ciclo lectivo' },
  ];

  const EVALUATION_FIELDS = [
    { field: 'evaluation', attribute: 'evaluation', label: 'Evaluación' },
    { field: 'type', attribute: 'evaluation-type', label: 'Tipo' },
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
  }

  customElements.define('assignment-summary', AssignmentSummary);
})();
