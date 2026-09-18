// Componente global: tooltip de los textos truncados (.text-truncate, ver base.css).
// Uso: incluir el script en la vista y marcar el texto con .text-truncate; no requiere
// registro ni llamadas desde la vista.
// Al pasar el cursor por un texto recortado con "..." se muestra su valor completo como
// tooltip; si el texto entra completo no se muestra nada. Se evalúa en cada paso del
// cursor, así que refleja el ancho actual del contenedor y alcanza también al contenido
// que la vista agrega o cambia después de cargar (filas, opciones, valores elegidos) y a
// los paneles promovidos al top layer (filtros de columna, menús de los modales).
// El recorte es solo visual: el texto completo sigue en el DOM para los lectores de pantalla.

(() => {
  const TRUNCATE_SELECTOR = '.text-truncate';

  const isTruncated = (element) => element.scrollWidth > element.clientWidth;

  // El valor en una sola línea, aunque el marcado lo reparta en varias
  const fullText = (element) => element.textContent.replace(/\s+/g, ' ').trim();

  document.addEventListener('mouseover', (event) => {
    const text = event.target.closest?.(TRUNCATE_SELECTOR);
    if (!text) return;

    if (isTruncated(text)) {
      text.title = fullText(text);
    } else {
      text.removeAttribute('title');
    }
  });
})();
