// Componente reutilizable: el nombre de un trimestre del ciclo lectivo ("1° trimestre"), con el
// mismo símbolo ° que los grados ("1° B"). Es el único lugar donde se arma ese nombre: toda vista
// que muestre un trimestre (encabezados, filtros, mensajes) lo toma de acá.
// Uso en HTML: <term-label term="1"></term-label>
//   - "term": el número del trimestre (1, 2 o 3), como el `term` que llega del proceso principal.
//     Se puede cambiar después de insertarlo: se vuelve a dibujar.
// Uso en JS: window.termLabel(2) devuelve "2° trimestre".

(() => {
  const termLabel = (term) => `${term}° trimestre`;

  class TermLabel extends HTMLElement {
    static get observedAttributes() {
      return ['term'];
    }

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    render() {
      this.textContent = termLabel(this.getAttribute('term') ?? '');
    }
  }

  window.termLabel = termLabel;
  customElements.define('term-label', TermLabel);
})();
