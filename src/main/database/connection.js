// Único módulo que accede a PostgreSQL. Lo usan los repositorios y, al iniciar y cerrar la app, main.js.
const { Pool } = require('pg');

const REQUIRED_VARIABLES = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

let pool;

function validateConfiguration() {
  const missing = REQUIRED_VARIABLES.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    const error = new Error(
      `Faltan variables de conexión en el archivo .env: ${missing.join(', ')}. ` +
      'Copiá .env.example a .env y ajustá los valores.'
    );
    // Con un código propio se distingue de los errores de PostgreSQL (ECONNREFUSED, 28P01…).
    error.code = 'INCOMPLETE_CONFIGURATION';
    throw error;
  }
}

// El pool se crea recién en el primer uso, con la configuración ya cargada del .env.
function getPool() {
  if (!pool) {
    validateConfiguration();

    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      // Evita que el inicio quede bloqueado si el servidor no responde.
      connectionTimeoutMillis: 5000,
    });

    // Sin este manejador, la caída de un cliente inactivo cierra la app.
    pool.on('error', (error) => {
      console.error('Error en un cliente inactivo de PostgreSQL:', error);
    });
  }

  return pool;
}

// Los valores van siempre en `params` ($1, $2…), nunca concatenados en `sql`.
async function query(sql, params = []) {
  return getPool().query(sql, params);
}

// `callback` recibe una función con la misma firma que `query`, ligada a la transacción.
async function runInTransaction(callback) {
  const client = await getPool().connect();
  let clientError;

  try {
    await client.query('BEGIN');
    const result = await callback((sql, params = []) => client.query(sql, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Si el ROLLBACK falla, el cliente queda en un estado desconocido y se descarta al liberarlo.
    await client.query('ROLLBACK').catch((rollbackError) => {
      clientError = rollbackError;
    });
    throw error;
  } finally {
    client.release(clientError);
  }
}

async function checkConnection() {
  await getPool().query('SELECT 1');
}

async function closeConnection() {
  if (!pool) return;

  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
}

module.exports = {
  query,
  runInTransaction,
  checkConnection,
  closeConnection,
};
