// Definición de grupos y pruebas. Los archivos *.test.js llaman a group() y, dentro, a test(); al
// cargarlos solo se registran, sin ejecutar nada, así que el proceso que corre la suite (node) puede
// listarlas y compararlas con la línea base aunque corran en Electron.
//
// Metadatos de una prueba (tercer argumento de test):
//   kind: 'stable' (por defecto) o 'current'. Una estable comprueba algo que ningún plan va a
//     cambiar: si falla, es una regresión. Una 'current' refleja un comportamiento de hoy que una
//     restricción pendiente va a cambiar, y lleva `affectedBy`.
//   affectedBy: notas de notas/restricciones (sin .txt, ver config.js) o planes ('plans/x.md') que
//     pueden cambiar lo que comprueba. Con --plan, sus fallas se informan como esperables del plan.
//   history: [{ plan, date, change }]: cada modificación de la prueba, con el plan que la pidió. El
//     informe señala toda prueba que cambió respecto de la línea base sin sumar una entrada.
//   knownFailure: { reason, until: 'AAAA-MM-DD', ref }: un bug conocido sin corregir. La prueba
//     comprueba el comportamiento correcto; mientras falle se informa como falla conocida, y vencida
//     la fecha cuenta como falla.
//   retired: { plan, reason }: la prueba ya no corre, pero queda en la suite (nunca se borra).
//   minimal: true: forma parte del flujo general mínimo (npm test -- --minimal).
//   timeoutMs: tiempo máximo de la prueba.
const crypto = require('node:crypto');
const { RESTRICTION_NOTES } = require('../config');

const groups = [];
let currentGroup = null;

// `options.db`: 'clone' (por defecto) da al grupo una copia limpia de la base de la corrida; 'none',
// ninguna. `options.setup(ctx)` prepara los datos propios del grupo antes de sus pruebas.
function group(id, title, options, body) {
  if (typeof options === 'function') {
    body = options;
    options = {};
  }
  if (groups.some((existing) => existing.id === id)) throw new Error(`Grupo repetido: ${id}`);
  const definition = { id, title, options: { db: 'clone', ...options }, tests: [], file: currentFile };
  groups.push(definition);
  currentGroup = definition;
  try {
    body();
    // Todo grupo con base propia termina comprobando las invariantes de datos (lib/invariants.js):
    // corre siempre que corra alguna otra prueba del grupo.
    if (definition.options.db === 'clone' && definition.options.invariants !== false) {
      test('invariants', 'Invariantes de datos al cerrar el grupo', { kind: 'stable', invariants: true }, async (t) => {
        await t.checkInvariants();
      });
    }
  } finally {
    currentGroup = null;
  }
  return definition;
}

function validateMeta(id, meta) {
  const problems = [];
  if (!['stable', 'current'].includes(meta.kind)) problems.push(`kind inválido: ${meta.kind}`);
  if (meta.kind === 'current' && !meta.affectedBy?.length) {
    problems.push("una prueba 'current' tiene que declarar affectedBy");
  }
  for (const note of meta.affectedBy ?? []) {
    if (note !== '*' && !RESTRICTION_NOTES.includes(note) && !/^plans\/.+\.md$/.test(note)) {
      problems.push(`affectedBy desconocido: ${note}`);
    }
  }
  if (meta.knownFailure && !(meta.knownFailure.reason && /^\d{4}-\d{2}-\d{2}$/.test(meta.knownFailure.until ?? ''))) {
    problems.push('knownFailure necesita reason y until (AAAA-MM-DD)');
  }
  for (const entry of meta.history ?? []) {
    if (!entry.plan || !entry.change) problems.push('cada entrada de history necesita plan y change');
  }
  if (problems.length) throw new Error(`Prueba ${id}: ${problems.join('; ')}`);
}

// Huella de la prueba: su código y sus metadatos, sin `history` ni `knownFailure`, que cambian sin
// cambiar lo que se comprueba. Se normalizan los fines de línea (git los convierte en Windows).
function fingerprint(fn, meta) {
  const { history, knownFailure, ...rest } = meta;
  const code = fn.toString().replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  return crypto.createHash('sha1').update(code).update(JSON.stringify(rest)).digest('hex').slice(0, 12);
}

function test(id, title, meta, fn) {
  if (!currentGroup) throw new Error(`test("${id}") fuera de un group()`);
  if (typeof meta === 'function') {
    fn = meta;
    meta = {};
  }
  const fullId = `${currentGroup.id}.${id}`;
  const normalized = { kind: 'stable', affectedBy: [], history: [], ...meta };
  validateMeta(fullId, normalized);
  if (currentGroup.tests.some((existing) => existing.id === fullId)) throw new Error(`Prueba repetida: ${fullId}`);
  currentGroup.tests.push({
    id: fullId,
    title,
    meta: normalized,
    fn,
    group: currentGroup.id,
    hash: fingerprint(fn, normalized),
  });
}

let currentFile = null;

// Carga los archivos de prueba de una capa y devuelve sus grupos, en el orden de los archivos.
function loadFiles(files, layer) {
  const before = groups.length;
  for (const file of files) {
    currentFile = file;
    require(file);
  }
  currentFile = null;
  const loaded = groups.slice(before);
  loaded.forEach((definition) => {
    definition.layer = layer;
    definition.tests.forEach((t) => { t.layer = layer; });
  });
  return loaded;
}

// Datos de cada prueba para el informe y la línea base, sin funciones.
function describe(definition) {
  return definition.tests.map((t) => ({
    id: t.id,
    title: t.title,
    group: t.group,
    layer: t.layer,
    hash: t.hash,
    kind: t.meta.kind,
    affectedBy: t.meta.affectedBy,
    historyCount: t.meta.history.length,
    history: t.meta.history,
    knownFailure: t.meta.knownFailure ?? null,
    retired: t.meta.retired ?? null,
    minimal: Boolean(t.meta.minimal),
  }));
}

module.exports = { group, test, loadFiles, describe, groups };
