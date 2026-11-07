// Componente global: nada de la vista se arrastra fuera de la ventana. Se carga primero en cada
// vista, antes que los demás componentes.
// Enlaces, imágenes e íconos no inician un arrastre (base.css les quita además el arrastre nativo).
// Sin esto, arrastrar una opción del menú lateral se llevaba la URL file:// de la vista, que soltada
// en un navegador la abría fuera de la aplicación.
// Los campos de texto conservan el arrastre de su texto: lo seleccionado se mueve dentro del campo o
// a otro. Lo que se suelta sobre la ventana no la navega (navigateOnDragDrop en main-window.js).
// Un arrastre propio de una vista marca su elemento con draggable="true". El editor de la foto de
// perfil mueve la imagen con eventos de puntero, no con arrastrar y soltar, así que no depende de esto.

(() => {
  // En captura: lo decide el elemento de origen, aunque la vista detenga la propagación. El origen
  // puede ser el texto seleccionado.
  window.addEventListener('dragstart', (event) => {
    const source = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (source?.closest(':read-write, [draggable="true"]')) return;
    event.preventDefault();
  }, true);
})();
