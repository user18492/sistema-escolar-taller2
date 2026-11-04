// Base propia de cada grupo: copia limpia de la plantilla de la corrida, cliente de la suite para
// leer y preparar datos, fecha de hoy según la base y los datos del `setup` del grupo. Lo comparten
// las capas que corren en node y en Electron.
const path = require('node:path');
const { PATHS } = require('../config');
const { cloneDb, dropDb, markKept, connectSuite } = require('./pg-admin');
const { assertTestDbName, readEnv, userDbName } = require('./env');
const { Fixtures } = require('./fixtures');
const clock = require('./clock');
const invariants = require('./invariants');

// Apunta la conexión de la aplicación (src/main/database/connection.js) a `dbName` y comprueba desde
// esa misma conexión que quedó conectada a la base de prueba. Si no, corta la corrida antes de que
// alguna prueba escriba. El pool se vuelve a crear con la configuración de process.env en su primer
// uso, así que basta con cerrarlo.
async function pointAppConnection(dbName) {
  assertTestDbName(dbName);
  const env = readEnv();
  Object.assign(process.env, {
    DB_HOST: env.DB_HOST,
    DB_PORT: env.DB_PORT,
    DB_USER: env.DB_USER,
    DB_PASSWORD: env.DB_PASSWORD,
    DB_NAME: dbName,
  });
  const connection = require(path.join(PATHS.root, 'src', 'main', 'database', 'connection.js'));
  await connection.closeConnection();
  const { rows } = await connection.query('SELECT current_database() AS name');
  const connected = rows[0].name;
  if (connected !== dbName || connected === userDbName()) {
    const error = new Error(`ABORTADO: la conexión de la aplicación quedó en "${connected}" y no en la base de prueba "${dbName}".`);
    error.fatal = true;
    throw error;
  }
  return connection;
}

async function prepareGroupDb({ template, name, setup, withAppConnection }) {
  await cloneDb(template, name);
  let client;
  try {
    client = await connectSuite(name);
    await clock.applyToDatabase(client);
    const today = await clock.today(client);
    const ctx = { dbName: name, client, today, year: Number(today.slice(0, 4)), fixtures: new Fixtures(client, { today }) };
    if (withAppConnection) ctx.appConnection = await pointAppConnection(name);
    if (setup) ctx.data = await setup(ctx);
    return ctx;
  } catch (error) {
    await client?.end().catch(() => {});
    await dropDb(name).catch(() => {});
    throw error;
  }
}

async function releaseGroupDb(ctx, { keepDb }) {
  await ctx.client?.end().catch(() => {});
  if (ctx.appConnection) await ctx.appConnection.closeConnection().catch(() => {});
  if (keepDb) markKept(ctx.dbName);
  else await dropDb(ctx.dbName);
}

// Lo que toda prueba con base recibe en `t`.
function decorateDb(t, ctx) {
  t.db = ctx.client;
  t.dbName = ctx.dbName;
  t.today = ctx.today;
  t.year = ctx.year;
  t.fixtures = ctx.fixtures;
  t.data = ctx.data;
  t.sql = async (sql, params) => (await ctx.client.query(sql, params)).rows;
  t.sqlOne = async (sql, params) => (await ctx.client.query(sql, params)).rows[0];
  t.checkInvariants = async () => {
    const violations = await invariants.findViolations(ctx.client);
    for (const violation of violations) t.fail(`Invariante incumplida: ${violation.description} (${violation.id})`, violation.rows);
  };
}

module.exports = { pointAppConnection, prepareGroupDb, releaseGroupDb, decorateDb };
