// Vista Calificaciones de una evaluación (Profesor) — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Datos de la asignación y de la evaluación seleccionada ----------

  // La fila de Evaluaciones abre esta vista pasando los datos de la asignación y de
  // la evaluación en la URL; si se entra directamente se conservan los que ya trae
  // el HTML.
  const params = new URLSearchParams(window.location.search);

  const applyValue = (element) => {
    const value = params.get(element.dataset.field);
    if (value) element.textContent = value;
  };

  document.querySelectorAll('.summary-value[data-field]').forEach(applyValue);
  document.querySelectorAll('.breadcrumb-item[data-field]').forEach(applyValue);

  // ---------- Vuelta por el breadcrumb ----------

  // Las vistas anteriores solo encabezan la asignación, así que los enlaces de vuelta
  // conservan esos datos y descartan los de la evaluación.
  const ASSIGNMENT_FIELDS = ['course', 'level', 'subject', 'year'];

  const assignmentParams = new URLSearchParams();
  ASSIGNMENT_FIELDS.forEach((field) => {
    const value = params.get(field);
    if (value) assignmentParams.set(field, value);
  });

  const query = assignmentParams.toString();
  if (query) {
    document
      .querySelectorAll('.breadcrumb a[href*="assignment-management"], .breadcrumb a[href*="assignment-evaluations"]')
      .forEach((link) => {
        link.href = `${link.getAttribute('href')}?${query}`;
      });
  }

  // ---------- Calificación: numeric stepper ----------

  // La calificación se escribe en el campo o se ajusta con − y +, que restan o suman un
  // punto. Los límites de la escala (0 a 10) salen de aria-valuemin/aria-valuemax del
  // campo. Se aceptan enteros y decimales de hasta dos dígitos, con coma o punto como
  // separador; el valor final se muestra con coma.
  const SCORE_STEP = 1;

  // Hasta dos dígitos enteros y dos decimales. Admite el campo vacío y los estados
  // intermedios de la escritura ("7," o ",5").
  const SCORE_PATTERN = /^\d{0,2}([.,]\d{0,2})?$/;

  // Número que representa el texto del campo, o null si todavía no hay calificación
  const parseScore = (text) => {
    const number = Number(text.replace(',', '.'));
    return text === '' || Number.isNaN(number) ? null : number;
  };

  const formatScore = (number) => String(number).replace('.', ',');

  const initStepper = (stepper) => {
    const input = stepper.querySelector('.numeric-stepper-input');
    const [decrement, increment] = stepper.querySelectorAll('.numeric-stepper-btn');
    const min = Number(input.getAttribute('aria-valuemin'));
    const max = Number(input.getAttribute('aria-valuemax'));
    const clamp = (number) => Math.min(max, Math.max(min, number));
    let lastValid = input.value;

    // − y + se deshabilitan en los límites; aria-valuenow informa el valor a los
    // lectores de pantalla.
    const syncState = () => {
      const value = parseScore(input.value);
      decrement.disabled = value === null || value <= min;
      increment.disabled = value !== null && value >= max;
      if (value === null) {
        input.removeAttribute('aria-valuenow');
      } else {
        input.setAttribute('aria-valuenow', value);
      }
    };

    // Sin calificación, + parte del mínimo (el primer punto da 1)
    const step = (direction) => {
      if ((direction < 0 ? decrement : increment).disabled) return;
      const current = parseScore(input.value) ?? min;
      const next = clamp(Math.round((current + direction * SCORE_STEP) * 100) / 100);
      input.value = lastValid = formatScore(next);
      syncState();
    };

    // Lo escrito o pegado que no respeta el formato o supera el máximo se descarta y el
    // cursor vuelve a donde estaba.
    input.addEventListener('input', () => {
      const value = parseScore(input.value);
      if (SCORE_PATTERN.test(input.value) && (value === null || value <= max)) {
        lastValid = input.value;
      } else {
        const caret = input.selectionStart - (input.value.length - lastValid.length);
        input.value = lastValid;
        input.setSelectionRange(caret, caret);
      }
      syncState();
    });

    // Al salir del campo el valor queda en su forma final: "07," pasa a "7" y "7.5" a "7,5"
    input.addEventListener('blur', () => {
      const value = parseScore(input.value);
      input.value = lastValid = value === null ? '' : formatScore(clamp(value));
      syncState();
    });

    // Las flechas del teclado equivalen a − y +, como en un campo numérico nativo
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      step(event.key === 'ArrowUp' ? 1 : -1);
    });

    // Los botones quedan fuera del orden de tabulación (Tab recorre solo las
    // calificaciones) y no toman el foco: lo conserva el campo de la fila, así el borde
    // azul marca la calificación que se está editando.
    stepper.addEventListener('mousedown', (event) => {
      if (!event.target.closest('.numeric-stepper-btn')) return;
      event.preventDefault();
      input.focus();
    });

    decrement.addEventListener('click', () => step(-1));
    increment.addEventListener('click', () => step(1));

    syncState();
  };

  document.querySelectorAll('.numeric-stepper').forEach(initStepper);

  // ---------- Filtro: Alumno ----------

  // El filtro de Alumno vive en el encabezado de la tabla y lo gestiona el componente
  // compartido column-filter.js (mismo patrón usado en Alumnos de la asignación).
});
