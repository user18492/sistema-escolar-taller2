const fs = require('node:fs/promises');
const path = require('node:path');
const { runInTransaction } = require('./connection');

async function installStudentFollowUp() {
  await runInTransaction(async (query) => {
    await query('SELECT pg_advisory_xact_lock(741206, 0)');
    const { rows: [{ installed }] } = await query("SELECT to_regclass('seguimiento_alumno') IS NOT NULL AS installed");
    if (installed) return;

    // Una base creada con schema.sql ya lo incluye. Para las anteriores se conservan sus datos.
    const schema = await fs.readFile(path.join(__dirname, '../../../db/student-follow-up.sql'), 'utf8');
    await query(schema);
    await query('SELECT fn_iniciar_seguimientos()');
  });
}

module.exports = { installStudentFollowUp };
