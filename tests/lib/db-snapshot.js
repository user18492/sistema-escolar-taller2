// Huella del contenido de las tablas, para comprobar que una operación rechazada no cambió nada.
async function tableHashes(client) {
  const { rows: tables } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
  const hashes = {};
  for (const { tablename } of tables) {
    const { rows } = await client.query(`SELECT md5(COALESCE(string_agg(x::TEXT, ',' ORDER BY x::TEXT), '')) AS hash FROM ${tablename} x`);
    hashes[tablename] = rows[0].hash;
  }
  return hashes;
}

function changedTables(before, after) {
  return Object.keys({ ...before, ...after }).filter((table) => before[table] !== after[table]);
}

module.exports = { tableHashes, changedTables };
