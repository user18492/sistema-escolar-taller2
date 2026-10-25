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
  if (scenario.name === 'ok') {
    const { rows } = await appConnection.query('SELECT current_database() AS name');
    outcome.steps.database = rows[0].name;
    if (rows[0].name !== scenario.dbName) {
      outcome.steps.fatal = `La aplicación quedó conectada a ${rows[0].name}`;
      return app.exit(4);
    }
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

main().catch((error) => {
  outcome.steps.harnessError = error.stack ?? String(error);
  writeOutcome();
  app.exit(5);
});
