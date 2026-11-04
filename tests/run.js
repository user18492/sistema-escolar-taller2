#!/usr/bin/env node
// Punto de entrada de la suite: npm test [-- opciones]. Ver tests/README.md.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PATHS, LAYERS, DB_PREFIX } = require('./config');
const { loadFiles, describe, groups } = require('./lib/framework');
const { layerFiles, selector } = require('./lib/child-protocol');
const { runPreflight } = require('./lib/preflight');
const { createTemplate, dropDb, dropOrphanDbs, markKept, listSuiteDbs } = require('./lib/pg-admin');
const { readJsonl, loadBaseline, buildReport, formatReport, buildBaseline } = require('./lib/report');

const USAGE = `
Uso: npm test [-- opciones]

  --layer <capas>      Solo esas capas, separadas por coma: db, main, ui, startup (por defecto, todas)
  --minimal            Solo el flujo general mínimo (los tres roles encadenados)
  --grep <texto>       Solo las pruebas cuyo id contiene el texto (se puede repetir)
  --plan <nota|plan>   Plan en curso: sus fallas se informan aparte, como esperables
  --keep-db            Conserva las bases de prueba para depurar (se listan al final)
  --update-baseline    Guarda la línea base (solo con una corrida completa y sin fallas)
  --list               Lista las pruebas sin correrlas
  --help               Esta ayuda
`;

function parseArgs(argv) {
  const args = { layers: Object.keys(LAYERS), grep: [], minimal: false, keepDb: false, updateBaseline: false, list: false, plan: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--layer':
      case '--layers':
        args.layers = value().split(',').map((layer) => layer.trim()).filter(Boolean);
        break;
      case '--grep':
        args.grep.push(value());
        break;
      case '--plan':
        args.plan = value();
        break;
      case '--minimal':
        args.minimal = true;
        break;
      case '--keep-db':
        args.keepDb = true;
        break;
      case '--update-baseline':
        args.updateBaseline = true;
        break;
      case '--list':
        args.list = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Opción desconocida: ${argv[i]}\n${USAGE}`);
    }
  }
  const unknown = args.layers.filter((layer) => !LAYERS[layer]);
  if (unknown.length) throw new Error(`Capa desconocida: ${unknown.join(', ')}`);
  args.layers = Object.keys(LAYERS).filter((layer) => args.layers.includes(layer));
  if (!args.grep.length) args.grep = null;
  return args;
}

function loadCatalog() {
  const byLayer = {};
  for (const layer of Object.keys(LAYERS)) byLayer[layer] = loadFiles(layerFiles(layer), layer);
  return { byLayer, entries: groups.flatMap(describe) };
}

function onlyTestScriptChanged() {
  const head = git(['show', 'HEAD:package.json']);
  if (!head) return false;
  const before = JSON.parse(head);
  const after = JSON.parse(fs.readFileSync(path.join(PATHS.root, 'package.json'), 'utf8'));
  delete before.scripts?.test;
  delete after.scripts?.test;
  return JSON.stringify(before) === JSON.stringify(after);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: PATHS.root, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {}
  }
}

function runChild({ layer, command, entry, suiteArgs, runDir, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const stderrFile = path.join(runDir, `${layer}.stderr.log`);
    const stderr = fs.createWriteStream(stderrFile);
    const tempDir = path.join(runDir, `temp-${layer}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const child = spawn(command, [entry], {
      cwd: PATHS.root,
      env: { ...process.env, SUITE_ARGS: JSON.stringify(suiteArgs), TEMP: tempDir, TMP: tempDir, ELECTRON_NO_ATTACH_CONSOLE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      detached: process.platform !== 'win32',
    });
    let lastOutput = Date.now();
    child.stdout.on('data', (chunk) => {
      lastOutput = Date.now();
      process.stdout.write(chunk.toString().replace(/^(?=.)/gm, ''));
    });
    child.stderr.pipe(stderr);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.stdout.write(`  ✗ La capa ${layer} superó su tiempo máximo (${timeoutMs / 1000} s): se corta el proceso.\n`);
      killTree(child.pid);
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      stderr.end();
      resolve({ layer, durationMs: Date.now() - started, exitCode: code, signal, timedOut, stderrFile, idleMs: Date.now() - lastOutput });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ layer, durationMs: Date.now() - started, exitCode: null, error: error.message, stderrFile });
    });
  });
}

