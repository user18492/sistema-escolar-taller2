// Capa ui: arrastrar y soltar con la ventana. Ningún enlace, imagen o ícono de las vistas se arrastra
// fuera de la ventana (drag-guard.component.js y base.css), lo que se suelta sobre ella no cambia la
// vista (navigateOnDragDrop en main-window.js) y el proceso principal no abre marcos ni ventanas
// nuevas (navigation-guard.js). El texto de los campos se sigue arrastrando y soltando, y la
// navegación con el menú lateral sigue andando.
// Los arrastres van por CDP: Input.setInterceptDrags entrega lo que Chromium arrastraría fuera de la
// ventana en lugar de iniciar el arrastre del sistema, e Input.dispatchDragEvent suelta datos (un
// enlace, un archivo) como si vinieran de otra aplicación.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow } = require('electron');
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { PATHS } = require('../config');
const { loginViaUi, openFromSidebar } = require('./helpers');
const { sleep } = require('../lib/electron/app-harness');

// Copiar, enlazar y mover: lo que ofrece un arrastre desde otra aplicación.
const ALL_OPERATIONS = 1 | 2 | 16;

const viewUrl = (viewPath) => pathToFileURL(path.join(PATHS.renderer, ...viewPath.split('/'))).href;

// Arrastre real con el botón izquierdo desde `point`: presiona, se mueve 80 px en pasos y suelta.
// Devuelve lo que Chromium habría arrastrado fuera de la ventana (los tipos de datos), o null si no
// se inició ningún arrastre.
async function dragFrom(t, point) {
  const cdp = t.ui.webContents.debugger;
  let intercepted = null;
  const onMessage = (_event, method, params) => {
    if (method === 'Input.dragIntercepted') intercepted = params.data;
  };
  cdp.on('message', onMessage);
  await cdp.sendCommand('Input.setInterceptDrags', { enabled: true });
  try {
    const mouse = (type, x, y, buttons) => cdp.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
    await mouse('mouseMoved', point.x, point.y, 0);
    await mouse('mousePressed', point.x, point.y, 1);
    for (let step = 1; step <= 8; step += 1) {
      await mouse('mouseMoved', point.x + step * 10, point.y + step * 4, 1);
      await sleep(15);
    }
    await sleep(120);
    if (intercepted) {
      // El arrastre quedó en curso dentro de la vista: se cancela, como un Escape fuera de la ventana.
      await cdp.sendCommand('Input.dispatchDragEvent', { type: 'dragCancel', x: point.x + 80, y: point.y + 32, data: intercepted });
    }
    await mouse('mouseReleased', point.x + 80, point.y + 32, 0);
    await sleep(60);
  } finally {
    await cdp.sendCommand('Input.setInterceptDrags', { enabled: false });
    cdp.off('message', onMessage);
  }
  return intercepted ? intercepted.items.map((item) => item.mimeType) : null;
}

// Enlaces, imágenes e íconos a la vista y sin tapar, con el punto donde se los presiona. Un ícono
// (svg) se presiona en su centro, que dentro de un enlace también es el enlace.
function draggableCandidates(t) {
  return t.ui.js(`(() => {
    const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + (el.getAttribute('href') ? '[href=' + el.getAttribute('href') + ']' : '')
      + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    return Array.from(document.querySelectorAll('a, img, svg'))
      .filter((el) => !el.parentElement.closest('svg'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height / 2);
        const top = r.width > 0 && r.height > 0 ? document.elementFromPoint(x, y) : null;
        return { name: describe(el), x, y, hit: Boolean(top) && (top === el || el.contains(top)) };
      })
      .filter((c) => c.hit && c.x >= 0 && c.y >= 0 && c.x < innerWidth - 90 && c.y < innerHeight - 40);
  })()`);
}

