// Conductor de la interfaz para las pruebas: entrada real de mouse y teclado (sendInputEvent e
// insertText, como un usuario) sobre la ventana de la aplicación, y esperas por el estado de la
// vista. Un clic que caería sobre otro elemento (un toast, un overlay que todavía se cierra) hace
// fallar la prueba: no se "arregla" con un clic por código.
const { sleep, waitUntil } = require('./app-harness');

const KEY_CODES = {
  Enter: { keyCode: 'Enter', char: '\r' },
  Tab: { keyCode: 'Tab' },
  Escape: { keyCode: 'Escape' },
  Backspace: { keyCode: 'Backspace' },
  Delete: { keyCode: 'Delete' },
  ArrowDown: { keyCode: 'Down' },
  ArrowUp: { keyCode: 'Up' },
  Space: { keyCode: 'Space', char: ' ' },
};

class Ui {
  constructor(harness, t) {
    this.harness = harness;
    this.t = t;
  }

  get webContents() {
    return this.harness.mainWindow.webContents;
  }

  js(code) {
    return this.webContents.executeJavaScript(code, true);
  }

  async waitFor(expression, { timeoutMs = 8000, message } = {}) {
    const ok = await waitUntil(() => this.js(`Boolean(${expression})`), timeoutMs);
    if (!ok && message) {
      await this.shot(`espera-${message}`);
      this.t.require(false, `${message} (esperado: ${expression})`);
    }
    return ok;
  }

  url() {
    return this.webContents.getURL();
  }

  // Ruta de la vista abierta dentro de renderer/ ('admin/users/index.html'), sin la consulta.
  view() {
    const match = decodeURIComponent(this.url()).replace(/\\/g, '/').match(/\/renderer\/([^?#]+)/);
    return match ? match[1] : null;
  }

  // Espera a que la ventana muestre `viewPath` (prefijo dentro de renderer/) y termine de cargar.
  async waitForView(viewPath, { timeoutMs = 10000 } = {}) {
    const ok = await waitUntil(() => (this.view() ?? '').startsWith(viewPath) && !this.webContents.isLoading(), timeoutMs);
    if (ok) await waitUntil(() => this.js(`document.readyState === 'complete'`), 5000);
    return ok;
  }

  // Navega como lo hace un enlace de la vista (pasa por la guardia de navegación). Devuelve la ruta
  // en la que quedó la ventana.
  async navigate(relativeToRenderer, { expect = relativeToRenderer.split('?')[0], timeoutMs = 10000 } = {}) {
    const marker = `__suiteNav${Date.now()}`;
    await this.js(`window.${marker} = true; window.location.assign(new URL(${JSON.stringify(relativeToRenderer)}, location.href.replace(/\\/renderer\\/.*$/, '/renderer/')).href); true`);
    await waitUntil(async () => !(await this.js(`Boolean(window.${marker})`)) && !this.webContents.isLoading(), timeoutMs);
    if (expect) await this.waitForView(expect, { timeoutMs });
    await this.idle();
    return this.view();
  }

  // Intenta una navegación que la guardia puede rechazar: devuelve la vista en la que quedó la
  // ventana y si sigue siendo el mismo documento (la navegación no se inició).
  async tryNavigate(relativeToRenderer, { waitMs = 400 } = {}) {
    // La guardia rechaza en will-navigate: si la navegación no empieza en `waitMs`, no empezó
    let started = false;
    const onStart = (details) => {
      if (details.isMainFrame) started = true;
    };
    this.webContents.on('did-start-navigation', onStart);
    try {
      await this.js(`window.__suiteSameDocument = true; window.location.assign(new URL(${JSON.stringify(relativeToRenderer)}, location.href.replace(/\\/renderer\\/.*$/, '/renderer/')).href); true`);
      await waitUntil(() => started, waitMs, 20);
    } finally {
      this.webContents.off('did-start-navigation', onStart);
    }
    if (started) await waitUntil(() => !this.webContents.isLoading(), 5000);
    const sameDocument = await this.js('Boolean(window.__suiteSameDocument)').catch(() => false);
    await this.idle();
    return { view: this.view(), sameDocument };
  }

  // Sin llamadas IPC en curso y con la vista cargada; después, una pausa breve para que la vista
  // dibuje lo que recibió.
  async idle({ quietMs = 150, timeoutMs = 10000 } = {}) {
    await waitUntil(() => !this.webContents.isLoading() && this.harness.monitor.pending().length === 0, timeoutMs, 30);
    await sleep(quietMs);
    await waitUntil(() => this.harness.monitor.pending().length === 0, timeoutMs, 30);
  }

  async exists(selector) {
    return this.js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  }

  async count(selector) {
    return this.js(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  async text(selector) {
    return this.js(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
  }

  async value(selector) {
    return this.js(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
  }

  // Centro visible del elemento y qué elemento recibe un clic ahí.
  async pointOf(selector, { scroll = true } = {}) {
    const found = await this.js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      if (${scroll}) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    })()`);
    if (!found) {
      await this.shot(`no-existe-${selector}`);
      this.t.require(false, `No existe en la vista: ${selector}`);
    }
    await sleep(60);
    return this.js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const top = document.elementFromPoint(x, y);
      const describe = (node) => node ? node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (typeof node.className === 'string' && node.className ? '.' + node.className.trim().split(/\\s+/).join('.') : '') : null;
      return { x: Math.round(x), y: Math.round(y), width: r.width, height: r.height, hit: Boolean(top) && (top === el || el.contains(top)), top: describe(top) };
    })()`);
  }

  // Clic real con el mouse en el centro del elemento.
  async click(selector, { scroll = true, wait = 120, clickCount = 1 } = {}) {
    const point = await this.pointOf(selector, { scroll });
    if (!point.hit || point.width === 0) {
      await this.shot(`clic-tapado-${selector}`);
      this.t.require(false, `El clic en ${selector} caería sobre ${point.top}`, point);
    }
    const { x, y } = point;
    this.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    this.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount });
    this.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount });
    await sleep(wait);
  }