function expectedIdsFor(layerGroups, args) {
  const select = selector(args);
  const ids = [];
  for (const groupDef of layerGroups) {
    const selected = groupDef.tests.filter((t) => !t.meta.invariants && select(t));
    if (!selected.length) continue;
    ids.push(...selected.map((t) => t.id), ...groupDef.tests.filter((t) => t.meta.invariants).map((t) => t.id));
  }
  return ids;
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const catalog = loadCatalog();
  if (args.list) {
    for (const entry of catalog.entries) {
      process.stdout.write(`${entry.layer.padEnd(8)} ${entry.kind.padEnd(8)} ${entry.id} — ${entry.title}${entry.knownFailure ? ' [falla conocida]' : ''}${entry.affectedBy.length ? ` [${entry.affectedBy.join(', ')}]` : ''}\n`);
    }
    process.stdout.write(`${catalog.entries.length} pruebas\n`);
    return 0;
  }

  process.stdout.write('Comprobando el entorno…\n');
  const preflight = await runPreflight();
  for (const check of preflight.checks) {
    process.stdout.write(`  ${check.ok ? 'ok ' : check.warning ? '⚠  ' : '✗  '} ${check.name}${check.detail ? `: ${check.detail}` : ''}\n`);
  }
  if (preflight.checks.some((check) => !check.ok && !check.warning)) {
    process.stdout.write('\nEl entorno no está listo: no se corrió ninguna prueba.\n');
    return 2;
  }

  fs.mkdirSync(PATHS.tmp, { recursive: true });
  fs.mkdirSync(PATHS.results, { recursive: true });
  for (const dir of fs.readdirSync(PATHS.tmp).filter((name) => name.startsWith('run-'))) {
    fs.rmSync(path.join(PATHS.tmp, dir), { recursive: true, force: true });
  }
  const lockFile = path.join(PATHS.tmp, 'run.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const runId = `${stamp}_${Math.random().toString(36).slice(2, 6)}`;
  const runDir = path.join(PATHS.tmp, `run-${runId}`);
  fs.mkdirSync(runDir, { recursive: true });
  const dbBase = `${DB_PREFIX}${runId}`;
  const template = `${dbBase}_tpl`;

  const runInfo = {
    runId,
    commit: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    // Cambios sin commitear fuera de tests/: la línea base vale para el commit más estos archivos.
    // package.json cuenta solo si cambió algo más que el script de npm test.
    changedFiles: (git(['status', '--porcelain', '--', '.', ':(exclude)tests']) ?? '').split('\n').filter(Boolean)
      .map((line) => line.replace(/^\s*\S+\s+/, '')),
    today: preflight.info.clocks.db,
    dirty: false,
    environment: { node: preflight.info.node, electron: preflight.info.electron, postgres: preflight.info.postgres },
  };

  runInfo.dirty = runInfo.changedFiles.some((file) => file !== 'package.json' || !onlyTestScriptChanged());
  let exitCode = 1;
  try {
    const orphans = await dropOrphanDbs(runId);
    if (orphans.length) process.stdout.write(`Bases de corridas anteriores borradas: ${orphans.length}\n`);

    process.stdout.write(`\nCreando la base de la corrida (${template}) desde db/schema.sql y db/seed.sql…\n`);
    const created = await createTemplate(template);
    fs.writeFileSync(path.join(runDir, 'template.json'), JSON.stringify({
      schema: { stdout: created.schema.stdout, stderr: created.schema.stderr },
      seed: { stdout: created.seed.stdout, stderr: created.seed.stderr },
    }));

    const layerOutcomes = [];
    for (const layer of args.layers) {
      const expectedIds = expectedIdsFor(catalog.byLayer[layer], args);
      if (!expectedIds.length) continue;
      process.stdout.write(`\nCapa ${layer} (${expectedIds.length} pruebas)\n`);
      const resultsFile = path.join(runDir, `${layer}.jsonl`);
      const config = LAYERS[layer];
      const suiteArgs = {
        layer, runId, runDir, resultsFile, template, dbBase,
        minimal: args.minimal, grep: args.grep, keepDb: args.keepDb, electronPath: preflight.electronPath,
      };
      const outcome = await runChild({
        layer,
        command: config.runtime === 'electron' ? preflight.electronPath : process.execPath,
        entry: path.join(PATHS.tests, 'lib', config.runtime === 'electron' ? 'electron/entry.js' : 'node-entry.js'),
        suiteArgs,
        runDir,
        timeoutMs: config.timeoutMs,
      });
      const records = readJsonl(resultsFile);
      outcome.expectedIds = expectedIds;
      outcome.records = records;
      if (outcome.timedOut) outcome.problem = `superó su tiempo máximo (${config.timeoutMs / 1000} s)`;
      else if (outcome.error) outcome.problem = `no se pudo lanzar: ${outcome.error}`;
      else if (!records.some((record) => record.type === 'done')) {
        const stderrTail = fs.existsSync(outcome.stderrFile) ? fs.readFileSync(outcome.stderrFile, 'utf8').trim().split('\n').slice(-5).join(' | ') : '';
        outcome.problem = `el proceso terminó antes de completar la capa (código ${outcome.exitCode})${stderrTail ? `: ${stderrTail.slice(0, 300)}` : ''}`;
      }
      layerOutcomes.push(outcome);
      const fatal = records.find((record) => record.type === 'fatal');
      if (fatal) {
        outcome.problem = `ABORTADA: ${fatal.message}`;
        process.stdout.write(`\n  ✗ ${outcome.problem}\n  No se corren las capas que faltaban.\n`);
        break;
      }
    }

    if (args.keepDb) {
      markKept(template);
      const kept = (await listSuiteDbs()).filter((name) => name.includes(runId));
      process.stdout.write(`\nBases conservadas (--keep-db): ${kept.join(', ')}\n`);
    } else {
      await dropDb(template);
      for (const name of (await listSuiteDbs()).filter((db) => db.includes(runId))) await dropDb(name);
    }

    runInfo.durationMs = Date.now() - startedAt;
    const records = layerOutcomes.flatMap((outcome) => outcome.records);
    const baseline = loadBaseline();
    const report = buildReport({
      catalog: catalog.entries,
      records,
      baseline,
      args,
      runInfo,
      layerOutcomes: layerOutcomes.map(({ records: _records, ...rest }) => rest),
    });
    const text = formatReport(report, catalog.entries);
    fs.writeFileSync(path.join(PATHS.results, `${runId}.json`), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(PATHS.results, 'latest.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(PATHS.results, 'latest.txt'), `${text}\n`);
    process.stdout.write(`${text}\n`);
    exitCode = report.exitCode;

    if (args.updateBaseline) {
      const problems = [];
      if (args.minimal || args.grep || args.layers.length !== Object.keys(LAYERS).length) problems.push('la corrida no es completa');
      if (report.exitCode !== 0) problems.push('la corrida tiene fallas (corregirlas o marcarlas como falla conocida)');
      if (problems.length) {
        process.stdout.write(`\nNo se guardó la línea base: ${problems.join('; ')}.\n`);
        exitCode = 1;
      } else {
        fs.mkdirSync(path.dirname(PATHS.baseline), { recursive: true });
        fs.writeFileSync(PATHS.baseline, `${JSON.stringify(buildBaseline({ report, catalog: catalog.entries, runInfo }), null, 2)}\n`);
        process.stdout.write(`\nLínea base guardada en ${path.relative(PATHS.root, PATHS.baseline)} (commit ${runInfo.commit}${runInfo.dirty ? ', con cambios sin commitear' : ''}).\n`);
      }
    }
  } finally {
    fs.rmSync(lockFile, { force: true });
    // Con fallas se conservan los registros de la corrida (stderr de cada capa) hasta la próxima
    if (!args.keepDb && exitCode === 0) fs.rmSync(runDir, { recursive: true, force: true });
  }
  return exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stdout.write(`\nERROR de la suite: ${error.stack ?? error}\n`);
    process.exitCode = 2;
  }
);
