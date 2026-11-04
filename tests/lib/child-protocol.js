// Protocolo entre el proceso que corre la suite (run.js) y cada proceso hijo de una capa: el hijo
// recibe sus opciones en la variable SUITE_ARGS (JSON, sin problemas de comillas en PowerShell ni en
// Git Bash) y escribe sus resultados en un archivo JSON Lines; por stdout solo avisa el progreso.
const fs = require('node:fs');
const path = require('node:path');
const { PATHS, LAYERS } = require('../config');

function readArgs() {
  if (!process.env.SUITE_ARGS) throw new Error('Falta SUITE_ARGS: este proceso lo lanza tests/run.js');
  return JSON.parse(process.env.SUITE_ARGS);
}

function layerFiles(layer) {
  const dir = path.join(PATHS.tests, LAYERS[layer].dir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.test.js')).sort().map((file) => path.join(dir, file));
}

// Qué pruebas corren según las opciones de la corrida.
function selector(args) {
  return (test) => {
    if (args.minimal && !test.meta.minimal) return false;
    if (args.grep && !args.grep.some((text) => test.id.includes(text))) return false;
    return true;
  };
}

function progress(record) {
  if (record.type !== 'test') return;
  const marks = { pass: 'ok  ', fail: 'FALLA', 'known-fail': 'conoc', 'known-pass': 'ok* ', retired: 'retir' };
  process.stdout.write(`  ${marks[record.status] ?? record.status} ${record.id} (${record.durationMs ?? 0} ms)\n`);
}

module.exports = { readArgs, layerFiles, selector, progress };
