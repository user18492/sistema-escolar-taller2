// Capa de base de datos: dos sesiones a la vez. Las reglas que dependen de otras filas (una sola
// inscripción activa, el último administrador) se sostienen con bloqueos de fila: la segunda
// operación espera a la primera y, al seguir, ya la ve.
const { group, test } = require('../lib/framework');
const { connectSuite } = require('../lib/pg-admin');
const { isPending } = require('../lib/sql');

async function second(t) {
  const client = await connectSuite(t.dbName, 'concurrency');
  return client;
}

group('db.concurrency', 'Reglas con dos sesiones simultáneas', {
  async setup({ fixtures }) {
    const courseA = await fixtures.createCourse();
    const courseB = await fixtures.createCourse();
    const student = await fixtures.createStudent();
    const institution = await fixtures.createInstitution();
    const adminA = await fixtures.createUser({ institutionId: institution.id, role: 'ADMIN' });
    const adminB = await fixtures.createUser({ institutionId: institution.id, role: 'ADMIN' });
    return { courseA, courseB, student, adminA, adminB };
  },
}, () => {
  test('one-active-enrollment', 'Dos inscripciones activas simultáneas del mismo alumno: la segunda espera y se rechaza', async (t) => {
    const { student, courseA, courseB } = t.data;
    const other = await second(t);
    let committed = false;
    const insert = `INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id)
                    VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'))`;
    try {
      await t.db.query('BEGIN');
      await t.db.query(insert, [student.id, courseA.id]);
      await other.query('BEGIN');
      const pending = other.query(insert, [student.id, courseB.id]).then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La segunda inscripción no esperó el bloqueo del alumno');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_inscripcion_alumno_una_activa', 'La segunda inscripción no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const { count } = await t.sqlOne(`
      SELECT COUNT(*)::INT AS count FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
       WHERE i.alumno_id = $1 AND e.nombre = 'ACTIVA' AND i.fecha_eliminacion IS NULL`, [student.id]);
    t.equal(count, 1, 'Quedó una sola inscripción activa');
  });

  test('last-admin', 'Dos administradores se suspenden entre sí a la vez: el segundo espera y se rechaza', async (t) => {
    const { adminA, adminB } = t.data;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`UPDATE usuario SET estado = false WHERE usuario_id = $1`, [adminA.id]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE usuario SET estado = false WHERE usuario_id = $1`, [adminB.id])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La segunda suspensión no esperó el bloqueo de la institución');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_usuario_ultimo_administrador', 'La segunda suspensión no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    // Vuelve a dejar activo al primero para las invariantes del grupo
    await t.db.query(`UPDATE usuario SET estado = true WHERE usuario_id = $1`, [adminA.id]);
  });
});
