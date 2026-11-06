// Capa main: controles de la ventana sin marco (barra de título propia): maximizar, restaurar,
// minimizar y cerrar, y el aviso de maximizado que recibe la vista. También los canales del cierre
// de la aplicación con cambios sin guardar (app:set-unsaved-changes y app:quit).
const { group, test } = require('../lib/framework');
const { waitUntil } = require('../lib/electron/app-harness');

group('main.window', 'Controles de la ventana', { db: 'none' }, () => {
  test('maximize-restore', 'Maximizar y restaurar cambian la ventana y avisan a la vista', async (t) => {
    const win = t.harness.mainWindow;
    await t.js(`window.__suiteMaximized = []; window.api.window.onMaximizedChange((value) => window.__suiteMaximized.push(value)); true`);
    t.equal(await t.call('window.isMaximized'), false, 'Empieza sin maximizar');
    t.equal(await t.call('window.toggleMaximize'), true, 'toggleMaximize responde que quedó maximizada');
    t.check(await waitUntil(() => win.isMaximized(), 3000), 'La ventana se maximizó');
    t.equal(await t.call('window.toggleMaximize'), false, 'toggleMaximize responde que se restauró');
    t.check(await waitUntil(() => !win.isMaximized(), 3000), 'La ventana se restauró');
    t.check(await waitUntil(async () => (await t.js('window.__suiteMaximized.length')) >= 2, 3000), 'La vista recibió los dos avisos');
    t.equal(await t.js('window.__suiteMaximized.slice(-2)'), [true, false], 'Avisos de maximizado');
  });

  test('minimize', 'Minimizar oculta la ventana en la barra de tareas', async (t) => {
    const win = t.harness.mainWindow;
    await t.call('window.minimize');
    t.check(await waitUntil(() => win.isMinimized(), 3000), 'La ventana se minimizó');
    win.restore();
    t.check(await waitUntil(() => !win.isMinimized(), 3000), 'La ventana se restauró');
  });

  test('app-set-unsaved-changes', 'app:set-unsaved-changes acepta solo un booleano', async (t) => {
    await t.rejects('INVALID_INPUT', 'app.setUnsavedChanges', 'sí');
    await t.rejects('INVALID_INPUT', 'app.setUnsavedChanges');
    t.equal(await t.call('app.setUnsavedChanges', true), { ok: true }, 'Acepta true');
    t.equal(await t.call('app.setUnsavedChanges', false), { ok: true }, 'Acepta false');
  });

  // El cierre real con cambios sin guardar se prueba en la capa startup (startup.app.quit-unsaved):
  // acá app.quit se reemplaza para no cerrar la suite. El cierre queda confirmado en quit-guard.js
  // hasta el final de la capa, que no usa el before-quit de main.js.
  test('app-quit', 'app:quit cierra la aplicación', async (t) => {
    const { app } = require('electron');
    const originalQuit = app.quit;
    let quitCalls = 0;
    app.quit = () => { quitCalls += 1; };
    try {
      await t.call('app.quit');
    } finally {
      app.quit = originalQuit;
    }
    t.equal(quitCalls, 1, 'Llamó a app.quit una vez');
  });

  test('close','Cerrar cierra la ventana (main.js la oculta en la bandeja: ver la capa startup)', async (t) => {
    const win = t.harness.mainWindow;
    await t.js('window.api.window.close(); true');
    t.check(await waitUntil(() => win.isDestroyed(), 3000), 'La ventana se cerró');
  });
});
