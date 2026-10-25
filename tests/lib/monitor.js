// Registro de todo lo que puede delatar una falla silenciosa en un proceso: consola, excepciones y
// promesas rechazadas sin capturar, avisos de PostgreSQL y, en Electron (electron/app-harness.js),
// las llamadas IPC, la consola del renderer, recursos, caídas, diálogos y errores visibles.
// Cada evento es { type, source, message, detail, ... }; runner-core.js los clasifica al terminar
// cada prueba.
const util = require('node:util');
const pgHooks = require('./pg-hooks');

class Monitor {
  constructor() {
    this.events = [];
    this.noticeIndex = 0;
    this.originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  }

  push(event) {
    this.events.push({ at: Date.now(), ...event });
  }

  // Captura la consola y los errores sin capturar del proceso. `echo` recibe lo que la suite
  // escribe para el informe (stdout del proceso hijo).
  captureProcess(source) {
    const format = (args) => args.map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 3 }))).join(' ');
    console.error = (...args) => this.push({ type: 'console', source, level: 'error', message: format(args) });
    console.warn = (...args) => this.push({ type: 'console', source, level: 'warning', message: format(args) });
    process.on('uncaughtException', (error) => this.push({ type: 'uncaught', source, message: error?.message ?? String(error), detail: error?.stack }));
    process.on('unhandledRejection', (reason) => this.push({ type: 'uncaught', source, message: `Promesa rechazada sin capturar: ${reason?.message ?? String(reason)}`, detail: reason?.stack }));
    process.on('warning', (warning) => this.push({ type: 'console', source, level: 'warning', message: `${warning.name}: ${warning.message}` }));
  }

  // Los avisos de PostgreSQL llegan a pg-hooks.notices; se pasan a eventos al marcar y al leer.
  drainNotices() {
    while (this.noticeIndex < pgHooks.notices.length) {
      const notice = pgHooks.notices[this.noticeIndex];
      this.noticeIndex += 1;
      this.push({ type: 'pg-notice', source: notice.source, message: `${notice.severity} ${notice.code}: ${notice.message}`, detail: notice.where });
    }
  }

  mark() {
    this.drainNotices();
    return this.events.length;
  }

  since(mark) {
    this.drainNotices();
    return this.events.slice(mark);
  }

  async settle() {}
}

module.exports = { Monitor };
