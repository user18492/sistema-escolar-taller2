// Componente reutilizable: un promedio de las tablas (trimestral o anual), con su marca debajo.
// Uso: <term-average value="7.25" is-final></term-average>
//   - "value": el promedio como número ('7.25', con punto, como llega del proceso principal). Se
//     muestra en es-AR con dos decimales fijos (7,25). Sin el atributo, o vacío, no hay promedio:
//     se muestra una raya, con el title "Sin evaluaciones tomadas", y sin marca.
//   - "is-final": presente, la marca dice "Final" (el promedio ya no cambia); ausente, "Parcial".
// Los dos atributos se pueden cambiar después de insertarlo: se vuelve a dibujar.
// Estilos en term-average.css; la marca usa el texto secundario de .option-detail (dropdown.css),
// así que la vista enlaza las dos hojas.

(() => {
  const NO_VALUE_TITLE = 'Sin evaluaciones tomadas';
  const averageFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  class TermAverage extends HTMLElement {
    static get observedAttributes() {
      return ['value', 'is-final'];
    }

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    render() {
      const rawValue = this.getAttribute('value');
      const value = rawValue === null || rawValue === '' ? NaN : Number(rawValue);
      const valueElement = document.createElement('span');
      valueElement.className = 'term-average-value';
      if (Number.isNaN(value)) {
        valueElement.textContent = '—';
        this.title = NO_VALUE_TITLE;
        this.replaceChildren(valueElement);
        return;
      }
      this.removeAttribute('title');
      valueElement.textContent = averageFormat.format(value);
      const markElement = document.createElement('span');
      markElement.className = 'term-average-mark option-detail';
      markElement.textContent = this.hasAttribute('is-final') ? 'Final' : 'Parcial';
      this.replaceChildren(valueElement, markElement);
    }
  }

  customElements.define('term-average', TermAverage);
})();