  async press(key, { modifiers = [], wait = 80 } = {}) {
    const spec = KEY_CODES[key] ?? { keyCode: key, char: key.length === 1 ? key : undefined };
    this.webContents.sendInputEvent({ type: 'keyDown', keyCode: spec.keyCode, modifiers });
    if (spec.char && !modifiers.includes('control')) this.webContents.sendInputEvent({ type: 'char', keyCode: spec.char, modifiers });
    this.webContents.sendInputEvent({ type: 'keyUp', keyCode: spec.keyCode, modifiers });
    await sleep(wait);
  }

  // Escribe en el elemento con el foco, carácter por carácter.
  async type(text, { delay = 8 } = {}) {
    for (const char of text) {
      this.webContents.insertText(char);
      if (delay) await sleep(delay);
    }
    await sleep(40);
  }

  // Clic en el campo, borra lo que tenga (Ctrl+A y Retroceso) y escribe `text`.
  async fill(selector, text) {
    await this.click(selector);
    const focused = await this.js(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
    this.t.require(focused, `El campo ${selector} no tomó el foco con el clic`);
    await this.press('a', { modifiers: ['control'] });
    await this.press('Backspace');
    await this.type(text);
  }

  // Deja a la vista una opción de una lista con desplazamiento propio (sin mover la página) y la
  // elige con un clic real.
  async chooseOption(optionSelector) {
    await this.waitFor(`document.querySelector(${JSON.stringify(optionSelector)})`, { message: `No apareció la opción ${optionSelector}` });
    await this.js(`(() => {
      const option = document.querySelector(${JSON.stringify(optionSelector)});
      let box = option.parentElement;
      while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
      if (box && box !== document.documentElement && box !== document.body) {
        const o = option.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (o.top < b.top || o.bottom > b.bottom) box.scrollTop += o.top - b.top - (b.height - o.height) / 2;
      }
    })()`);
    await sleep(60);
    await this.click(optionSelector, { scroll: false });
  }

  // Un overlay de modal abierto (.is-open) y visible, o ya cerrado (visibility hidden al terminar
  // la transición: mientras tanto se traga los clics).
  async waitModal(overlaySelector, open, { timeoutMs = 8000 } = {}) {
    const expression = open
      ? `document.querySelector(${JSON.stringify(overlaySelector)})?.classList.contains('is-open') && getComputedStyle(document.querySelector(${JSON.stringify(overlaySelector)})).visibility === 'visible'`
      : `!document.querySelector(${JSON.stringify(overlaySelector)})?.classList.contains('is-open') && getComputedStyle(document.querySelector(${JSON.stringify(overlaySelector)})).visibility === 'hidden'`;
    return this.waitFor(expression, { timeoutMs, message: `El modal ${overlaySelector} no quedó ${open ? 'abierto' : 'cerrado'}` });
  }

  // Los toasts aparecen abajo a la derecha y tapan la paginación y las últimas acciones: se cierran
  // con su ✕ (clic real) antes de seguir.
  async dismissToasts() {
    for (let i = 0; i < 4; i += 1) {
      const open = await this.count('.toast:not(.is-leaving) .toast-close');
      if (!open) return;
      await this.click('.toast:not(.is-leaving) .toast-close', { scroll: false, wait: 50 });
    }
    await this.waitFor(`!document.querySelector('.toast')`, { timeoutMs: 3000 });
  }

  async toasts() {
    return this.js(`Array.from(document.querySelectorAll('.toast'), (toast) => ({
      type: toast.classList.contains('toast-error') ? 'error' : 'success',
      title: toast.querySelector('.toast-title')?.textContent ?? '',
    }))`);
  }

  shot(name) {
    return this.harness.shot(`${this.t.id}-${name}`);
  }
}

module.exports = { Ui };
