// Proceso de Electron de la capa startup: arranca la aplicación con su main.js real en un escenario
// (STARTUP_SCENARIO, JSON) y escribe lo que pasó en un archivo JSON. Lo lanza
// tests/startup/startup.test.js, uno por escenario, con un tiempo máximo.
// Antes de cargar main.js: datos de usuario y temporales propios, variables de conexión del
// escenario (dotenv no pisa las que ya están definidas), diálogos y menú de la bandeja capturados.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const electron = require('electron');
const { PATHS } = require('../../config');
const { readEnv } = require('../env');
const pgHooks = require('../pg-hooks');
const { Monitor } = require('../monitor');

const scenario = JSON.parse(process.env.STARTUP_SCENARIO);
const { app, dialog, Menu, BrowserWindow, shell } = electron;
const monitor = new Monitor();
const outcome = { scenario: scenario.name, dialogs: [], windows: [], trayMenu: null, steps: {}, events: [] };
let written = false;

function writeOutcome() {
  if (written) return;
  written = true;
  outcome.events = monitor.since(0);
  fs.writeFileSync(scenario.resultFile, JSON.stringify(outcome, null, 2));
}

app.setPath('userData', path.join(scenario.runDir, 'userdata'));
app.setPath('temp', path.join(scenario.runDir, 'temp'));
fs.mkdirSync(app.getPath('temp'), { recursive: true });
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
pgHooks.install();
monitor.captureProcess('main');

dialog.showErrorBox = (title, content) => {
  outcome.dialogs.push({ title, content, at: Date.now() });
};
shell.openPath = async () => '';
const originalBuild = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => {
  outcome.trayMenu = template.map((item) => item.label ?? item.type);
  outcome.trayTemplate = template;
  return originalBuild(template);
};
app.on('browser-window-created', (_event, window) => {
  outcome.windows.push({ id: window.id, at: Date.now() });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') monitor.push({ type: 'console', source: 'renderer', level: event.level, message: event.message });
  });
});
app.on('quit', () => {
  outcome.quitAt = Date.now();
  writeOutcome();
});

// Proxy TCP local entre la aplicación y PostgreSQL: `freeze()` deja de pasar datos sin cerrar las
// conexiones, como un servidor que dejó de responder.
function startProxy(targetHost, targetPort) {
  let frozen = false;
  const sockets = [];
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, targetHost);
    sockets.push(client, upstream);
    client.on('data', (chunk) => { if (!frozen) upstream.write(chunk); });
    upstream.on('data', (chunk) => { if (!frozen) client.write(chunk); });
    const end = () => { client.destroy(); upstream.destroy(); };
    client.on('error', end);
    upstream.on('error', end);
    client.on('close', end);
    upstream.on('close', end);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    freeze: () => { frozen = true; },
    close: () => { sockets.forEach((socket) => socket.destroy()); server.close(); },
  })));
}

