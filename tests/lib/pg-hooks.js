// Ganchos sobre la biblioteca pg (no sobre la aplicación): registran los avisos de PostgreSQL
// (NOTICE, WARNING) de todas las conexiones y permiten inyectar fallas en las consultas de la
// aplicación sin reemplazar sus funciones internas, que los planes van a refactorizar.
// La aplicación usa el mismo módulo pg (node_modules/pg), así que el gancho la alcanza.
const { PATHS } = require('../config');

const pg = require(require.resolve('pg', { paths: [PATHS.root] }));

const notices = [];
let faults = [];
let installed = false;

function sqlOf(config) {
  return typeof config === 'string' ? config : config?.text ?? '';
}

// Una consulta de la aplicación: del pool, o de un cliente que la aplicación sacó del pool para una
// transacción. Los clientes de la suite llevan __suite.
function takeFault(sql) {
  const index = faults.findIndex((fault) => fault.match(sql));
  if (index < 0) return null;
  const fault = faults[index];
  fault.hits += 1;
  if (fault.hits >= fault.times) faults.splice(index, 1);
  return fault;
}

function faultPromise(fault, sql, run) {
  if (fault.action === 'hang') return new Promise(() => {});
  if (fault.action === 'delay') return new Promise((resolve) => setTimeout(resolve, fault.ms ?? 2000)).then(run);
  const error = new Error(fault.message ?? `Falla inyectada por la suite en: ${sql.slice(0, 80)}`);
  error.code = fault.code ?? 'SUITE_FAULT';
  return Promise.reject(error);
}

function install() {
  if (installed) return;
  installed = true;

  const originalConnect = pg.Client.prototype.connect;
  pg.Client.prototype.connect = function connect(...args) {
    if (!this.__noticeListener) {
      this.__noticeListener = true;
      this.on('notice', (notice) => {
        notices.push({
          at: Date.now(),
          source: this.__suite ? `suite:${this.__suite}` : 'app',
          severity: notice.severity,
          code: notice.code,
          message: notice.message,
          where: notice.where,
        });
      });
    }
    return originalConnect.apply(this, args);
  };

  // El pool llama a client.query con un callback: esas llamadas no se interceptan acá, sino en
  // Pool.query. Las de una transacción (runInTransaction) llegan sin callback.
  const originalClientQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function query(config, values, callback) {
    const hasCallback = [config, values, callback].some((arg) => typeof arg === 'function')
      || typeof config?.callback === 'function' || typeof config?.submit === 'function';
    if (!this.__suite && !hasCallback && faults.length) {
      const sql = sqlOf(config);
      const fault = takeFault(sql);
      if (fault) return faultPromise(fault, sql, () => originalClientQuery.call(this, config, values, callback));
    }
    return originalClientQuery.call(this, config, values, callback);
  };

  const originalPoolQuery = pg.Pool.prototype.query;
  pg.Pool.prototype.query = function query(config, values, callback) {
    const hasCallback = typeof values === 'function' || typeof callback === 'function';
    if (!hasCallback && faults.length) {
      const sql = sqlOf(config);
      const fault = takeFault(sql);
      if (fault) return faultPromise(fault, sql, () => originalPoolQuery.call(this, config, values, callback));
    }
    return originalPoolQuery.call(this, config, values, callback);
  };
}

// Hace fallar (action 'error'), dejar sin respuesta (action 'hang') o demorar `ms` (action 'delay')
// las próximas `times` consultas de la aplicación cuyo SQL cumpla `match` (una RegExp o una función).
function injectFault({ match, action = 'error', times = 1, message, code, ms }) {
  const test = match instanceof RegExp ? (sql) => match.test(sql) : match;
  const fault = { match: test, action, times, hits: 0, message, code, ms };
  faults.push(fault);
  return fault;
}

function clearFaults() {
  faults = [];
}

module.exports = { install, notices, injectFault, clearFaults };
