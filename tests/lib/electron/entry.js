// Proceso principal de Electron para las capas main y ui: carga la aplicación real (src/main) con el
// arnés y corre los grupos de la capa. Lo lanza tests/run.js.
const path = require('node:path');
const { readArgs, layerFiles, selector, progress } = require('../child-protocol');
const { AppHarness, sleep, appModule } = require('./app-harness');

const args = readArgs();
const harness = new AppHarness({ runDir: args.runDir, layer: args.layer });

const { app } = require('electron');
const { loadFiles } = require('../framework');
const { runGroups, jsonlWriter } = require('../runner-core');
const { prepareGroupDb, releaseGroupDb, decorateDb } = require('../group-db');
const pgHooks = require('../pg-hooks');
const { Ui } = require('./ui');
const { SEED_USERS } = require('../fixtures');
const { TIMEOUTS } = require('../../config');

const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
// window.api.teacherAssignments.listOwn -> teacher-assignments:list-own
const channelOf = (apiPath) => {
  const parts = apiPath.split('.');
  return `${kebab(parts[0])}:${kebab(parts[1])}`;
};

function decorateElectron(t, ctx, write) {
  const { monitor } = harness;
  t.harness = harness;
  t.emit = write;
  t.js = (code) => harness.mainWindow.webContents.executeJavaScript(code, true);
  t.channelOf = channelOf;

  // Llamada a window.api desde la vista abierta, como la haría la interfaz. Devuelve lo que resuelve
  // la promesa, o { __rejected: mensaje } si se rechaza.
  t.call = async (apiPath, ...callArgs) => {
    const code = `window.api.${apiPath}(...${JSON.stringify(callArgs)}).then((value) => ({ value }), (error) => ({ rejected: String(error?.message ?? error) }))`;
    const outcome = await t.js(code);
    return outcome.rejected !== undefined ? { __rejected: outcome.rejected } : outcome.value;
  };
  // La llamada tiene que resolver sin error.
  t.ok = async (apiPath, ...callArgs) => {
    const value = await t.call(apiPath, ...callArgs);
    const failed = value?.__rejected !== undefined || (value && typeof value === 'object' && value.ok === false);
    t.check(!failed, `${apiPath} no debería fallar`, value);
    return value;
  };
  // La llamada tiene que rechazarse con `code`: se declara como esperada y se comprueba.
  t.rejects = async (code, apiPath, ...callArgs) => {
    t.allowRejection(channelOf(apiPath), code, 'declarado con t.rejects');
    const value = await t.call(apiPath, ...callArgs);
    t.check(value?.ok === false && value.error?.code === code, `${apiPath} tenía que rechazarse con ${code}`, value);
    return value;
  };

  // Inicia sesión por la API del preload. `account` es una clave de SEED_USERS o { email, password };
  // si las credenciales tienen varias cuentas, `choose` ({ institutionId, role }) elige una.
  t.login = async (account, { choose, remember = false } = {}) => {
    const user = typeof account === 'string' ? SEED_USERS[account] : account;
    const result = await t.call('auth.login', user.email, user.password, remember);
    if (result?.ok && result.institutions) {
      const pick = choose ?? result.institutions.find((option) => !user.role || option.role === user.role);
      t.require(pick, `${user.email} tiene varias cuentas y no se eligió ninguna`, result);
      const selected = await t.call('auth.selectInstitution', pick.institutionId ?? pick.id, pick.role, remember);
      t.require(selected?.ok, `No se pudo elegir la cuenta de ${user.email}`, selected);
      return selected.user;
    }
    t.require(result?.ok && result.user, `No se pudo iniciar sesión con ${user.email}`, result);
    return result.user;
  };
  t.logout = () => t.call('auth.logout');

  t.ui = new Ui(harness, t);
  t.openedPaths = harness.openedPaths;
  t.injectFault = (spec) => pgHooks.injectFault(spec);
  t.appModule = appModule;
  t.detect = async (fn) => {
    const mark = monitor.mark();
    await fn();
    await monitor.settle(mark);
    return monitor.since(mark);
  };
  // Reemplaza el handler de un canal (solo para pruebas de detección) hasta el final de la prueba.
  t.replaceHandler = (channel, listener) => {
    const { webContents } = harness.mainWindow;
    webContents.ipc.removeHandler(channel);
    webContents.ipc.handle(channel, listener);
    t.restoreAfter = [...(t.restoreAfter ?? []), channel];
  };
  if (ctx.client) decorateDb(t, ctx);
}

async function main() {
  await app.whenReady();
  await harness.ready();
  const write = jsonlWriter(args.resultsFile, progress);
  const groups = loadFiles(layerFiles(args.layer), args.layer);
  let groupIndex = 0;

  const env = {
    layer: args.layer,
    defaultTimeoutMs: TIMEOUTS.test[args.layer],
    monitor: harness.monitor,
    async beforeGroup(group) {
      groupIndex += 1;
      harness.monitor.currentTest = `${group.id}.(preparación)`;
      const ctx = { args };
      if (group.options.db !== 'none') {
        Object.assign(ctx, await prepareGroupDb({
          template: args.template,
          name: `${args.dbBase}_${args.layer}_${groupIndex}`,
          setup: group.options.setup ? (c) => group.options.setup({ ...c, args }) : null,
          withAppConnection: true,
        }));
      }
      harness.resetUserData();
      await harness.openWindow();
      // La sesión vive en el proceso principal: cada grupo empieza sin sesión
      await harness.mainWindow.webContents.executeJavaScript('window.api.auth.logout()', true);
      return ctx;
    },
    decorate(t, ctx) {
      decorateElectron(t, ctx, write);
    },
    async beforeTest(t) {
      harness.monitor.currentTest = t.id;
      harness.monitor.graceMs = args.layer === 'ui' ? 200 : 60;
      harness.openedPaths.length = 0;
      harness.openPathResult = '';
    },
    async afterTest(t) {
      pgHooks.clearFaults();
      for (const channel of t.restoreAfter ?? []) harness.mainWindow?.webContents.__suiteRestoreHandler(channel);
      if (t.failures.length && !t.definition.meta.knownFailure && harness.mainWindow) {
        const file = await harness.shot(`${t.id}-falla`);
        if (file) t.warn(`Captura de la ventana al fallar: ${path.relative(args.runDir, file)} (en tests/.tmp, hasta la próxima corrida)`);
      }
      harness.monitor.currentTest = null;
    },
    async afterGroup(group, ctx) {
      try {
        if (harness.mainWindow) await harness.mainWindow.webContents.executeJavaScript('window.api.auth.logout()', true);
      } catch {}
      await sleep(50);
      harness.closeWindow();
      if (ctx.client) await releaseGroupDb(ctx, { keepDb: args.keepDb });
    },
  };

  await runGroups(groups, env, { select: selector(args), write });
  write(harness.monitor.coverageRecord());
  await harness.checkClipboard();
  for (const problem of harness.isolationProblems) write({ type: 'isolation-problem', layer: args.layer, message: problem });
  write({ type: 'done', layer: args.layer });
}

main().then(
  () => app.exit(0),
  (error) => {
    process.stdout.write(`ERROR de la capa: ${error.stack ?? error}\n`);
    app.exit(error.fatal ? 3 : 2);
  }
);
