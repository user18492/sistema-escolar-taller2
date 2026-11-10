// Componente reutilizable: la descripción de un reporte (del Administrador, del Secretario o del
// Profesor), una frase directa que dice qué muestra. Es el único lugar donde se escribe: la opción de la vista Reportes y el
// encabezado de cada reporte la toman de acá, para que no difieran.
// Uso: <report-description report="subject-coverage"></report-description>
//   - "report": subject-coverage | teacher-workload | backup-regularity (Administrador) |
//     active-enrollments-by-course | students-without-enrollment | report-cards (Secretario) |
//     pending-scores | evaluation-failure-rates (Profesor).

(() => {
  const DESCRIPTIONS = {
    'subject-coverage': 'Consulta las materias de cada curso que no tienen docente asignado o que tienen un docente suspendido.',
    'teacher-workload': 'Consulta cuántas asignaciones tiene cada profesor en el ciclo lectivo, con el curso y la materia de cada una.',
    'backup-regularity': 'Consulta cuántos backups se hicieron en cada mes del ciclo lectivo y cuántos días pasaron desde el último.',
    'active-enrollments-by-course': 'Consulta la cantidad de inscripciones activas de cada curso en el ciclo lectivo actual.',
    'students-without-enrollment': 'Consulta qué alumnos activos todavía no tienen una inscripción activa en el ciclo lectivo actual.',
    'report-cards': 'Consulta los boletines de cada alumno o prepara un PDF con todo el curso.',
    'pending-scores': 'Consulta qué evaluaciones ya tomadas tienen alumnos sin nota y cuánto falta para que cierre su trimestre.',
    'evaluation-failure-rates': 'Identifica evaluaciones para revisar según la desaprobación y el avance de la carga de notas.',
  };

  class ReportDescription extends HTMLElement {
    connectedCallback() {
      this.textContent = DESCRIPTIONS[this.getAttribute('report')] ?? '';
    }
  }

  customElements.define('report-description', ReportDescription);
})();
