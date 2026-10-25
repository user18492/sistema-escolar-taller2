// Informe de una corrida: resumen por capa, fallas con su detalle, comparación con la línea base
// (regresiones, pruebas nuevas, eliminadas o modificadas sin citar un plan), fallas conocidas,
// avisos, cobertura de canales e inventario del esquema. También decide el código de salida.
const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../config');
const { exposedChannels } = require('./channels');
const { diffInventory } = require('./inventory');

// Pruebas cuyas llamadas no cuentan para la cobertura: llaman a todos los canales sin datos útiles.
const COVERAGE_EXCLUDED = [/^main\.permissions\./, /^main\.handlers\./];

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { type: 'corrupt', line };
    }
  });
}

function loadBaseline() {
  if (!fs.existsSync(PATHS.baseline)) return null;
  return JSON.parse(fs.readFileSync(PATHS.baseline, 'utf8'));
}

// Cobertura: por canal expuesto, cuántas llamadas hicieron las pruebas (sin la matriz de permisos
// ni la de handlers), cuántas resolvieron sin error y qué pruebas las hicieron.
function buildCoverage(records) {
  const channels = Object.fromEntries(exposedChannels().map((channel) => [channel, { calls: 0, ok: 0, rejected: {}, tests: [] }]));
  for (const record of records.filter((r) => r.type === 'ipc-calls')) {
    for (const call of record.calls) {
      if (COVERAGE_EXCLUDED.some((pattern) => pattern.test(call.test ?? ''))) continue;
      const entry = channels[call.channel] ?? (channels[call.channel] = { calls: 0, ok: 0, rejected: {}, tests: [], notExposed: true });
      entry.calls += call.calls;
      entry.ok += call.ok;
      for (const [code, count] of Object.entries(call.rejected ?? {})) entry.rejected[code] = (entry.rejected[code] ?? 0) + count;
      if (call.test && !entry.tests.includes(call.test)) entry.tests.push(call.test);
    }
  }
  return channels;
}

