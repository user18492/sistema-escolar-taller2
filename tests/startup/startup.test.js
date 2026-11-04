// Capa startup: arranque de la aplicación con su main.js real, cada escenario en su propio proceso de
// Electron con un tiempo máximo (lib/electron/startup-app.js). Base caída, base inexistente,
// arranque normal (ventana, bandeja, ocultar y salir), cierre de los ciclos lectivos vencidos y
// base que deja de responder con la aplicación abierta (bug conocido del login).
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { PATHS, TIMEOUTS, DB_PREFIX } = require('../config');

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Lanza el escenario y devuelve lo que escribió la aplicación, el código de salida y si hubo que
// cortarla por tiempo. `scenario.dir`, si llega, nombra la carpeta de la corrida en lugar de
// `scenario.name` (dos pruebas con el mismo escenario).
function runScenario(t, scenario) {
  const dir = path.join(t.runDir, `startup-${scenario.dir ?? scenario.name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const resultFile = path.join(dir, 'outcome.json');
  const env = { ...process.env, STARTUP_SCENARIO: JSON.stringify({ ...scenario, runDir: dir, resultFile }), TEMP: dir, TMP: dir };
  delete env.SUITE_ARGS;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(t.args.electronPath, [path.join(PATHS.tests, 'lib', 'electron', 'startup-app.js')], { cwd: PATHS.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    }, TIMEOUTS.startupProcessMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const outcome = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
      resolve({ outcome, code, timedOut, durationMs: Date.now() - started, stderr: stderr.slice(-500) });
    });
  });
}

// Los eventos de la aplicación que el escenario no esperaba hacen fallar la prueba.
function checkEvents(t, events, allowed = []) {
  for (const event of events ?? []) {
    if (event.type === 'console' && /Electron Security Warning \(Insecure Content-Security-Policy\)/.test(event.message)) continue;
    if (allowed.some((pattern) => pattern.test(event.message))) continue;
    t.fail(`Evento no esperado en el arranque (${event.type}, ${event.source}): ${event.message}`);
  }
}

group('startup.app', 'Arranque de la aplicación (main.js)', () => {
  test('db-down', 'Con PostgreSQL caído, la aplicación muestra el error de conexión y se cierra sin abrir la ventana', async (t) => {
    const result = await runScenario(t, { name: 'db-down', dbName: t.dbName, closedPort: await freePort() });
    t.require(!result.timedOut, `La aplicación no se cerró en ${TIMEOUTS.startupProcessMs / 1000} s`, result);
    t.require(result.outcome, 'La aplicación no informó nada', result);
    t.equal(result.outcome.dialogs.length, 1, 'Mostró un diálogo de error');
    t.equal(result.outcome.windows.length, 0, 'No abrió ninguna ventana');
    t.check(result.outcome.quitAt, 'La aplicación terminó');
    checkEvents(t, result.outcome.events, [/No se pudo conectar a la base de datos/]);
  });

  test('db-missing', 'Con una base que no existe, la aplicación muestra el error y se cierra', async (t) => {
    const result = await runScenario(t, { name: 'db-missing', dbName: `${DB_PREFIX}no_existe_${process.pid}` });
    t.require(!result.timedOut && result.outcome, 'La aplicación no se cerró sola', result);
    t.equal(result.outcome.dialogs.length, 1, 'Mostró un diálogo de error');
    t.equal(result.outcome.windows.length, 0, 'No abrió ninguna ventana');
    checkEvents(t, result.outcome.events, [/No se pudo conectar a la base de datos/]);
  });

  test('normal-start', 'Con la base disponible, abre el login; ✕ oculta la ventana, la bandeja la muestra y "Salir" cierra la aplicación', async (t) => {
    const result = await runScenario(t, { name: 'ok', dbName: t.dbName });
    t.require(!result.timedOut && result.outcome, 'La aplicación no terminó al pedir Salir', result);
    const { steps, dialogs } = result.outcome;
    t.equal(dialogs, [], 'Sin diálogos de error');
    t.equal(steps.database, t.dbName, 'La aplicación quedó conectada a la base de prueba');
    t.check(steps.windowOpened && steps.loginView, 'Abrió la ventana con el login', steps);
    t.check(steps.hiddenOnClose, '✕ ocultó la ventana sin cerrarla', steps);
    t.check(steps.shownFromTray, 'La bandeja volvió a mostrar la ventana', steps);
    t.check(result.outcome.quitAt && result.outcome.quitAt - steps.quitRequestedAt < 5000, 'Salir cerró la aplicación', result.outcome);
    t.equal(result.code, 0, 'Código de salida');
    checkEvents(t, result.outcome.events);
  });

  test('closes-past-school-years', 'Al arrancar, una inscripción activa de un ciclo cerrado pasa a finalizada; una cancelada y una activa dada de baja no cambian', async (t) => {
    const { fixtures } = t;
    const enrollments = await fixtures.inSchoolYear(fixtures.year - 1, async () => {
      const course = await fixtures.createCourse();
      const enroll = async (options = {}) => fixtures.enroll({ studentId: (await fixtures.createStudent()).id, courseId: course.id, ...options });
      return {
        active: await enroll(),
        cancelled: await enroll({ status: 'CANCELADA' }),
        deleted: await enroll({ deleted: true }),
      };
    });
    const rowsOf = () => t.sql(`
      SELECT i.inscripcion_id, i.alumno_id, i.curso_id, e.nombre AS estado, i.fecha_inscripcion::TEXT, i.fecha_eliminacion::TEXT
        FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
       WHERE i.inscripcion_id = ANY($1) ORDER BY i.inscripcion_id`, [Object.values(enrollments)]);
    const before = await rowsOf();

    const result = await runScenario(t, { name: 'ok', dir: 'closes-past-school-years', dbName: t.dbName });
    t.require(!result.timedOut && result.outcome, 'La aplicación no terminó al pedir Salir', result);
    t.equal(result.outcome.dialogs, [], 'Sin diálogos de error');
    t.check(result.outcome.steps.windowOpened && result.outcome.steps.loginView, 'Abrió la ventana con el login', result.outcome.steps);
    checkEvents(t, result.outcome.events);

    const expected = before.map((row) => (row.inscripcion_id === enrollments.active ? { ...row, estado: 'FINALIZADA' } : row));
    t.equal(await rowsOf(), expected, 'Solo la activa y vigente cambió, y solo su estado');
  });

  test('login-db-hang', 'Si la base deja de responder con la aplicación abierta, el login responde con un error en un tiempo razonable', {
    knownFailure: {
      reason: 'connection.js no configura query_timeout ni statement_timeout: con una conexión ya abierta en el pool, el login queda en "Ingresando…" indefinidamente (hallazgo previo, sin corregir).',
      until: '2026-12-31',
      ref: 'memoria: login-e2e-findings',
    },
  }, async (t) => {
    const result = await runScenario(t, {
      name: 'login-hang', dbName: t.dbName, email: SEED_USERS.admin.email, password: SEED_USERS.admin.password, answerWithinMs: 12000,
    });
    t.require(!result.timedOut && result.outcome, 'El escenario no terminó', result);
    t.check(result.outcome.steps.loginView, 'Abrió el login antes de cortar la base', result.outcome.steps);
    t.check(result.outcome.steps.loginAnswered, `El login no respondió en 12 s con la base colgada (${result.outcome.steps.loginMs} ms)`, result.outcome.steps);
  });
});