function waitUntil(predicate, timeoutMs, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function main() {
  const env = readEnv();
  const connection = { DB_HOST: env.DB_HOST, DB_PORT: env.DB_PORT, DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD, DB_NAME: scenario.dbName };
  let proxy = null;
  if (scenario.name === 'db-down') connection.DB_PORT = String(scenario.closedPort);
  if (scenario.name === 'login-hang') {
    proxy = await startProxy(env.DB_HOST, Number(env.DB_PORT));
    Object.assign(connection, { DB_HOST: '127.0.0.1', DB_PORT: String(proxy.port) });
  }
  Object.assign(process.env, connection);

  // La aplicación real, como la arranca npm start
  require(path.join(PATHS.root, 'main.js'));

  if (scenario.name === 'db-down' || scenario.name === 'db-missing') {
    // La aplicación tiene que mostrar el diálogo y cerrarse sola
    return;
  }

  await app.whenReady();
  const opened = await waitUntil(() => BrowserWindow.getAllWindows().length > 0, 15000);
  outcome.steps.windowOpened = opened;
  if (!opened) return app.exit(3);
  const win = BrowserWindow.getAllWindows()[0];
  outcome.steps.loginView = await waitUntil(() => !win.webContents.isLoading() && win.webContents.getURL().includes('auth/login/index.html'), 15000);

  // Desde la propia conexión de la aplicación: tiene que ser la base de prueba
  const appConnection = require(path.join(PATHS.root, 'src', 'main', 'database', 'connection.js'));
  if (scenario.name === 'ok' || scenario.name === 'unsaved') {
    const { rows } = await appConnection.query('SELECT current_database() AS name');
    outcome.steps.database = rows[0].name;
    if (rows[0].name !== scenario.dbName) {
      outcome.steps.fatal = `La aplicación quedó conectada a ${rows[0].name}`;
      return app.exit(4);
    }
  }
  if (scenario.name === 'ok') {
    // ✕ oculta la ventana en la bandeja; "Mostrar aplicación" la vuelve a mostrar; "Salir" cierra
    win.close();
    outcome.steps.hiddenOnClose = await waitUntil(() => !win.isDestroyed() && !win.isVisible(), 3000);
    const show = outcome.trayTemplate?.find((item) => item.label && item.click && !/salir/i.test(item.label));
    const quit = outcome.trayTemplate?.find((item) => item.label && /salir/i.test(item.label));
    show?.click();
    outcome.steps.shownFromTray = await waitUntil(() => !win.isDestroyed() && win.isVisible(), 3000);
    outcome.steps.quitRequestedAt = Date.now();
    quit?.click();
    return;
  }

  if (scenario.name === 'unsaved') return runUnsaved(win);

  if (scenario.name === 'login-hang') {
    proxy.freeze();
    const started = Date.now();
    const answered = await Promise.race([
      win.webContents.executeJavaScript(`window.api.auth.login(${JSON.stringify(scenario.email)}, ${JSON.stringify(scenario.password)}, false)`, true)
        .then((value) => ({ value })),
      new Promise((resolve) => setTimeout(() => resolve(null), scenario.answerWithinMs)),
    ]);
    outcome.steps.loginAnswered = Boolean(answered);
    outcome.steps.loginValue = answered?.value ?? null;
    outcome.steps.loginMs = Date.now() - started;
    proxy.close();
    writeOutcome();
    app.exit(0);
  }
}

// Escenario 'unsaved' (plans/profesor-calificaciones-sin-guardar/01-cerrar-la-aplicacion.md): el
// profesor de la prueba abre Calificaciones de su evaluación y cambia una nota sin guardarla. Con
// scenario.mode 'tray', oculta la ventana y pide "Salir" en la bandeja; con 'session-end', emite a
// mano el query-session-end de Windows sobre la ventana (con un preventDefault espía), antes y
// después del cambio. En los dos, la aplicación no se cierra y muestra el modal; "Cancelar" la deja
// abierta (y la ✕ la sigue ocultando) y, al volver a pedir el cierre, "Salir sin guardar" la cierra.
async function runUnsaved(win) {
  const { steps } = outcome;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const jsUntil = async (code, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!win.isDestroyed() && await js(code).catch(() => false)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };
  const isModalOpen = `document.getElementById('leaveScoresOverlay')?.classList.contains('is-open') === true`;
  const quit = outcome.trayTemplate?.find((item) => item.label && /salir/i.test(item.label));
  const sessionEnd = () => {
    const event = { prevented: false, reasons: ['logoff'], preventDefault() { this.prevented = true; } };
    win.emit('query-session-end', event);
    return event.prevented;
  };

  const login = await js(`window.api.auth.login(${JSON.stringify(scenario.email)}, ${JSON.stringify(scenario.password)}, false)`);
  steps.loggedIn = login?.ok === true && Boolean(login.user);
  if (!steps.loggedIn) return app.exit(6);
  const query = new URLSearchParams({ assignmentId: String(scenario.assignmentId), evaluationId: String(scenario.evaluationId) });
  await js(`window.location.href = '../../teacher/evaluation-scores/index.html?${query}'; true`);
  const input = `document.querySelector('tr[data-enrollment-id="${scenario.enrollmentId}"] .numeric-stepper-input')`;
  steps.scoresView = await jsUntil(`location.href.includes('teacher/evaluation-scores/') && ${input} && !${input}.disabled`, 15000);
  if (!steps.scoresView) return app.exit(7);

  if (scenario.mode === 'session-end') steps.sessionEndPreventedWithoutChanges = sessionEnd();

  // Una nota sin guardar, como al escribirla y salir del campo
  await js(`(() => {
    const input = ${input};
    input.dispatchEvent(new FocusEvent('focus'));
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    return true;
  })()`);
  steps.unsavedChange = await jsUntil(`!document.getElementById('saveScoresBtn').disabled`, 3000);
  // La vista le informa el cambio al proceso principal por IPC
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Pide el cierre: "Salir" con la ventana oculta, o el cierre de sesión de Windows
  const requestQuit = () => {
    if (scenario.mode === 'session-end') return { prevented: sessionEnd() };
    win.hide();
    const hidden = !win.isVisible();
    quit?.click();
    return { hidden };
  };

  steps.firstRequest = requestQuit();
  steps.firstModalOpen = await jsUntil(isModalOpen, 5000);
  steps.firstNotQuit = !outcome.quitAt && !win.isDestroyed();
  steps.firstVisible = !win.isDestroyed() && win.isVisible();

  await js(`document.getElementById('cancelLeaveScoresBtn').click(); true`);
  steps.cancelClosedModal = await jsUntil(`!(${isModalOpen})`, 3000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  steps.notQuitAfterCancel = !outcome.quitAt && !win.isDestroyed();
  steps.valueKept = await js(`${input}.value`);
  win.close();
  steps.hiddenOnCloseAfterCancel = await waitUntil(() => !win.isDestroyed() && !win.isVisible(), 3000);

  steps.secondRequest = requestQuit();
  steps.secondModalOpen = await jsUntil(isModalOpen, 5000);
  steps.secondVisible = !win.isDestroyed() && win.isVisible();
  steps.quitConfirmedAt = Date.now();
  // Sin esperar: la aplicación se cierra y la ejecución puede no volver
  js(`document.getElementById('confirmLeaveScoresBtn').click(); true`).catch(() => {});
}

main().catch((error) => {
  outcome.steps.harnessError = error.stack ?? String(error);
  writeOutcome();
  app.exit(5);
});
