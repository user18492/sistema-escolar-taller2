// Script que la suite inyecta en cada vista antes que los de la página (CDP
// Page.addScriptToEvaluateOnNewDocument, en el mundo de la página). No cambia la aplicación:
//   - reemplaza el portapapeles del renderer por uno de prueba (window.__suiteClipboard), así una
//     prueba nunca pisa el del usuario;
//   - avisa a la suite, con un console.debug marcado, de los estados de error que quedan a la vista:
//     toasts de error, mensajes de carga fallida (#…LoadError) y "No se pudo guardar".
(() => {
  const report = (kind, data) => console.debug(`[[suite:${kind}]]${JSON.stringify(data)}`);

  const writes = [];
  window.__suiteClipboard = writes;
  try {
    const clipboard = navigator.clipboard;
    const define = (name, value) => Object.defineProperty(clipboard, name, { value, configurable: true });
    define('writeText', async (text) => { writes.push(String(text)); });
    define('write', async () => { writes.push('[datos]'); });
    define('readText', async () => writes.at(-1) ?? '');
    define('read', async () => []);
  } catch (error) {
    report('harness', { message: `No se pudo reemplazar el portapapeles: ${error.message}` });
  }

  const reported = new WeakMap();
  const textOf = (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const once = (element, key, data) => {
    const previous = reported.get(element);
    if (previous === key) return;
    reported.set(element, key);
    report('ui-error', data);
  };

  const inspect = (element) => {
    if (!(element instanceof Element)) return;
    if (element.matches('.toast-error')) {
      once(element, 'toast', {
        kind: 'toast',
        title: element.querySelector('.toast-title')?.textContent ?? '',
        description: element.querySelector('.toast-description')?.textContent ?? '',
      });
    }
    if (element.id?.endsWith('LoadError') && !element.hidden && textOf(element)) {
      once(element, `load:${textOf(element)}`, { kind: 'load-error', id: element.id, text: textOf(element) });
    }
    if (element.matches('save-status') && element.dataset.state === 'error') {
      once(element, `save:${Date.now()}`, { kind: 'save-status', text: textOf(element) });
    }
  };

  const scan = (root) => {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element) inspect(root);
    root.querySelectorAll?.('.toast-error, [id$="LoadError"], save-status').forEach(inspect);
  };

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') inspect(mutation.target);
      else {
        mutation.addedNodes.forEach(scan);
        // Texto nuevo dentro de un mensaje de carga ya visible
        if (mutation.target instanceof Element && mutation.target.id?.endsWith('LoadError')) inspect(mutation.target);
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-state'] });
})();
