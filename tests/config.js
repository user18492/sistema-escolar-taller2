// Configuración compartida de la suite: rutas, nombres de las bases de prueba, tiempos máximos y las
// notas de restricciones que una prueba puede citar en `affectedBy`.
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = __dirname;

// Las bases de cada corrida empiezan con este prefijo. La suite solo crea, clona y borra bases con
// él, y nunca la del .env (pg-admin.js lo comprueba antes de cada operación).
const DB_PREFIX = 'sistema_escolar_suite_';

const PATHS = {
  root: ROOT,
  tests: TESTS_DIR,
  schema: path.join(ROOT, 'db', 'schema.sql'),
  seed: path.join(ROOT, 'db', 'seed.sql'),
  preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
  renderer: path.join(ROOT, 'renderer'),
  envFile: path.join(ROOT, '.env'),
  baseline: path.join(TESTS_DIR, 'baseline', 'baseline.json'),
  // Fuera de git (tests/.gitignore)
  results: path.join(TESTS_DIR, 'results'),
  tmp: path.join(TESTS_DIR, '.tmp'),
};

// Capas en el orden en que corren. `files` son relativos a tests/; `runtime` dice en qué proceso:
// node solo o Electron con la aplicación real.
const LAYERS = {
  db: { runtime: 'node', dir: 'db', timeoutMs: 120_000 },
  main: { runtime: 'electron', dir: 'main', timeoutMs: 240_000 },
  ui: { runtime: 'electron', dir: 'ui', timeoutMs: 420_000 },
  startup: { runtime: 'node', dir: 'startup', timeoutMs: 180_000 },
};

const TIMEOUTS = {
  // Por prueba, salvo que la prueba declare otro
  test: { db: 15_000, main: 30_000, ui: 90_000, startup: 60_000 },
  // Una llamada IPC sin respuesta después de este tiempo hace fallar la prueba
  ipcNoResponseMs: 10_000,
  // Una llamada IPC más lenta que esto genera un aviso, sin hacer fallar la prueba
  ipcSlowMs: 1_500,
  // Cada proceso de Electron del arranque
  startupProcessMs: 30_000,
};

// Notas de notas/restricciones (sin .txt) que una prueba puede citar en `affectedBy`. Un plan de
// plans/ se cita con su ruta ('plans/<archivo>.md'). '*' indica cualquier plan.
const RESTRICTION_NOTES = [
  'ciclo-lectivo',
  'administrador-usuarios',
  'administrador-cursos',
  'administrador-docencia',
  'profesor-evaluaciones',
  'profesor-calificaciones',
  'secretario-alumnos',
  'secretario-inscripciones',
];

module.exports = { ROOT, DB_PREFIX, PATHS, LAYERS, TIMEOUTS, RESTRICTION_NOTES };
