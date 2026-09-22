// Modulo de conexion a PostgreSQL. Se usa desde cualquier
// parte del código que necesite hacer una query a la base.

require('dotenv').config();
const { Pool } = require('pg');

// Configuración del pool de conexiones a PostgreSQL
// Se utiliza para no tener que abrir y cerrar conexiones cada vez que se hace una query
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

// Log simple para detectar si algo se rompe en segundo plano
pool.on('error', (err) => {
    console.error('Error inesperado en el pool de PostgreSQL:', err);
});

module.exports = {
    // Uso: const { rows } = await query('SELECT * FROM usuarios WHERE usuario_id = $1', [id]);
    // Lo hacemos asi para evitar inyecciones SQL y para que el pool maneje las conexiones de manera eficiente
    query: (text, params) => pool.query(text, params),
    pool,
};
