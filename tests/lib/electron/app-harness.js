// Arnés de Electron sobre la aplicación real (src/main): aísla todo lo que la aplicación toca fuera
// de la base (datos de usuario, archivos temporales, visor de PDF, portapapeles, diálogos), registra
// cada llamada IPC con su resultado y escucha todo lo que puede delatar una falla silenciosa:
// consola de los dos procesos, excepciones sin capturar, recursos que no cargan, caídas del
// renderer, diálogos y estados de error visibles (page-probe.js).
// No modifica la aplicación: envuelve objetos de Electron (webContents.ipc.handle, dialog, shell) y
// usa las funciones que la aplicación exporta, como haría main.js.
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { PATHS, TIMEOUTS } = require('../../config');
const pgHooks = require('../pg-hooks');
const { Monitor } = require('../monitor');

const { app, dialog, shell, clipboard } = electron;
const PAGE_PROBE = fs.readFileSync(path.join(__dirname, 'page-probe.js'), 'utf8');
const appModule = (relative) => require(path.join(PATHS.root, 'src', 'main', relative));

class ElectronMonitor extends Monitor {
  constructor() {
    super();
    this.pendingCalls = new Map();
    this.callStats = new Map();
    this.currentTest = null;
    this.nextCallId = 1;
    this.graceMs = 60;
    // Las pruebas de detección lo acortan para no esperar el valor de config.js
    this.noResponseMs = TIMEOUTS.ipcNoResponseMs;
  }

  ipcStart(channel, args) {
    const call = { id: this.nextCallId++, channel, startedAt: Date.now(), test: this.currentTest, argsPreview: preview(channel, args) };
    this.pendingCalls.set(call.id, call);
    return call;
  }

  ipcEnd(call, { result, error }) {
    this.pendingCalls.delete(call.id);
    const durationMs = Date.now() - call.startedAt;
    const key = `${call.test ?? ''}\u0000${call.channel}`;
    const stats = this.callStats.get(key) ?? { test: call.test, channel: call.channel, calls: 0, ok: 0, rejected: {} };
    this.callStats.set(key, stats);
    stats.calls += 1;
    if (call.timedOut) {
      this.push({ type: 'console', source: 'main', level: 'warning', message: `La llamada ${call.channel} respondió después de ${durationMs} ms (ya se había informado sin respuesta)` });
    }
    if (error) {
      this.push({ type: 'ipc-throw', channel: call.channel, message: `${call.channel}: ${error.message}`, detail: { args: call.argsPreview, stack: error.stack } });
    } else if (result && typeof result === 'object' && result.ok === false) {
      const code = result.error?.code ?? '(sin código)';
      stats.rejected[code] = (stats.rejected[code] ?? 0) + 1;
      this.push({
        type: code === 'UNEXPECTED_ERROR' ? 'ipc-unexpected' : 'ipc-reject',
        channel: call.channel,
        code,
        message: `${call.channel} → ${code}: ${result.error?.message ?? ''}`,
        detail: { args: call.argsPreview, fieldErrors: result.error?.fieldErrors },
      });
    } else {
      stats.ok += 1;
    }
    if (durationMs > TIMEOUTS.ipcSlowMs) {
      this.push({ type: 'ipc-slow', channel: call.channel, durationMs, message: `${call.channel} tardó ${durationMs} ms` });
    }
  }

  // Espera a que respondan las llamadas en curso. La que lleva más de ipcNoResponseMs sin
  // responder se informa como "sin respuesta" y se deja de esperar.
  async settle() {
    const deadline = Date.now() + this.noResponseMs + 500;
    while (Date.now() < deadline) {
      const waiting = [...this.pendingCalls.values()].filter((call) => !call.timedOut);
      if (!waiting.length) break;
      for (const call of waiting) {
        if (Date.now() - call.startedAt > this.noResponseMs) {
          call.timedOut = true;
          this.push({ type: 'ipc-timeout', channel: call.channel, message: `${call.channel} no respondió en ${this.noResponseMs} ms`, detail: { args: call.argsPreview } });
        }
      }
      await sleep(50);
    }
    await sleep(this.graceMs);
  }

  pending() {
    return [...this.pendingCalls.values()].filter((call) => !call.timedOut);
  }