// `seen`: los ya probados en otra vista (el menú lateral se repite) no se vuelven a probar.
async function expectNoDragOut(t, viewName, seen) {
  const candidates = await draggableCandidates(t);
  t.check(candidates.length > 0, `${viewName}: no hay enlaces, imágenes ni íconos a la vista para probar`);
  for (const candidate of candidates) {
    const key = `${candidate.name}@${candidate.x},${candidate.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const view = t.ui.view();
    const dragged = await dragFrom(t, candidate);
    t.check(dragged === null, `${viewName}: ${candidate.name} se arrastra fuera de la ventana`, dragged);
    t.equal(t.ui.view(), view, `${viewName}: arrastrar ${candidate.name} no cambia la vista`);
  }
}

// Suelta `data` (los datos de Input.dispatchDragEvent) en el punto, como desde otra aplicación.
// Devuelve si empezó una navegación de la ventana y si la vista sigue siendo el mismo documento.
async function dropOn(t, point, data) {
  const { ui } = t;
  const cdp = ui.webContents.debugger;
  let started = null;
  const onStart = (details) => {
    if (details.isMainFrame && !details.isSameDocument) started = details.url;
  };
  ui.webContents.on('did-start-navigation', onStart);
  const windows = BrowserWindow.getAllWindows().length;
  try {
    await ui.js('window.__suiteDropSameDocument = true');
    const payload = { dragOperationsMask: ALL_OPERATIONS, ...data, items: data.items ?? [] };
    for (const type of ['dragEnter', 'dragOver', 'dragOver', 'drop']) {
      await cdp.sendCommand('Input.dispatchDragEvent', { type, x: point.x, y: point.y, data: payload });
      await sleep(30);
    }
    await sleep(600);
  } finally {
    ui.webContents.off('did-start-navigation', onStart);
  }
  if (started) await ui.idle();
  const sameDocument = await ui.js('Boolean(window.__suiteDropSameDocument)').catch(() => false);
  return { started, sameDocument, view: ui.view(), newWindows: BrowserWindow.getAllWindows().length - windows };
}

function payloads() {
  const backups = viewUrl('admin/backups/index.html');
  return {
    // El caso del reporte: el enlace de una opción del menú lateral, soltado de vuelta en la ventana
    'enlace a una vista propia': { items: [{ mimeType: 'text/uri-list', data: backups }, { mimeType: 'text/plain', data: backups }] },
    'enlace externo': { items: [{ mimeType: 'text/uri-list', data: 'https://example.com/' }, { mimeType: 'text/plain', data: 'https://example.com/' }] },
    'archivo de una vista propia': { files: [path.join(PATHS.renderer, 'admin', 'users', 'index.html')] },
    'archivo de imagen': { files: [path.join(PATHS.root, 'resources', 'icon_app.png')] },
    'texto': { items: [{ mimeType: 'text/plain', data: 'texto suelto' }] },
  };
}

async function expectDropsIgnored(t, viewName, targets) {
  for (const [targetName, selector] of Object.entries(targets)) {
    const point = await t.ui.pointOf(selector, { scroll: false });
    t.require(point.hit, `${viewName}: ${targetName} (${selector}) no está a la vista`, point);
    for (const [payloadName, data] of Object.entries(payloads())) {
      const view = t.ui.view();
      const result = await dropOn(t, point, data);
      t.check(!result.started && result.sameDocument && result.view === view,
        `${viewName}: soltar ${payloadName} sobre ${targetName} cambia la vista`, result);
      t.equal(result.newWindows, 0, `${viewName}: soltar ${payloadName} sobre ${targetName} no abre ventanas`);
      if (result.view !== view) await t.ui.navigate(view);
    }
  }
}

group('ui.drag-drop', 'Arrastrar y soltar con la ventana', () => {
  test('drag-out', 'Ningún enlace, imagen o ícono de las vistas se arrastra fuera de la ventana; el texto de un campo sí', { timeoutMs: 240_000 }, async (t) => {
    const { ui } = t;
    const seen = new Set();
    await ui.navigate('auth/login/index.html');
    await expectNoDragOut(t, 'login', seen);

    // Control: el texto seleccionado de un campo se sigue arrastrando (y prueba que el arrastre se
    // detecta: sin él, las comprobaciones de arriba no dirían nada).
    await ui.fill('#loginEmail', 'arrastre@institucion.edu.ar');
    await ui.js(`document.getElementById('loginEmail').select(); true`);
    const field = await ui.pointOf('#loginEmail', { scroll: false });
    const dragged = await dragFrom(t, { x: field.x - 40, y: field.y });
    t.check(dragged?.includes('text/plain'), 'El texto seleccionado de un campo se arrastra', dragged);

    await loginViaUi(t, SEED_USERS.admin);
    for (const viewPath of ['admin/dashboard/index.html', 'admin/users/index.html', 'admin/courses/index.html',
      'admin/assignments/index.html', 'admin/backups/index.html', 'profile/settings/index.html']) {
      await t.step(viewPath, async () => {
        await ui.navigate(viewPath);
        await expectNoDragOut(t, viewPath, seen);
      });
    }
    t.check(seen.size >= 20, `Se probaron ${seen.size} enlaces, imágenes e íconos`);
  });

  test('drop-into-window', 'Soltar un enlace, un archivo o texto sobre la ventana no cambia la vista; en un campo, el texto se inserta', async (t) => {
    const { ui } = t;
    // Input.dispatchDragEvent no llega a navegar la ventana ni con navigateOnDragDrop en true (probado
    // el 2026-11-07, Electron 44), y getLastWebPreferences no informa esa opción: lo que protege los
    // soltados reales es main-window.js. Esto comprueba que nada de la vista abra lo soltado.
    await ui.navigate('auth/login/index.html');
    await expectDropsIgnored(t, 'login', { 'el logotipo': '.login-logo img', 'la contraseña': '#loginPassword' });

    // Un campo de texto recibe el texto que se suelta, pero no un archivo
    await ui.fill('#loginEmail', '');
    const email = await ui.pointOf('#loginEmail', { scroll: false });
    let result = await dropOn(t, email, { items: [{ mimeType: 'text/plain', data: 'soltado@institucion.edu.ar' }] });
    t.check(!result.started && result.sameDocument, 'Soltar texto en un campo no cambia la vista', result);
    t.equal(await ui.value('#loginEmail'), 'soltado@institucion.edu.ar', 'El texto soltado queda en el campo');
    result = await dropOn(t, email, { files: [path.join(PATHS.root, 'resources', 'icon_app.png')] });
    t.check(!result.started && result.sameDocument, 'Soltar un archivo en un campo no cambia la vista', result);
    t.equal(await ui.value('#loginEmail'), 'soltado@institucion.edu.ar', 'Soltar un archivo no cambia el campo');

    await loginViaUi(t, SEED_USERS.admin);
    await expectDropsIgnored(t, 'admin/dashboard/index.html', {
      'el área principal': '.main > .content',
      'una opción del menú lateral': '.sidebar-nav a.nav-item[href$="/admin/users/index.html"]',
    });
  });

  test('main-process-guard', 'El proceso principal no deja navegar marcos ni abrir ventanas nuevas; el menú lateral sigue navegando', async (t) => {
    const { ui } = t;
    await loginViaUi(t, SEED_USERS.admin);
    const windows = BrowserWindow.getAllWindows().length;

    // Marcos: ni una vista propia ni una URL externa (will-navigate no los ve)
    for (const src of ['../users/index.html', 'https://example.com/']) {
      const frame = await ui.js(`new Promise((resolve) => {
        const frame = document.createElement('iframe');
        frame.src = ${JSON.stringify(src)};
        document.body.append(frame);
        setTimeout(() => {
          let href;
          try { href = frame.contentWindow.location.href; } catch { href = '(otro origen)'; }
          frame.remove();
          resolve(href);
        }, 800);
      })`);
      t.equal(frame, 'about:blank', `Un marco con ${src} no navega`);
    }

    // Ventanas nuevas: window.open, target=_blank y Mayús + clic en una opción del menú lateral
    t.equal(await ui.js(`window.open(${JSON.stringify(viewUrl('admin/users/index.html'))}) === null`), true, 'window.open no abre la vista');
    t.equal(await ui.js(`window.open('https://example.com/') === null`), true, 'window.open no abre una URL externa');
    await ui.js(`(() => { const a = document.createElement('a'); a.href = 'https://example.com/'; a.target = '_blank'; document.body.append(a); a.click(); a.remove(); return true; })()`);
    const link = await ui.pointOf('.sidebar-nav a.nav-item[href$="/admin/users/index.html"]');
    ui.webContents.sendInputEvent({ type: 'mouseMove', x: link.x, y: link.y });
    ui.webContents.sendInputEvent({ type: 'mouseDown', x: link.x, y: link.y, button: 'left', clickCount: 1, modifiers: ['shift'] });
    ui.webContents.sendInputEvent({ type: 'mouseUp', x: link.x, y: link.y, button: 'left', clickCount: 1, modifiers: ['shift'] });
    await sleep(800);
    t.equal(BrowserWindow.getAllWindows().length, windows, 'No se abrió ninguna ventana');
    t.equal(ui.view(), 'admin/dashboard/index.html', 'La vista no cambió');

    // La navegación normal sigue: clic en las opciones del menú lateral
    for (const viewPath of ['admin/backups/index.html', 'admin/users/index.html', 'admin/dashboard/index.html']) {
      await openFromSidebar(t, viewPath);
    }
  });
});
