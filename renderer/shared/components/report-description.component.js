// Componente reutilizable: la descripción de un reporte del Administrador, una frase directa que
// dice qué muestra. Es el único lugar donde se escribe: la opción de la vista Reportes y el
// encabezado de cada reporte la toman de acá, para que no difieran.
// Uso: <report-description report="subject-coverage"></report-description>
//   - "report": subject-coverage | teacher-workload | backup-regularity.

(() => {
  const DESCRIPTIONS = {
    'subject-coverage': 'Consulta las materias de cada curso que no tienen docente asignado o que tienen un docente suspendido.',
    'teacher-workload': 'Consulta cuántas asignaciones tiene cada profesor en el ciclo lectivo, con el curso y la materia de cada una.',
    'backup-regularity': 'Consulta cuántos backups se hicieron en cada mes del ciclo lectivo y cuántos días pasaron desde el último.',
  };

  class ReportDescription extends HTMLElement {
    connectedCallback() {
      this.textContent = DESCRIPTIONS[this.getAttribute('report')] ?? '';
    }
  }

  customElements.define('report-description', ReportDescription);
})();
