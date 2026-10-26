// Capa de base de datos: dos sesiones a la vez. Las reglas que dependen de otras filas (una sola
// inscripción activa, el último administrador, el profesor activo de una asignación, la evaluación
// vigente y ya tomada de una calificación) se sostienen con bloqueos de fila: la segunda operación
// espera a la primera y, al seguir, ya la ve.
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
    // Calificaciones: una evaluación de hoy para cada prueba, porque la primera confirma la baja de
    // la suya
    const grading = await fixtures.teacherScenario();
    const secondEvaluationId = await fixtures.createEvaluation({ assignmentId: grading.assignment.id });
    return { courseA, courseB, student, adminA, adminB, teacher, assignment, grading: { ...grading, secondEvaluationId } };
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

  test('score-deleted-evaluation', 'Se da de baja la evaluación mientras se le carga una nota: la carga espera y se rechaza', async (t) => {
    const { evaluationId, enrollmentId } = t.data.grading;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, [evaluationId]);
      await other.query('BEGIN');
      const pending = other.query(`INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, 7)`, [evaluationId, enrollmentId])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La carga no esperó el bloqueo de la evaluación');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_calificacion_evaluacion_vigente', 'La carga no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM calificacion WHERE evaluacion_id = $1`, [evaluationId]);
    t.equal(count, 0, 'La evaluación dada de baja quedó sin calificaciones');
  });

  test('evaluation-future-with-score', 'Se pasa la evaluación a una fecha futura mientras se le carga una nota: el cambio espera y se rechaza', async (t) => {
    const { secondEvaluationId, enrollmentId } = t.data.grading;
    const lastDay = `${t.year}-12-31`;
    if (t.today >= lastDay) return t.warn('Hoy es el último día del ciclo: no hay fecha futura que probar');
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, 7)`, [secondEvaluationId, enrollmentId]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE evaluacion SET fecha_evaluacion = $2 WHERE evaluacion_id = $1`, [secondEvaluationId, lastDay])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'El cambio de fecha no esperó el bloqueo de la evaluación');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_evaluacion_futura_calificaciones_vigentes', 'El cambio de fecha no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const { fecha } = await t.sqlOne(`SELECT to_char(fecha_evaluacion, 'YYYY-MM-DD') AS fecha FROM evaluacion WHERE evaluacion_id = $1`, [secondEvaluationId]);
    t.equal(fecha, t.today, 'La evaluación conservó su fecha');
  });
});