function compareWithBaseline({ catalog, results, baseline, partial }) {
  const comparison = { regressions: [], fixed: [], newTests: [], removed: [], modifiedWithoutPlan: [], modifiedWithPlan: [], statusChanges: [] };
  if (!baseline) return comparison;
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  for (const [id, before] of Object.entries(baseline.tests)) {
    const now = byId.get(id);
    if (!now) {
      comparison.removed.push({ id, layer: before.layer });
      continue;
    }
    if (now.hash !== before.hash) {
      // Retirarla citando el plan (retired.plan) también cuenta como modificación con plan
      const retiredNow = now.retired?.plan && before.status !== 'retired';
      const grew = now.historyCount > (before.historyCount ?? 0) || Boolean(retiredNow);
      const entry = { id, plans: [...now.history.slice(before.historyCount ?? 0).map((h) => h.plan), ...(retiredNow ? [now.retired.plan] : [])] };
      (grew ? comparison.modifiedWithPlan : comparison.modifiedWithoutPlan).push(entry);
    }
    const result = results.get(id);
    if (!result) continue;
    const was = before.status;
    const is = result.status;
    if ((was === 'pass' || was === 'known-pass') && is === 'fail') comparison.regressions.push(id);
    else if (was === 'known-fail' && (is === 'pass' || is === 'known-pass')) comparison.fixed.push(id);
    else if (was !== is) comparison.statusChanges.push({ id, was, is });
  }
  for (const entry of catalog) if (!(entry.id in baseline.tests)) comparison.newTests.push(entry.id);
  comparison.partial = partial;
  return comparison;
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function buildReport(input) {
  const { catalog, records, baseline, args, runInfo, layerOutcomes } = input;
  const results = new Map(records.filter((r) => r.type === 'test').map((r) => [r.id, r]));
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const partial = Boolean(args.minimal || args.grep?.length || args.layers.length < 4);

  // Pruebas que debían correr y no informaron resultado (la capa se cortó o se colgó)
  const missing = [];
  for (const outcome of layerOutcomes) {
    for (const id of outcome.expectedIds) if (!results.has(id)) missing.push({ id, layer: outcome.layer, reason: outcome.problem ?? 'sin resultado' });
  }

  const plan = args.plan;
  const affectedByPlan = (entry) => plan && (entry.affectedBy.includes(plan) || entry.affectedBy.includes('*')
    || entry.affectedBy.some((note) => plan.includes(note)));
  const failures = [...results.values()].filter((r) => r.status === 'fail');
  const planFailures = failures.filter((r) => affectedByPlan(catalogById.get(r.id) ?? { affectedBy: [] }));
  const otherFailures = failures.filter((r) => !planFailures.includes(r));

  const comparison = compareWithBaseline({ catalog, results, baseline, partial });
  // Las fallas esperables del plan en curso no se cuentan como regresiones
  const planIds = new Set(planFailures.map((r) => r.id));
  comparison.planExpected = comparison.regressions.filter((id) => planIds.has(id));
  comparison.regressions = comparison.regressions.filter((id) => !planIds.has(id));
  const ranIpc = records.some((record) => record.type === 'ipc-calls');
  const coverage = ranIpc ? buildCoverage(records) : {};
  const uncovered = Object.entries(coverage).filter(([, entry]) => !entry.notExposed && entry.calls === 0).map(([channel]) => channel);
  const neverOk = Object.entries(coverage).filter(([, entry]) => !entry.notExposed && entry.calls > 0 && entry.ok === 0).map(([channel]) => channel);

  const inventoryRecord = records.find((r) => r.type === 'inventory');
  const inventoryDiff = inventoryRecord && baseline?.inventory ? diffInventory(baseline.inventory, inventoryRecord.inventory) : null;

  const knownNoise = {};
  const warnings = [];
  for (const result of results.values()) {
    for (const noise of result.knownNoise ?? []) knownNoise[noise.id] = (knownNoise[noise.id] ?? 0) + 1;
    for (const warning of result.warnings ?? []) warnings.push({ id: result.id, ...warning });
  }

  const counts = {};
  for (const result of results.values()) {
    counts[result.layer] ??= { pass: 0, fail: 0, 'known-fail': 0, 'known-pass': 0, retired: 0 };
    counts[result.layer][result.status] = (counts[result.layer][result.status] ?? 0) + 1;
  }

  for (const record of records.filter((r) => r.type === 'isolation-problem' || r.type === 'group-error')) {
    const outcome = layerOutcomes.find((candidate) => candidate.layer === record.layer);
    if (outcome) outcome.problem = [outcome.problem, record.message].filter(Boolean).join('; ');
  }
  const layerProblems = layerOutcomes.filter((outcome) => outcome.problem);
  const flagged = comparison.removed.length + comparison.modifiedWithoutPlan.length;
  const exitCode = failures.length || missing.length || layerProblems.length || flagged ? 1 : 0;

  return {
    runInfo,
    args,
    exitCode,
    counts,
    failures: { all: failures, plan: planFailures, other: otherFailures, missing },
    knownFailures: [...results.values()].filter((r) => r.status === 'known-fail' || r.status === 'known-pass')
      .map((r) => ({ id: r.id, status: r.status, ...catalogById.get(r.id)?.knownFailure })),
    comparison,
    baselineInfo: baseline ? { commit: baseline.commit, takenAt: baseline.takenAt, year: baseline.year } : null,
    coverage: { channels: coverage, uncovered, neverOk },
    inventory: inventoryRecord?.inventory ?? null,
    inventoryDiff,
    knownNoise,
    warnings,
    layerOutcomes,
    results: Object.fromEntries(results),
  };
}

function formatReport(report, catalog) {
  const lines = [];
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const { runInfo } = report;
  lines.push('', '='.repeat(78));
  lines.push(`Resumen de la suite — corrida ${runInfo.runId}`);
  lines.push(`Commit ${runInfo.commit ?? '?'}${runInfo.dirty ? ' (con cambios sin commitear)' : ''} · rama ${runInfo.branch ?? '?'} · hoy ${runInfo.today} · ${Math.round(runInfo.durationMs / 1000)} s`);
  if (report.args.plan) lines.push(`Plan en curso: ${report.args.plan}`);
  lines.push('='.repeat(78));
  lines.push(`${pad('Capa', 9)}${pad('ok', 6)}${pad('fallas', 8)}${pad('conocidas', 11)}${pad('retiradas', 10)}tiempo`);
  for (const outcome of report.layerOutcomes) {
    const c = report.counts[outcome.layer] ?? {};
    const known = (c['known-fail'] ?? 0) + (c['known-pass'] ?? 0);
    lines.push(`${pad(outcome.layer, 9)}${pad((c.pass ?? 0), 6)}${pad(c.fail ?? 0, 8)}${pad(known, 11)}${pad(c.retired ?? 0, 10)}${Math.round(outcome.durationMs / 1000)} s${outcome.problem ? `  ← ${outcome.problem}` : ''}`);
  }

  const describeFailure = (result) => {
    const entry = catalogById.get(result.id);
    lines.push(`  ✗ ${result.id}${entry ? ` — ${entry.title}` : ''}${entry?.kind === 'current' ? ` [current: ${entry.affectedBy.join(', ')}]` : ''}`);
    for (const failure of result.failures.slice(0, 8)) {
      lines.push(`      · ${failure.step ? `[${failure.step}] ` : ''}${failure.message}`);
      if (failure.detail) lines.push(`        ${failure.detail.slice(0, 400)}`);
    }
    if (result.failures.length > 8) lines.push(`      · … ${result.failures.length - 8} más (ver results/latest.json)`);
  };

  if (report.failures.other.length) {
    lines.push('', `FALLAS (${report.failures.other.length}):`);
    report.failures.other.forEach(describeFailure);
  }
  if (report.failures.plan.length) {
    lines.push('', `Fallas esperables del plan en curso (${report.failures.plan.length}): pruebas con affectedBy de ese plan; actualizar su expectativa citándolo.`);
    report.failures.plan.forEach(describeFailure);
  }
  if (report.failures.missing.length) {
    lines.push('', `SIN RESULTADO (${report.failures.missing.length}): la capa se cortó antes de correrlas.`);
    for (const missing of report.failures.missing.slice(0, 20)) lines.push(`  ✗ ${missing.id} (${missing.reason})`);
  }

  const cmp = report.comparison;
  lines.push('', 'Comparación con la línea base:');
  if (!report.baselineInfo) lines.push('  (no hay línea base: npm test -- --update-baseline)');
  else {
    lines.push(`  línea base del commit ${report.baselineInfo.commit} (${report.baselineInfo.takenAt.slice(0, 10)})`);
    if (report.baselineInfo.year !== Number(runInfo.today.slice(0, 4))) {
      lines.push(`  ⚠ La línea base se tomó en ${report.baselineInfo.year}: con otro año el seed queda en un ciclo cerrado y la comparación no vale (ver README).`);
    }
    lines.push(`  regresiones: ${cmp.regressions.length ? cmp.regressions.join(', ') : 'ninguna'}`);
    if (cmp.planExpected?.length) lines.push(`  cambios esperables del plan en curso: ${cmp.planExpected.join(', ')}`);
    if (cmp.fixed.length) lines.push(`  fallas conocidas que ya no ocurren (quitar knownFailure): ${cmp.fixed.join(', ')}`);
    if (cmp.newTests.length) lines.push(`  pruebas nuevas: ${cmp.newTests.length}${cmp.newTests.length <= 12 ? ` (${cmp.newTests.join(', ')})` : ''}`);
    if (cmp.removed.length) lines.push(`  ✗ PRUEBAS ELIMINADAS (no se borran: retirarlas con retired citando el plan): ${cmp.removed.map((r) => r.id).join(', ')}`);
    if (cmp.modifiedWithoutPlan.length) lines.push(`  ✗ PRUEBAS MODIFICADAS SIN CITAR UN PLAN en history: ${cmp.modifiedWithoutPlan.map((m) => m.id).join(', ')}`);
    if (cmp.modifiedWithPlan.length) lines.push(`  modificadas citando su plan: ${cmp.modifiedWithPlan.map((m) => `${m.id} (${m.plans.join(', ')})`).join(', ')}`);
    for (const change of cmp.statusChanges.slice(0, 10)) lines.push(`  cambio de estado: ${change.id} ${change.was} → ${change.is}`);
  }

  if (report.knownFailures.length) {
    lines.push('', `Fallas conocidas (${report.knownFailures.length}):`);
    for (const known of report.knownFailures) {
      lines.push(`  ${known.status === 'known-pass' ? '!' : '·'} ${known.id} — hasta ${known.until}: ${known.reason}${known.status === 'known-pass' ? ' (YA NO FALLA: quitar la marca)' : ''}`);
    }
  }
  const noise = Object.entries(report.knownNoise);
  if (noise.length) lines.push('', `Ruido conocido (known-issues.js): ${noise.map(([id, count]) => `${id} ×${count}`).join(', ')}`);
  if (report.warnings.length) {
    lines.push('', `Avisos (${report.warnings.length}):`);
    for (const warning of report.warnings.slice(0, 15)) lines.push(`  · ${warning.id}: ${warning.message}`);
    if (report.warnings.length > 15) lines.push(`  · … ${report.warnings.length - 15} más`);
  }
  const exposed = Object.values(report.coverage.channels).filter((entry) => !entry.notExposed);
  if (exposed.length) {
    lines.push('', `Cobertura de canales IPC: ${exposed.length - report.coverage.uncovered.length}/${exposed.length} llamados por alguna prueba (sin contar la matriz de permisos)`);
  }
  if (report.coverage.uncovered.length || report.coverage.neverOk.length) {
    if (report.coverage.uncovered.length) lines.push(`  sin llamar por ninguna prueba: ${report.coverage.uncovered.join(', ')}`);
    if (report.coverage.neverOk.length) lines.push(`  llamados solo con rechazos: ${report.coverage.neverOk.join(', ')}`);
  }
  if (report.inventoryDiff && Object.keys(report.inventoryDiff).length) {
    lines.push('', 'Inventario del esquema respecto de la línea base:');
    for (const [kind, diff] of Object.entries(report.inventoryDiff)) {
      const parts = [];
      if (diff.added.length) parts.push(`+${diff.added.join(', +')}`);
      if (diff.removed.length) parts.push(`-${diff.removed.join(', -')}`);
      if (diff.changed.length) parts.push(`~${diff.changed.join(', ~')}`);
      lines.push(`  ${kind}: ${parts.join(' ')}`);
    }
  }
  lines.push('', report.exitCode === 0 ? 'RESULTADO: OK' : 'RESULTADO: CON FALLAS (código de salida 1)');
  lines.push(`Detalle: ${path.relative(PATHS.root, path.join(PATHS.results, 'latest.json'))} y latest.txt`);
  return lines.join('\n');
}

// Línea base: el commit, el resultado de cada prueba, la cobertura de canales y el inventario.
function buildBaseline({ report, catalog, runInfo }) {
  const tests = {};
  for (const entry of catalog) {
    const result = report.results[entry.id];
    tests[entry.id] = {
      layer: entry.layer,
      status: result?.status ?? 'not-run',
      hash: entry.hash,
      kind: entry.kind,
      affectedBy: entry.affectedBy,
      historyCount: entry.historyCount,
      knownFailure: entry.knownFailure ? { reason: entry.knownFailure.reason, until: entry.knownFailure.until } : null,
    };
  }
  const channels = Object.fromEntries(Object.entries(report.coverage.channels).map(([channel, entry]) => [
    channel, { calls: entry.calls, ok: entry.ok, tests: entry.tests.length },
  ]));
  return {
    version: 1,
    takenAt: new Date().toISOString(),
    commit: runInfo.commit,
    branch: runInfo.branch,
    dirty: runInfo.dirty,
    changedFiles: runInfo.changedFiles,
    today: runInfo.today,
    year: Number(runInfo.today.slice(0, 4)),
    environment: runInfo.environment,
    tests,
    channels,
    inventory: report.inventory,
  };
}

module.exports = { readJsonl, loadBaseline, buildReport, formatReport, buildBaseline };
