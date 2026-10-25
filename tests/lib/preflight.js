// Comprobaciones del entorno antes de crear nada: si alguna falla, la corrida no empieza.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PATHS } = require('../config');
const { readEnv } = require('./env');
const { adminClient } = require('./pg-admin');
const clock = require('./clock');

function resolveFromRoot(name) {
  try {
    return require.resolve(name, { paths: [PATHS.root] });
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Devuelve { checks: [{ name, ok, detail, warning }], info }. `ok` false en alguna = abortar.
async function runPreflight() {
  const checks = [];
  const info = {};
  const add = (name, ok, detail, warning = false) => checks.push({ name, ok, detail, warning });

  const [major] = process.versions.node.split('.').map(Number);
  add('Node.js 18 o posterior', major >= 18, `v${process.versions.node}`);
  info.node = process.versions.node;

  for (const name of ['electron', 'pg', 'bcrypt', 'dotenv']) {
    add(`Dependencia ${name} instalada (npm install)`, Boolean(resolveFromRoot(name)));
  }
  let electronPath = null;
  try {
    electronPath = require(resolveFromRoot('electron'));
    info.electron = JSON.parse(fs.readFileSync(path.join(path.dirname(resolveFromRoot('electron')), 'package.json'), 'utf8')).version;
  } catch {}
  add('Ejecutable de Electron', Boolean(electronPath && fs.existsSync(electronPath)), electronPath);

  let env = null;
  try {
    env = readEnv();
    add('Archivo .env completo', true, `${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT} (base del usuario: ${env.DB_NAME}, no se usa)`);
  } catch (error) {
    add('Archivo .env completo', false, error.message);
  }

  const psql = spawnSync('psql', ['--version'], { encoding: 'utf8', windowsHide: true });
  add('psql en el PATH (carpeta bin de PostgreSQL)', psql.status === 0, (psql.stdout || psql.error?.message || '').trim());

  if (env) {
    const client = adminClient();
    try {
      await client.connect();
      const { rows } = await client.query(
        `SELECT version() AS version, rolcreatedb OR rolsuper AS can_create FROM pg_roles WHERE rolname = current_user`
      );
      info.postgres = rows[0].version.split(',')[0];
      add('PostgreSQL responde con las credenciales del .env', true, info.postgres);
      add('El usuario del .env puede crear bases', rows[0].can_create);
      const clocks = await clock.readClocks(client);
      info.clocks = clocks;
      add('El reloj de la base y el de la PC dan la misma fecha', clocks.db === clocks.node,
        `base ${clocks.db} ${clocks.dbTime} (${clocks.dbTimezone}), PC ${clocks.node} (${clocks.nodeTimezone})`);
      const [hours, minutes] = clocks.dbTime.split(':').map(Number);
      const nearMidnight = (hours === 23 && minutes >= 50) || (hours === 0 && minutes < 5);
      add('No es cerca de la medianoche (las fechas cambiarían durante la corrida)', !nearMidnight, clocks.dbTime);
      try {
        clock.frozenDate();
        add('Fecha de la corrida', true, process.env.TEST_TODAY ? `congelada en ${process.env.TEST_TODAY}` : `${clocks.db} (sin congelar: ver tests/lib/clock.js)`);
      } catch (error) {
        add('Fecha de la corrida', false, error.message);
      }
    } catch (error) {
      add('PostgreSQL responde con las credenciales del .env', false, error.message);
    } finally {
      await client.end().catch(() => {});
    }
  }

  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PATHS.root, encoding: 'utf8', windowsHide: true });
  add('git disponible (commit de la línea base)', git.status === 0, git.stdout?.trim(), git.status !== 0);

  const lockFile = path.join(PATHS.tmp, 'run.lock');
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    const alive = processAlive(lock.pid);
    add('No hay otra corrida de la suite en curso', !alive, alive ? `pid ${lock.pid}, desde ${lock.startedAt}` : 'quedó una marca vieja: se reemplaza');
  } else {
    add('No hay otra corrida de la suite en curso', true);
  }

  return { checks, info, electronPath };
}

module.exports = { runPreflight };