  coverageRecord() {
    return { type: 'ipc-calls', calls: [...this.callStats.values()] };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Argumentos de una llamada para el informe, sin contraseñas ni bytes de fotos.
function preview(channel, args) {
  try {
    return JSON.parse(JSON.stringify(args, (key, value) => {
      if (/password/i.test(key)) return '***';
      if (value instanceof Uint8Array || value?.type === 'Buffer') return `[${value.length ?? value.data?.length} bytes]`;
      return value;
    }));
  } catch {
    return `[${channel}: argumentos no serializables]`;
  }
}

class AppHarness {
  // Se construye antes de que Electron esté listo (app.setPath y los esquemas lo exigen).
  constructor({ runDir, layer }) {
    this.runDir = runDir;
    this.layer = layer;
    this.monitor = new ElectronMonitor();
    this.userData = path.join(runDir, `userdata-${layer}`);
    this.tempDir = path.join(runDir, `temp-${layer}`);
    this.shotsDir = path.join(runDir, `shots-${layer}`);
    this.openedPaths = [];
    this.openPathResult = '';
    this.windows = new Set();
    this.dialogs = [];
    this.clipboardAtStart = null;
    this.isolationProblems = [];

    fs.mkdirSync(this.userData, { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });
    app.setPath('userData', this.userData);
    app.setPath('temp', this.tempDir);
    // Sin esto, con la ventana tapada o sin foco Chromium deja de avanzar transiciones y temporizadores
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    // La ventana oculta del PDF se destruye al terminar: que no cierre la aplicación
    app.on('window-all-closed', () => {});

    pgHooks.install();
    this.monitor.captureProcess('main');
    this.stubSystem();
    appModule('profile-image-protocol').registerProfileImageScheme();
    app.on('web-contents-created', (_event, webContents) => this.watchWebContents(webContents));
  }

  stubSystem() {
    const record = (kind) => (...args) => {
      const [title, message] = typeof args[0] === 'string' ? args : [args[1]?.title ?? args[0]?.title, args[1]?.message ?? args[0]?.message];
      const entry = { kind, title, message, at: Date.now() };
      this.dialogs.push(entry);
      this.monitor.push({ type: 'dialog', message: `${kind}: ${title ?? ''} ${message ?? ''}`.trim() });
      return kind.endsWith('Sync') ? (kind.includes('MessageBox') ? 0 : undefined) : Promise.resolve(kind.includes('MessageBox') ? { response: 0 } : { canceled: true, filePaths: [] });
    };
    for (const name of ['showErrorBox', 'showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
      dialog[name] = record(name);
    }
    // El comprobante se abre con shell.openPath (pdf.service.js): se registra y no se abre nada
    shell.openPath = async (filePath) => {
      this.openedPaths.push({ filePath, at: Date.now() });
      return this.openPathResult;
    };
    shell.openExternal = async (url) => {
      this.monitor.push({ type: 'open-external', message: url });
    };
    shell.showItemInFolder = (fullPath) => {
      this.monitor.push({ type: 'open-external', message: `showItemInFolder ${fullPath}` });
    };
    if (electron.shell.openPath !== shell.openPath) throw new Error('No se pudo reemplazar shell.openPath: el visor de PDF se abriría de verdad');
  }

  watchWebContents(webContents) {
    const source = () => (this.mainWindow && webContents === this.mainWindow.webContents ? 'renderer' : `webcontents-${webContents.id}`);
    // Todas las llamadas IPC de la ventana pasan por acá. Se guarda el handler de la aplicación de
    // cada canal, para poder restaurarlo después de reemplazarlo en una prueba de detección.
    const originalHandle = webContents.ipc.handle.bind(webContents.ipc);
    webContents.__suiteHandlers = new Map();
    webContents.ipc.handle = (channel, listener) => {
      if (!webContents.__suiteHandlers.has(channel)) webContents.__suiteHandlers.set(channel, listener);
      return wrapAndHandle(channel, listener);
    };
    webContents.__suiteRestoreHandler = (channel) => {
      webContents.ipc.removeHandler(channel);
      wrapAndHandle(channel, webContents.__suiteHandlers.get(channel));
    };
    const wrapAndHandle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
      const call = this.monitor.ipcStart(channel, args);
      try {
        const result = await listener(event, ...args);
        this.monitor.ipcEnd(call, { result });
        return result;
      } catch (error) {
        this.monitor.ipcEnd(call, { error });
        throw error;
      }
    });
    webContents.on('console-message', (event) => {
      const message = event.message ?? '';
      const marker = message.match(/^\[\[suite:([a-z-]+)\]\](.*)$/s);
      if (marker) {
        const data = JSON.parse(marker[2] || '{}');
        if (marker[1] === 'ui-error') {
          const text = data.kind === 'toast' ? `toast de error "${data.title}": ${data.description}` : `${data.kind} ${data.id ?? ''}: ${data.text}`;
          this.monitor.push({ type: 'ui-error', source: source(), kind: data.kind, message: text, detail: data });
        } else if (marker[1] === 'harness') {
          this.monitor.push({ type: 'console', source: 'harness', level: 'error', message: data.message });
        }
        return;
      }
      if (event.level !== 'warning' && event.level !== 'error') return;
      this.monitor.push({
        type: 'console',
        source: source(),
        level: event.level,
        message,
        detail: { url: event.sourceId, line: event.lineNumber },
      });
    });
    webContents.on('preload-error', (_event, preloadPath, error) => {
      this.monitor.push({ type: 'uncaught', source: source(), message: `Error en el preload ${preloadPath}: ${error.message}`, detail: error.stack });
    });
    webContents.on('render-process-gone', (_event, details) => {
      this.monitor.push({ type: 'crash', source: source(), message: `El renderer terminó: ${details.reason} (${details.exitCode})` });
    });
    webContents.on('unresponsive', () => this.monitor.push({ type: 'crash', source: source(), message: 'El renderer dejó de responder' }));
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
      if (errorCode === -3) return; // ERR_ABORTED: una navegación reemplazó a otra
      this.monitor.push({ type: 'resource', source: source(), message: `${isMainFrame ? 'La vista' : 'Un marco'} no cargó: ${url} (${errorDescription})` });
    });
  }

  // Con la aplicación lista: protocolo de las fotos (como main.js) y recursos que no cargan.
  async ready() {
    appModule('profile-image-protocol').handleProfileImageRequests();
    const { session } = electron;
    session.defaultSession.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
      if (details.error === 'net::ERR_ABORTED') return;
      this.monitor.push({ type: 'resource', message: `${details.resourceType} ${details.url}: ${details.error}` });
    });
    session.defaultSession.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => {
      if (details.statusCode >= 400) this.monitor.push({ type: 'resource', message: `${details.resourceType} ${details.url}: HTTP ${details.statusCode}` });
    });
    try {
      this.clipboardAtStart = await Promise.resolve(clipboard.readText());
    } catch {
      this.clipboardAtStart = null;
    }
  }

  // Ventana nueva de la aplicación, como la abre main.js (createMainWindow registra los handlers y
  // abre la vista de entrada). Se le activa el foco emulado (las pruebas no dependen de que la
  // ventana tenga el foco del sistema) y el script de page-probe.js en cada vista, y se vuelve a
  // abrir la vista de entrada para que ya lo tenga.
  async openWindow() {
    const { createMainWindow } = appModule('main-window');
    const window = createMainWindow();
    this.mainWindow = window;
    this.windows.add(window);
    window.webContents.setBackgroundThrottling(false);
    await waitUntil(() => !window.webContents.isLoading() && window.webContents.getURL().startsWith('file:'), 15000);
    const { debugger: cdp } = window.webContents;
    cdp.attach('1.3');
    await cdp.sendCommand('Page.enable');
    await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_PROBE });
    await this.reload();
    return window;
  }

  async reload() {
    const { webContents } = this.mainWindow;
    const loaded = new Promise((resolve) => webContents.once('did-finish-load', resolve));
    webContents.reload();
    await loaded;
  }

  closeWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.debugger.detach();
      } catch {}
      this.mainWindow.destroy();
    }
    this.mainWindow = null;
  }

  // Archivos que la aplicación guarda en userData: se vacían entre grupos.
  resetUserData() {
    fs.rmSync(path.join(this.userData, 'remembered-account.json'), { force: true });
    fs.rmSync(path.join(this.userData, 'profile-images'), { recursive: true, force: true });
  }

  async checkClipboard() {
    if (this.clipboardAtStart === null) return;
    const now = await Promise.resolve(clipboard.readText());
    if (now !== this.clipboardAtStart) {
      this.isolationProblems.push('El portapapeles del sistema cambió durante la corrida: se restauró');
      await Promise.resolve(clipboard.writeText(this.clipboardAtStart));
    }
  }

  async shot(name) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return null;
    fs.mkdirSync(this.shotsDir, { recursive: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const image = await this.mainWindow.webContents.capturePage();
        const file = path.join(this.shotsDir, `${name.replace(/[^a-z0-9._-]+/gi, '_')}.png`);
        fs.writeFileSync(file, image.toPNG());
        return file;
      } catch {
        await sleep(200);
      }
    }
    return null;
  }
}

async function waitUntil(predicate, timeoutMs = 8000, intervalMs = 40) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return true;
    } catch {}
    await sleep(intervalMs);
  }
  return false;
}

module.exports = { AppHarness, ElectronMonitor, waitUntil, sleep, appModule };
