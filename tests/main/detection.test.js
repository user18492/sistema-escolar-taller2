// Capa main: la suite detecta las fallas silenciosas. Cada prueba provoca una a propósito (con una
// falla inyectada en la biblioteca pg o en Electron, nunca cambiando la aplicación), comprueba que
// el monitor la registra y que, sin declararla, haría fallar la prueba en la que ocurre.
const { group, test } = require('../lib/framework');
const { classify } = require('../lib/runner-core');
const { TestContext } = require('../lib/context');

function failuresOf(events) {
  return classify(events, new TestContext({ id: 'deteccion', meta: {} }), '2000-01-01').failures;
}

// Registra los eventos de `types` que produjo `fn`, los declara esperados para esta prueba y
// comprueba que una prueba que no los declarara fallaría.
async function provoke(t, label, types, fn, { alsoAllow = [] } = {}) {
  for (const type of [...types, ...alsoAllow]) t.allow(type, () => true, `provocado a propósito: ${label}`);
  t.allowRejection('*', '*', `provocado a propósito: ${label}`);
  const events = await t.detect(fn);
  for (const type of types) {
    const matching = events.filter((event) => event.type === type);
    t.check(matching.length > 0, `${label}: no se registró ningún evento ${type}`, events.map((event) => `${event.type}: ${event.message}`));
    t.check(failuresOf(matching).length === matching.length, `${label}: un evento ${type} no haría fallar la prueba`);
  }
  return events;
}

