// Capa main (proceso principal e IPC sobre la aplicación real): todo canal expuesto tiene su handler
// y la matriz de permisos de todos los canales, por rol y sin sesión, según permissions.table.js.
const { group, test } = require('../lib/framework');
const { exposedChannels } = require('../lib/channels');
const { tableHashes, changedTables } = require('../lib/db-snapshot');
const table = require('./permissions.table');

const camel = (text) => text.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
// 'teacher-assignments:list-own' -> 'teacherAssignments.listOwn'
const apiPathOf = (channel) => channel.split(':').map(camel).join('.');
const ACCESS_CODES = ['UNAUTHENTICATED', 'FORBIDDEN', 'ACCOUNT_SUSPENDED'];

group('main.handlers', 'Canales expuestos y sus handlers', { db: 'clone' }, () => {
  test('exposed-have-handlers', 'Cada función de window.api llama a un canal con su handler registrado', async (t) => {
    const exposed = exposedChannels();
    const apiPaths = await t.js(`(() => {
      const paths = [];
      for (const [ns, members] of Object.entries(window.api)) for (const [name, value] of Object.entries(members)) if (typeof value === 'function') paths.push(ns + '.' + name);
      return paths;
    })()`);
    const registered = [...t.harness.mainWindow.webContents.__suiteHandlers.keys()];
    const fromApi = apiPaths.filter((apiPath) => apiPath !== 'window.onMaximizedChange').map(t.channelOf);
    t.equal([...fromApi].sort(), exposed, 'Las funciones de window.api no coinciden con los ipcRenderer.invoke del preload');
    for (const channel of exposed) t.check(registered.includes(channel), `El canal ${channel} no tiene handler en el proceso principal`);
    for (const channel of registered) t.check(exposed.includes(channel), `El handler ${channel} no está expuesto en el preload (código muerto o canal que la vista no puede llamar)`);
  });

  test('no-missing-handler-errors', 'Sin sesión, cada canal responde (ninguno queda sin handler ni rechaza la promesa)', async (t) => {
    t.allowRejection('*', '*', 'llamadas sin sesión y sin datos');
    for (const channel of exposedChannels()) {
      const entry = table.channels[channel];
      if (entry && entry.matrix === false && channel !== 'auth:login' && channel !== 'auth:select-institution') continue;
      const value = await t.call(apiPathOf(channel), ...(entry?.args ?? []));
      t.check(value?.__rejected === undefined, `${channel} rechazó la promesa del renderer`, value);
    }
  });
});

group('main.permissions', 'Matriz de permisos: todos los canales por rol y sin sesión', {
  async setup({ fixtures }) {
    return {
      ADMIN: await fixtures.createUser({ role: 'ADMIN' }),
      SECRETARIO: await fixtures.createUser({ role: 'SECRETARIO' }),
      PROFESOR: await fixtures.createUser({ role: 'PROFESOR' }),
    };
  },
}, () => {
  test('table-matches-preload', 'La tabla de permisos tiene una fila por cada canal expuesto, y solo esos', async (t) => {
    t.equal(Object.keys(table.channels).sort(), exposedChannels(), 'Canales de permissions.table.js y del preload');
  });

  test('matrix', 'Cada canal protegido rechaza sin sesión y con un rol sin permiso, y atiende al rol con permiso, sin cambiar la base', async (t) => {
    t.allowRejection('*', '*', 'matriz de permisos: se comprueba cada código abajo');
    const before = await tableHashes(t.db);
    const channels = Object.entries(table.channels).filter(([, entry]) => entry.matrix !== false && !entry.destructive);

    await t.logout();
    for (const [channel, entry] of channels) {
      const value = await t.call(apiPathOf(channel), ...entry.args);
      if (entry.roles === 'public') t.check(!ACCESS_CODES.includes(value?.error?.code), `Sin sesión, ${channel} es público y no debería rechazar el acceso`, value);
      else t.check(value?.error?.code === 'UNAUTHENTICATED', `Sin sesión, ${channel} tenía que responder UNAUTHENTICATED`, value);
    }

    for (const role of table.ROLES) {
      await t.login(t.data[role]);
      for (const [channel, entry] of channels) {
        const value = await t.call(apiPathOf(channel), ...entry.args);
        t.check(value?.__rejected === undefined, `${role}: ${channel} rechazó la promesa del renderer`, value);
        const allowed = entry.roles === 'public' || entry.roles.includes(role);
        if (allowed) t.check(!ACCESS_CODES.includes(value?.error?.code), `${role} tiene permiso para ${channel} y se lo rechazó`, value);
        else t.check(value?.ok === false && value.error?.code === 'FORBIDDEN', `${role} no tiene permiso para ${channel}: tenía que responder FORBIDDEN`, value);
      }
      await t.logout();
    }

    const after = await tableHashes(t.db);
    t.equal(changedTables(before, after), [], 'La matriz no debería cambiar ninguna tabla');
  });

  test('destructive-matrix', 'profile:delete rechaza sin sesión y con cada rol da de baja la cuenta de la sesión', async (t) => {
    t.allowRejection('*', '*', 'matriz de permisos');
    await t.logout();
    const anonymous = await t.call('profile.delete');
    t.check(anonymous?.error?.code === 'UNAUTHENTICATED', 'Sin sesión, profile:delete tenía que responder UNAUTHENTICATED', anonymous);
    for (const role of table.ROLES) {
      const user = t.data[role];
      await t.login(user);
      const value = await t.call('profile.delete');
      t.check(value?.ok === true, `${role}: profile:delete de una cuenta sin dependencias tenía que funcionar`, value);
      const row = await t.sqlOne(`SELECT estado, fecha_eliminacion IS NOT NULL AS deleted FROM usuario WHERE usuario_id = $1`, [user.id]);
      t.equal(row, { estado: false, deleted: true }, `${role}: la cuenta quedó suspendida y dada de baja`);
      t.equal(await t.call('auth.getCurrentUser'), null, `${role}: la sesión quedó cerrada`);
    }
  });
});
