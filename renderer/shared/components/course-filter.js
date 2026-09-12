// Componente reutilizable: filtro compuesto "Curso" para el encabezado de la tabla.
// Uso: <course-filter></course-filter> dentro de un .column-filter-panel, que ya se encarga de
// desplegarlo y aporta la acción "Limpiar filtro". Requiere cargar antes grade-dropdown.js.
// Tres categorías separadas por divisores:
//   - Grado: incrusta <grade-dropdown variant="panel"> tal cual (Todos / nivel educativo / grados).
//   - División: un único campo que solo admite letras A-Z, las pasa a mayúscula, las separa con
//     comas y descarta las repetidas.
//   - Turno: dos botones toggle no excluyentes; ambos activos equivale a no filtrar por turno.
// API para el contenedor: `hasSelection` indica si alguna categoría filtra y `clear()` las restablece.
// Sin shadow DOM, igual que <grade-dropdown>: reutiliza los estilos de la grilla de grados y de .field.

(() => {
  const SHIFTS = [
    { key: 'MORNING', label: 'Mañana' },
    { key: 'AFTERNOON', label: 'Tarde' },
  ];

  const DIVISION_SEPARATOR = ', ';

  // Cada instancia necesita ids propios para asociar los títulos con su categoría
  let instanceCount = 0;

  // Letras A-Z en mayúscula; cualquier otro carácter (separadores incluidos) se descarta
  const lettersOf = (text) => Array.from(text.toUpperCase().replace(/[^A-Z]/g, ''));

  // Posición del cursor en el texto formateado justo después de las primeras `count` divisiones
  const caretAfter = (count) => Math.max(0, count * (DIVISION_SEPARATOR.length + 1) - DIVISION_SEPARATOR.length);

  class CourseFilter extends HTMLElement {
    connectedCallback() {
      instanceCount += 1;
      const id = `course-filter-${instanceCount}`;
      const shiftsHtml = SHIFTS.map(
        (shift) =>
          `<button type="button" class="grade-card course-filter-shift" data-value="${shift.key}" aria-pressed="false">${shift.label}</button>`
      ).join('');

      this.innerHTML = `
        <div class="course-filter-section" role="group" aria-labelledby="${id}-grade">
          <span class="course-filter-title" id="${id}-grade">Grado</span>
          <grade-dropdown variant="panel"></grade-dropdown>
        </div>

        <div class="dropdown-divider" role="separator"></div>

        <div class="course-filter-section">
          <label class="course-filter-title" for="${id}-division">División</label>
          <div class="field course-filter-body">
            <input type="text" id="${id}-division" class="course-filter-division" placeholder="A, B, C, …" autocomplete="off" spellcheck="false" />
          </div>
        </div>

        <div class="dropdown-divider" role="separator"></div>

        <div class="course-filter-section" role="group" aria-labelledby="${id}-shift">
          <span class="course-filter-title" id="${id}-shift">Turno</span>
          <div class="course-filter-body course-filter-shifts">
            ${shiftsHtml}
          </div>
        </div>`;

      this.setupCourseFilter();
    }

    // Alguna categoría filtra: lo consulta el contenedor para marcar el filtro como activo.
    // Ambos turnos activos equivalen a no filtrar por turno.
    get hasSelection() {
      const selectedShifts = this.querySelectorAll('.course-filter-shift.selected').length;
      const filtersShift = selectedShifts > 0 && selectedShifts < SHIFTS.length;
      return Boolean(this.querySelector('grade-dropdown')?.hasSelection)
        || Boolean(this.querySelector('.course-filter-division')?.value)
        || filtersShift;
    }

    setupCourseFilter() {
      const gradeDropdown = this.querySelector('grade-dropdown');
      const divisionInput = this.querySelector('.course-filter-division');
      const shiftButtons = Array.from(this.querySelectorAll('.course-filter-shift'));
      // Divisiones vigentes, en el mismo orden en que se muestran en el campo
      let divisions = [];

      const setShiftPressed = (button, pressed) => {
        button.classList.toggle('selected', pressed);
        button.setAttribute('aria-pressed', String(pressed));
      };

      shiftButtons.forEach((button) => {
        button.addEventListener('click', () => setShiftPressed(button, !button.classList.contains('selected')));
      });

      divisionInput.addEventListener('input', (event) => {
        const typed = lettersOf(divisionInput.value);
        const lettersBeforeCaret = lettersOf(divisionInput.value.slice(0, divisionInput.selectionStart)).length;

        // Lo escrito se separa en lo que ya estaba (antes y después del cursor) y lo recién ingresado
        const suffix = typed.slice(lettersBeforeCaret);
        const prefixLimit = Math.min(lettersBeforeCaret, divisions.length - suffix.length);
        let prefixLength = 0;
        while (prefixLength < prefixLimit && typed[prefixLength] === divisions[prefixLength]) prefixLength += 1;
        const prefix = typed.slice(0, prefixLength);
        const inserted = typed.slice(prefixLength, lettersBeforeCaret);

        // Borrar solo un separador elimina también la división contigua en el sentido del borrado
        const onlySeparatorDeleted = event.inputType?.startsWith('delete') && typed.length === divisions.length;
        if (onlySeparatorDeleted) {
          if (event.inputType.includes('Forward')) suffix.shift();
          else prefix.pop();
        }

        // Las divisiones existentes se conservan; de lo ingresado solo se aceptan letras nuevas
        const existing = new Set([...prefix, ...suffix]);
        const accepted = [...new Set(inserted)].filter((letter) => !existing.has(letter));
        divisions = [...new Set([...prefix, ...accepted, ...suffix])];

        divisionInput.value = divisions.join(DIVISION_SEPARATOR);
        const caret = caretAfter(prefix.length + accepted.length);
        divisionInput.setSelectionRange(caret, caret);
      });

      // Restablece las tres categorías desde el contenedor (botón "Limpiar filtro" del encabezado)
      this.clear = () => {
        gradeDropdown.clear();
        divisions = [];
        divisionInput.value = '';
        shiftButtons.forEach((button) => setShiftPressed(button, false));
      };
    }
  }

  customElements.define('course-filter', CourseFilter);
})();
