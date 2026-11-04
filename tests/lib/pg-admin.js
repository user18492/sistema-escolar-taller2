// Bases de prueba: cada corrida crea una plantilla desde db/schema.sql y db/seed.sql, como
// db/setup-db.ps1 (psql con ON_ERROR_STOP y PGCLIENTENCODING=UTF8), y cada grupo de pruebas trabaja
// sobre una copia limpia (CREATE DATABASE ... TEMPLATE). Todas llevan el prefijo de la suite: las
// funciones de este módulo se niegan a operar sobre cualquier otra, y nunca sobre la del .env.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PATHS, DB_PREFIX } = require('../config');
const { readEnv, assertTestDbName, pgConfig, userDbName } = require('./env');
const clock = require('./clock');

const { Client } = require(require.resolve('pg', { paths: [PATHS.root] }));

function adminClient() {
  const client = new Client(pgConfig('postgres'));
  client.__suite = 'admin';
  return client;
}

async function withAdmin(callback) {
  const client = adminClient();
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

// Ejecuta un archivo SQL con psql, como setup-db.ps1. Devuelve { ok, status, stdout, stderr }: con
// --quiet, psql solo escribe los avisos de PostgreSQL (NOTICE, WARNING) y los errores.
function runSqlFile(database, file) {
  assertTestDbName(database);
  const env = readEnv();
  const result = spawnSync(
    'psql',
    [
      '--host', env.DB_HOST,
      '--port', env.DB_PORT,
      '--username', env.DB_USER,
      '--dbname', database,
      '--no-password',
      '--set', 'ON_ERROR_STOP=1',
      '--quiet',
      '--file', file,
    ],
    {
      env: { ...process.env, PGPASSWORD: env.DB_PASSWORD, PGCLIENTENCODING: 'UTF8' },
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  if (result.error) throw result.error;
  return { ok: result.status === 0, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function dropDb(name) {
  assertTestDbName(name);
  await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
}

// Crea la plantilla de la corrida. Devuelve la salida de psql de cada archivo, para que la capa de
// base de datos compruebe que cargaron sin errores ni avisos. Si un archivo falla, borra la base.
// Con TEST_TODAY, la fecha se congela entre el esquema y el seed (clock.js), así el seed carga el
// ciclo lectivo de esa fecha.
async function createTemplate(name) {
  assertTestDbName(name);
  await dropDb(name);
  await withAdmin((admin) => admin.query(`CREATE DATABASE ${name}`));
  const schema = runSqlFile(name, PATHS.schema);
  if (schema.ok && clock.frozenDate()) {
    const client = await connectSuite(name, 'template');
    try {
      await clock.applyToDatabase(client);
    } finally {
      await client.end();
    }
  }
  const seed = schema.ok ? runSqlFile(name, PATHS.seed) : null;
  if (!schema.ok || !seed.ok) {
    await dropDb(name);
    const failed = !schema.ok ? schema : seed;
    throw new Error(`No se pudo crear la base de prueba: ${failed.stderr.trim()}`);
  }
  // Una plantilla con conexiones abiertas no se puede copiar
  return { schema, seed };
}

// Copia limpia de la plantilla para un grupo de pruebas.
async function cloneDb(template, name) {
  assertTestDbName(template);
  assertTestDbName(name);
  await dropDb(name);
  await withAdmin((admin) => admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`));
}

async function listSuiteDbs() {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query(
      `SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname`,
      [`${DB_PREFIX}%`]
    );
    return rows.map((row) => row.datname).filter((name) => name !== userDbName());
  });
}

// Bases de corridas anteriores que no pidieron conservarse (--keep-db deja una marca en tests/.tmp).
async function dropOrphanDbs(currentRunId) {
  const kept = new Set();
  const marksDir = path.join(PATHS.tmp, 'kept-dbs');
  if (fs.existsSync(marksDir)) fs.readdirSync(marksDir).forEach((file) => kept.add(file));
  const dropped = [];
  for (const name of await listSuiteDbs()) {
    if (name.includes(currentRunId) || kept.has(name)) continue;
    await dropDb(name);
    dropped.push(name);
  }
  return dropped;
}

function markKept(name) {
  const marksDir = path.join(PATHS.tmp, 'kept-dbs');
  fs.mkdirSync(marksDir, { recursive: true });
  fs.writeFileSync(path.join(marksDir, name), new Date().toISOString());
}

// Cliente de la suite para leer y preparar datos en una base de prueba. Antes de devolverlo
// comprueba desde la propia conexión que es la base pedida. `tag` lo distingue en los avisos de
// PostgreSQL que se registran (pg-hooks.js).
async function connectSuite(database, tag = 'suite') {
  assertTestDbName(database);
  const client = new Client(pgConfig(database));
  client.__suite = tag;
  await client.connect();
  const { rows } = await client.query('SELECT current_database() AS name');
  if (rows[0].name !== database) {
    await client.end();
    throw new Error(`El cliente de la suite quedó conectado a "${rows[0].name}" y no a "${database}".`);
  }
  return client;
}

module.exports = {
  Client,
  adminClient,
  withAdmin,
  runSqlFile,
  createTemplate,
  cloneDb,
  dropDb,
  listSuiteDbs,
  dropOrphanDbs,
  markKept,
  connectSuite,
};
