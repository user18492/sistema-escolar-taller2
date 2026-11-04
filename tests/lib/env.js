// Configuración de conexión del .env, leída sin tocar process.env: la suite decide qué base usa cada
// proceso. La base del .env (la del usuario) nunca se escribe; solo se usan su servidor y su usuario.
const fs = require('node:fs');
const { PATHS, DB_PREFIX } = require('../config');

const dotenv = require(require.resolve('dotenv', { paths: [PATHS.root] }));

const REQUIRED = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

function readEnv() {
  if (!fs.existsSync(PATHS.envFile)) {
    throw new Error(`No existe ${PATHS.envFile}: copiá .env.example a .env (ver README.md).`);
  }
  const values = dotenv.parse(fs.readFileSync(PATHS.envFile));
  const missing = REQUIRED.filter((name) => !values[name]?.trim());
  if (missing.length) throw new Error(`Faltan variables en .env: ${missing.join(', ')}`);
  return values;
}

// Base del .env: la del usuario. Ninguna prueba la toca.
function userDbName() {
  return readEnv().DB_NAME;
}

// Lanza si `name` no es una base de la suite o es la del .env.
function assertTestDbName(name) {
  if (typeof name !== 'string' || !name.startsWith(DB_PREFIX) || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`"${name}" no es una base de prueba de la suite (prefijo ${DB_PREFIX}).`);
  }
  if (name === userDbName()) {
    throw new Error(`"${name}" es la base del .env: la suite no la usa.`);
  }
}

// Configuración de pg para una base de la suite (o la administrativa 'postgres').
function pgConfig(database) {
  if (database !== 'postgres') assertTestDbName(database);
  const env = readEnv();
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database,
    connectionTimeoutMillis: 5000,
  };
}

module.exports = { readEnv, userDbName, assertTestDbName, pgConfig };
