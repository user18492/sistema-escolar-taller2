// Capa de base de datos: dos sesiones a la vez. Las reglas que dependen de otras filas (una sola
// inscripción activa, el último administrador, el profesor activo de una asignación) se sostienen
// con bloqueos de fila: la segunda operación espera a la primera y, al seguir, ya la ve.
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
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: (await fixtures.createCourse()).id });
    return { courseA, courseB, student, adminA, adminB, teacher, assignment };
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

  test('suspended-teacher-assignment', 'Se suspende al profesor mientras se edita su asignación: la edición espera y se rechaza', async (t) => {
    const { teacher, assignment } = t.data;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`UPDATE usuario SET estado = false WHERE usuario_id = $1`, [teacher.id]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE asignacion_docente SET usuario_id = usuario_id WHERE asignacion_docente_id = $1`, [assignment.id])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La edición no esperó el bloqueo del profesor');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_asignacion_docente_usuario_activo', 'La edición no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    t.equal(await t.sqlOne(`SELECT estado FROM usuario WHERE usuario_id = $1`, [teacher.id]), { estado: false }, 'El profesor quedó suspendido');
  });
});
