// Componente global: pestañas (tablist) que eligen lo que muestra una vista, p. ej. las filas de
// su tabla. Estilos en tab-list.css.
// Uso: incluir el script en la vista y escribir el marcado; no requiere registro ni llamadas
// desde la vista.
//   <div class="tab-list" role="tablist" aria-label="Usuarios vigentes o eliminados">
//     <button type="button" class="tab" role="tab" id="currentUsersTab" data-tab="current"
//       aria-selected="true" aria-controls="usersTabPanel">Vigentes <span class="tab-count"></span></button>
//     <button type="button" class="tab" role="tab" id="deletedUsersTab" data-tab="deleted"
//       aria-selected="false" aria-controls="usersTabPanel" tabindex="-1">Eliminados <span class="tab-count"></span></button>
//   </div>
//   <div id="usersTabPanel" role="tabpanel" aria-labelledby="currentUsersTab">…</div>
//   - La pestaña elegida lleva aria-selected="true"; las demás, aria-selected="false" y
//     tabindex="-1": Tab entra a la lista por la elegida, y las flechas izquierda y derecha, Inicio
//     y Fin pasan a otra, que queda elegida.
//   - Las pestañas comparten un único panel (aria-controls), cuyo contenido cambia la vista: su
//     aria-labelledby pasa a ser el id de la elegida.
//   - .tab-count (opcional): la vista escribe ahí la cantidad de cada pestaña; vacío no se muestra.
// Al elegir otra pestaña, el .tab-list emite tab-change (burbujea) con detail { tab }: el data-tab
// de la elegida. La vista lo escucha para mostrar su contenido. Elegir la que ya lo estaba no
// emite nada.

(() => {
  const TAB_SELECTOR = '.tab-list [role="tab"]';

  const tabsOf = (tab) => Array.from(tab.closest('.tab-list').querySelectorAll('[role="tab"]'));

  const selectTab = (tab) => {
    if (tab.getAttribute('aria-selected') === 'true') return;
    tabsOf(tab).forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
    });
    document.getElementById(tab.getAttribute('aria-controls'))?.setAttribute('aria-labelledby', tab.id);
    tab.closest('.tab-list').dispatchEvent(new CustomEvent('tab-change', { bubbles: true, detail: { tab: tab.dataset.tab } }));
  };

  // Por delegación: alcanza a las pestañas de cualquier vista sin registrarlas
  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.(TAB_SELECTOR);
    if (tab) selectTab(tab);
  });

  document.addEventListener('keydown', (event) => {
    const tab = event.target.closest?.(TAB_SELECTOR);
    if (!tab) return;
    const tabs = tabsOf(tab);
    const current = tabs.indexOf(tab);
    const target = {
      ArrowLeft: tabs[(current - 1 + tabs.length) % tabs.length],
      ArrowRight: tabs[(current + 1) % tabs.length],
      Home: tabs[0],
      End: tabs.at(-1),
    }[event.key];
    if (!target) return;
    event.preventDefault();
    target.focus();
    selectTab(target);
  });
})();
