// Ejecución de los grupos de una capa dentro de un proceso (node o Electron). El entorno de cada
// capa aporta la base de cada grupo, los monitores y lo que se agrega a `t`; acá se corre cada
// prueba con su tiempo máximo y se clasifica lo que registraron los monitores: esperado (declarado
// por la prueba), ruido conocido (known-issues.js), aviso o falla.
const fs = require('node:fs');
const { TestContext, AbortTest, brief } = require('./context');
const knownIssues = require('../known-issues');

function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function matchKnownIssue(event) {
  return knownIssues.find((issue) =>
    issue.type === event.type
    && (!issue.source || issue.source === event.source)
    && (!issue.level || issue.level === event.level)
    && issue.match.test(event.message ?? ''));
}

function describeEvent(event) {
  const labels = {
    'ipc-reject': 'Rechazo IPC no esperado',
    'ipc-invalid': 'Datos inválidos enviados por la interfaz',
    'ipc-unexpected': 'Error inesperado en un canal IPC',
    'ipc-throw': 'Excepción en un handler IPC',
    'ipc-timeout': 'Llamada IPC sin respuesta',
    console: 'Consola',
    uncaught: 'Excepción o promesa rechazada sin capturar',
    resource: 'Recurso que no cargó',
    crash: 'Caída o bloqueo del renderer',
    dialog: 'Diálogo',
    'pg-notice': 'Aviso de PostgreSQL',
    'ui-error': 'Estado de error visible en la interfaz',
    'open-external': 'Apertura de un enlace externo',
    'isolation': 'Aislamiento',
  };
  if (event.type === 'ipc-reject' && event.code === 'INVALID_INPUT') return labels['ipc-invalid'];
  return labels[event.type] ?? event.type;
}

function classify(events, t, today) {
  const failures = [];
  const expected = [];
  const knownNoise = [];
  const warnings = [];
  for (const event of events) {
    const allowance = t.isAllowed(event);
    if (event.type === 'ipc-slow') {
      if (allowance) expected.push({ type: event.type, message: event.message, reason: allowance.reason });
      else warnings.push({ type: 'slow-ipc', message: `${event.channel} tardó ${event.durationMs} ms` });
      continue;
    }
    if (allowance) {
      expected.push({ type: event.type, message: event.message, reason: allowance.reason });
      continue;
    }
    const issue = matchKnownIssue(event);
    if (issue && issue.until >= today) {
      knownNoise.push({ id: issue.id, message: event.message });
      continue;
    }
    failures.push({
      type: event.type,
      message: `${describeEvent(event)}${event.source ? ` (${event.source})` : ''}: ${event.message}`,
      detail: event.detail === undefined ? undefined : brief(event.detail),
      knownIssueExpired: issue ? issue.id : undefined,
    });
  }
  return { failures, expected, knownNoise, warnings };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { isTimeout: true })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// `env`:
//   layer, defaultTimeoutMs
//   monitor: { mark(), since(mark), settle(mark) }
//   beforeGroup(group) -> groupCtx;  afterGroup(group, groupCtx)
//   decorate(t, groupCtx): agrega a `t` lo propio de la capa (db, api, ui...)
//   beforeTest(t, groupCtx) / afterTest(t, groupCtx), opcionales
// `select(test)` decide qué pruebas corren. `write(record)` recibe cada resultado.
async function runGroups(groups, env, { select, write }) {
  const today = localToday();
  for (const group of groups) {
    const selected = group.tests.filter((t) => !t.meta.invariants && select(t));
    if (!selected.length) continue;
    const toRun = [...selected, ...group.tests.filter((t) => t.meta.invariants)];

    let groupCtx;
    let groupError = null;
    const groupStart = Date.now();
    try {
      groupCtx = await env.beforeGroup(group);
    } catch (error) {
      groupError = error;
      // La base no es la de prueba: se corta la corrida antes de que alguna prueba escriba
      if (error.fatal) {
        write({ type: 'fatal', id: group.id, layer: env.layer, message: error.message });
        throw error;
      }
    }

    for (const definition of toRun) {
      if (definition.meta.retired) {
        write({ type: 'test', id: definition.id, layer: env.layer, status: 'retired', retired: definition.meta.retired });
        continue;
      }
      const t = new TestContext(definition);
      const started = Date.now();
      let mark = env.monitor.mark();
      if (groupError) {
        t.fail(`No se pudo preparar el grupo ${group.id}`, groupError.stack ?? String(groupError));
      } else {
        try {
          env.decorate(t, groupCtx);
          await env.beforeTest?.(t, groupCtx);
          mark = env.monitor.mark();
          const timeoutMs = definition.meta.timeoutMs ?? env.defaultTimeoutMs;
          await withTimeout(Promise.resolve().then(() => definition.fn(t)), timeoutMs, `La prueba superó su tiempo máximo (${timeoutMs} ms)`);
        } catch (error) {
          if (!(error instanceof AbortTest)) {
            t.fail(error.isTimeout ? error.message : `Excepción en la prueba: ${error.message}`, error.isTimeout ? undefined : error.stack);
          }
        }
        try {
          await env.monitor.settle(mark);
          await env.afterTest?.(t, groupCtx);
        } catch (error) {
          t.fail(`Error al cerrar la prueba: ${error.message}`, error.stack);
        }
      }

      let classified;
      try {
        classified = classify(env.monitor.since(mark), t, today);
      } catch (error) {
        classified = { failures: [{ type: 'harness', message: `Error de la suite al clasificar los eventos: ${error.message}`, detail: error.stack }], expected: [], knownNoise: [], warnings: [] };
      }
      const { failures, expected, knownNoise, warnings } = classified;
      const allFailures = [...t.failures, ...failures];
      let status = allFailures.length ? 'fail' : 'pass';
      const known = definition.meta.knownFailure;
      if (known) {
        if (known.until < today) {
          if (status === 'fail') allFailures.unshift({ type: 'known-expired', message: `Falla conocida vencida el ${known.until}: ${known.reason}` });
        } else {
          status = status === 'fail' ? 'known-fail' : 'known-pass';
        }
      }
      write({
        type: 'test',
        id: definition.id,
        layer: env.layer,
        status,
        durationMs: Date.now() - started,
        failures: allFailures,
        warnings: [...t.warnings, ...warnings],
        expected,
        knownNoise,
        steps: t.steps,
      });
    }

    try {
      if (groupCtx) await env.afterGroup(group, groupCtx);
    } catch (error) {
      write({ type: 'group-error', id: group.id, layer: env.layer, message: `Error al cerrar el grupo: ${error.message}`, detail: error.stack });
    }
    write({ type: 'group', id: group.id, layer: env.layer, durationMs: Date.now() - groupStart });
  }
}

// Escritura de resultados en JSON Lines: si el proceso se corta, lo escrito hasta ahí se conserva.
function jsonlWriter(file, onRecord) {
  return (record) => {
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    onRecord?.(record);
  };
}

module.exports = { runGroups, jsonlWriter, classify, localToday };