group('main.detection', 'La suite detecta fallas silenciosas del proceso principal y del renderer', () => {
  test('unexpected-error', 'Un error inesperado de la base se convierte en una respuesta genérica y un log: la suite lo detecta', async (t) => {
    await t.login('admin');
    t.injectFault({ match: /FROM grado/i });
    const events = await provoke(t, 'falla en la consulta de grados', ['ipc-unexpected', 'console'], async () => {
      const value = await t.call('grades.list');
      t.check(value?.error?.code === 'UNEXPECTED_ERROR', 'La aplicación respondió con el error genérico', value);
    });
    t.check(events.some((event) => event.type === 'console' && event.source === 'main'), 'El log del controlador en la consola del proceso principal se registró');
    await t.logout();
  });

  test('unexpected-rejection', 'Un rechazo que la prueba no declaró se detecta, y uno por datos inválidos se distingue', async (t) => {
    await t.login('admin');
    const events = await provoke(t, 'rechazos no declarados', ['ipc-reject'], async () => {
      await t.call('users.delete', 2147483000);
      await t.call('users.update', 1, { firstName: 'sin el resto de los campos' });
    });
    const invalid = failuresOf(events.filter((event) => event.type === 'ipc-reject' && event.code === 'INVALID_INPUT'));
    t.check(invalid.length === 1 && /Datos inválidos/.test(invalid[0].message), 'INVALID_INPUT se informa como datos inválidos enviados', invalid);
    await t.logout();
  });

  test('handler-throws', 'Una excepción dentro de un handler IPC se detecta', async (t) => {
    t.replaceHandler('grades:list', () => {
      throw new Error('excepción provocada por la suite');
    });
    await t.login('admin');
    await provoke(t, 'handler que lanza', ['ipc-throw'], async () => {
      const value = await t.call('grades.list');
      t.check(value?.__rejected, 'La promesa del renderer se rechazó', value);
    }, { alsoAllow: ['console'] });
    await t.logout();
  });

  test('no-response', 'Una llamada que nunca responde se detecta', async (t) => {
    await t.login('admin');
    t.harness.monitor.noResponseMs = 1000;
    try {
      t.injectFault({ match: /FROM grado/i, action: 'hang' });
      await provoke(t, 'consulta colgada', ['ipc-timeout'], async () => {
        await t.js('window.api.grades.list(); true');
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
    } finally {
      t.harness.monitor.noResponseMs = require('../config').TIMEOUTS.ipcNoResponseMs;
    }
    await t.logout();
  });

  test('renderer-console-and-uncaught', 'Errores y advertencias de la consola del renderer y excepciones sin capturar se detectan', async (t) => {
    await provoke(t, 'consola del renderer', ['console'], async () => {
      await t.js(`console.error('error provocado por la suite'); console.warn('advertencia provocada por la suite'); true`);
      await t.js(`setTimeout(() => { throw new Error('excepción provocada por la suite'); }); Promise.reject(new Error('promesa provocada por la suite')); true`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }).then((events) => {
      const messages = events.filter((event) => event.source === 'renderer').map((event) => event.message).join(' | ');
      for (const fragment of ['error provocado', 'advertencia provocada', 'excepción provocada', 'promesa provocada']) {
        t.check(messages.includes(fragment), `No se registró: ${fragment}`, messages);
      }
    });
  });

  test('main-uncaught', 'Una promesa rechazada sin capturar en el proceso principal se detecta', async (t) => {
    await provoke(t, 'promesa sin capturar', ['uncaught'], async () => {
      Promise.reject(new Error('rechazo provocado por la suite en el proceso principal'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  test('missing-resource', 'Un recurso que no carga se detecta', async (t) => {
    await provoke(t, 'imagen inexistente', ['resource'], async () => {
      await t.js(`document.body.append(Object.assign(new Image(), { src: 'no-existe-provocado-por-la-suite.png' })); true`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }, { alsoAllow: ['console'] });
  });

  test('error-toast', 'Un toast de error a la vista se detecta', async (t) => {
    await t.login('admin');
    await t.ui.navigate('admin/dashboard/index.html');
    await provoke(t, 'toast de error', ['ui-error'], async () => {
      await t.js(`showToast({ type: 'error', title: 'Error provocado', description: 'por la suite' }); true`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await t.logout();
  });

  test('dialog', 'Un diálogo del proceso principal se detecta (y no se muestra)', async (t) => {
    await provoke(t, 'diálogo de error', ['dialog'], async () => {
      require('electron').dialog.showErrorBox('Diálogo provocado', 'por la suite');
    });
  });

  test('pg-notice', 'Un aviso de PostgreSQL en una conexión de la aplicación se detecta', async (t) => {
    const connection = t.appModule('database/connection');
    const events = await provoke(t, 'aviso de PostgreSQL', ['pg-notice'], async () => {
      await connection.query(`DO $$ BEGIN RAISE WARNING 'aviso provocado por la suite'; END $$`);
    });
    t.check(events.some((event) => event.type === 'pg-notice' && event.source === 'app'), 'El aviso es de la conexión de la aplicación');
  });

  test('slow-call', 'Una llamada IPC lenta genera un aviso sin hacer fallar la prueba', async (t) => {
    await t.login('admin');
    t.injectFault({ match: /FROM grado/i, action: 'delay', ms: require('../config').TIMEOUTS.ipcSlowMs + 300 });
    t.allow('ipc-slow', /grades:list/, 'demora provocada a propósito');
    const events = await t.detect(() => t.call('grades.list'));
    const slow = events.filter((event) => event.type === 'ipc-slow');
    t.check(slow.length === 1, 'No se registró la llamada lenta', events.map((event) => event.type));
    const classified = classify(slow, new TestContext({ id: 'deteccion', meta: {} }), '2000-01-01');
    t.check(classified.failures.length === 0 && classified.warnings.length === 1, 'La llamada lenta tiene que ser un aviso y no una falla', classified);
    await t.logout();
  });

  test('load-error-visible', 'Un mensaje de carga fallida a la vista se detecta', async (t) => {
    await t.login('teacher');
    await provoke(t, 'asignación inexistente', ['ui-error'], async () => {
      await t.ui.navigate('teacher/assignment-management/index.html?assignmentId=2147483000', { expect: 'teacher/assignment-management/index.html' });
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await t.logout();
  });

  test('clipboard-isolated', 'Copiar desde la interfaz usa el portapapeles de prueba y no toca el del sistema', async (t) => {
    const { ui } = t;
    const { clipboard } = require('electron');
    const before = await Promise.resolve(clipboard.readText());
    await t.login('admin');
    await ui.navigate('admin/users/index.html');
    await ui.click('#openNewUserModalBtn');
    await ui.waitModal('#newUserOverlay', true);
    await ui.click('#newUserOverlay password-generator [data-action="generate"]');
    await ui.waitFor(`!document.querySelector('#newUserOverlay .password-display').hidden`, { message: 'No se generó la contraseña' });
    await ui.click('#newUserOverlay password-generator [data-action="copy"]');
    await ui.waitFor('window.__suiteClipboard.length > 0', { message: 'La copia no llegó al portapapeles de prueba' });
    const copied = await ui.js('window.__suiteClipboard.at(-1)');
    t.check(typeof copied === 'string' && copied.length >= 12, 'Se copió la contraseña generada', copied?.length);
    t.equal(await Promise.resolve(clipboard.readText()), before, 'El portapapeles del sistema no cambió');
    await t.logout();
  });

  test('renderer-crash', 'Una caída del renderer se detecta', async (t) => {
    await provoke(t, 'caída del renderer', ['crash'], async () => {
      t.harness.mainWindow.webContents.forcefullyCrashRenderer();
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await t.harness.reload();
  });
});
