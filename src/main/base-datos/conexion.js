// Único módulo que accede a PostgreSQL. Lo usan los repositorios y, al iniciar y cerrar la app, main.js.
const { Pool } = require('pg');

const VARIABLES_REQUERIDAS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

let pool;

function validarConfiguracion() {
  const faltantes = VARIABLES_REQUERIDAS.filter((nombre) => !process.env[nombre]?.trim());
  if (faltantes.length > 0) {
    const error = new Error(
      `Faltan variables de conexión en el archivo .env: ${faltantes.join(', ')}. ` +
      'Copiá .env.example a .env y ajustá los valores.'
    );
    // Con un código propio se distingue de los errores de PostgreSQL (ECONNREFUSED, 28P01…).
    error.code = 'CONFIGURACION_INCOMPLETA';
    throw error;
  }
}

// El pool se crea recién en el primer uso, con la configuración ya cargada del .env.
function obtenerPool() {
  if (!pool) {
    validarConfiguracion();

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

// Los valores van siempre en `parametros` ($1, $2…), nunca concatenados en `sql`.
async function consultar(sql, parametros = []) {
  return obtenerPool().query(sql, parametros);
}

// `callback` recibe una función con la misma firma que `consultar`, ligada a la transacción.
async function ejecutarEnTransaccion(callback) {
  const cliente = await obtenerPool().connect();
  let errorCliente;

  try {
    await cliente.query('BEGIN');
    const resultado = await callback((sql, parametros = []) => cliente.query(sql, parametros));
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    // Si el ROLLBACK falla, el cliente queda en un estado desconocido y se descarta al liberarlo.
    await cliente.query('ROLLBACK').catch((errorRollback) => {
      errorCliente = errorRollback;
    });
    throw error;
  } finally {
    cliente.release(errorCliente);
  }
}

async function verificarConexion() {
  await obtenerPool().query('SELECT 1');
}

async function cerrarConexion() {
  if (!pool) return;

  const poolActual = pool;
  pool = undefined;
  await poolActual.end();
}

module.exports = {
  consultar,
  ejecutarEnTransaccion,
  verificarConexion,
  cerrarConexion,
};
