// Capa de base de datos: dos sesiones a la vez. Las reglas que dependen de otras filas (una sola
// inscripción activa, el último administrador, el profesor activo de una asignación, la evaluación
// vigente y ya tomada de una calificación, la asignación vigente de una evaluación, la asignación
// que no se da de baja con evaluaciones vigentes, la baja en cascada de las calificaciones de una
// evaluación, el curso que no se da de baja con inscripciones vigentes, el curso vigente de una
// asignación, el egreso de un alumno sin inscripción activa, con el alumno activo de una
// inscripción activa, y la inscripción que no se da de baja con calificaciones vigentes) se
// sostienen con bloqueos de fila: la segunda operación espera a la primera y, al seguir, ya la ve.
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
    const cascadeEvaluationId = await fixtures.createEvaluation({ assignmentId: grading.assignment.id });
    // Una inscripción sin notas, a la que una prueba le carga una mientras otra sesión la da de
    // baja, en una evaluación propia
    const scorePendingEnrollment = await fixtures.enroll({ studentId: (await fixtures.createStudent()).id, courseId: grading.course.id });
    const scorePendingEvaluationId = await fixtures.createEvaluation({ assignmentId: grading.assignment.id });
    // Una asignación sin evaluaciones, que una prueba da de baja y confirma
    const removableAssignment = await fixtures.assign({ teacherId: grading.teacher.id, courseId: (await fixtures.createCourse()).id });
    // Otra sin evaluaciones, en la que una prueba crea una evaluación mientras otra sesión la da de
    // baja. De grading.teacher, porque otra prueba suspende a teacher
    const pendingAssignment = await fixtures.assign({ teacherId: grading.teacher.id, courseId: (await fixtures.createCourse()).id });
    // Cursos: uno vacío en el que una prueba inscribe a un alumno sin inscripciones mientras otra
    // sesión lo da de baja, y otro vacío que una prueba da de baja y confirma
    const coursePendingEnrollment = await fixtures.createCourse();
    const studentPendingEnrollment = await fixtures.createStudent();
    const courseBeingDeleted = await fixtures.createCourse();
    // Alumnos: uno al que una prueba inscribe mientras otra sesión lo pasa a egresado, y otro al que
    // una prueba pasa a egresado mientras otra sesión lo inscribe
    const studentBeingEnrolled = await fixtures.createStudent();
    const studentGraduating = await fixtures.createStudent();
    return { courseA, courseB, student, adminA, adminB, teacher, assignment, removableAssignment, pendingAssignment,
      coursePendingEnrollment, studentPendingEnrollment, courseBeingDeleted, studentBeingEnrolled, studentGraduating,
      grading: { ...grading, secondEvaluationId, cascadeEvaluationId, scorePendingEnrollment, scorePendingEvaluationId } };
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

  test('evaluation-deleted-assignment', 'Se da de baja la asignación mientras se le crea una evaluación: el alta espera y se rechaza', async (t) => {
    const { removableAssignment } = t.data;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, [removableAssignment.id]);
      await other.query('BEGIN');
      const pending = other.query(`INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, 'Alta simultánea', $2)`, [removableAssignment.id, t.today])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'El alta no esperó el bloqueo de la asignación');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_evaluacion_asignacion_vigente', 'El alta no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM evaluacion WHERE asignacion_docente_id = $1`, [removableAssignment.id]);
    t.equal(count, 0, 'La asignación dada de baja quedó sin evaluaciones');
  });

  test('assignment-delete-pending-evaluation', 'Se crea una evaluación mientras se da de baja su asignación: la baja espera y se rechaza', async (t) => {
    const { pendingAssignment } = t.data;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, 'Alta antes de la baja', $2)`, [pendingAssignment.id, t.today]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, [pendingAssignment.id])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La baja no esperó el bloqueo de la asignación');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_asignacion_docente_evaluaciones_vigentes', 'La baja no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const state = await t.sqlOne(`
      SELECT a.fecha_eliminacion IS NULL AS vigente,
             (SELECT COUNT(*)::INT FROM evaluacion e WHERE e.asignacion_docente_id = a.asignacion_docente_id AND e.fecha_eliminacion IS NULL) AS evaluaciones
        FROM asignacion_docente a WHERE a.asignacion_docente_id = $1`, [pendingAssignment.id]);
    t.equal(state, { vigente: true, evaluaciones: 1 }, 'La asignación quedó vigente, con la evaluación creada mientras tanto');
  });

  test('evaluation-delete-pending-score', 'Se da de baja la evaluación mientras se le carga una nota: la baja espera y da de baja también esa nota', async (t) => {
    const { cascadeEvaluationId, enrollmentId } = t.data.grading;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, 7)`, [cascadeEvaluationId, enrollmentId]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, [cascadeEvaluationId])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La baja no esperó el bloqueo de la evaluación');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(result.ok, 'La baja de la evaluación se rechazó', result);
      await other.query(result.ok ? 'COMMIT' : 'ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const scores = await t.sql(`SELECT fecha_eliminacion IS NOT NULL AS baja FROM calificacion WHERE evaluacion_id = $1`, [cascadeEvaluationId]);
    t.equal(scores, [{ baja: true }], 'La nota cargada mientras tanto quedó dada de baja con la evaluación');
  });

  test('course-delete-pending-enrollment', 'Se inscribe a un alumno mientras se da de baja su curso: la baja espera y se rechaza', async (t) => {
    const { coursePendingEnrollment, studentPendingEnrollment } = t.data;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id)
                        VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'))`,
      [studentPendingEnrollment.id, coursePendingEnrollment.id]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE curso SET fecha_eliminacion = now() WHERE curso_id = $1`, [coursePendingEnrollment.id])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La baja no esperó el bloqueo del curso');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_curso_inscripciones_vigentes', 'La baja no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const state = await t.sqlOne(`
      SELECT c.fecha_eliminacion IS NULL AS vigente,
             (SELECT COUNT(*)::INT FROM inscripcion i WHERE i.curso_id = c.curso_id AND i.fecha_eliminacion IS NULL) AS inscripciones
        FROM curso c WHERE c.curso_id = $1`, [coursePendingEnrollment.id]);
    t.equal(state, { vigente: true, inscripciones: 1 }, 'El curso quedó vigente, con la inscripción creada mientras tanto');
  });

  test('enrollment-delete-pending-score', 'Se carga una nota mientras se da de baja la inscripción: la baja espera y se rechaza', async (t) => {
    const { scorePendingEnrollment, scorePendingEvaluationId } = t.data.grading;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, 7)`,
        [scorePendingEvaluationId, scorePendingEnrollment]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE inscripcion SET fecha_eliminacion = now() WHERE inscripcion_id = $1`, [scorePendingEnrollment])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La baja no esperó el bloqueo de la inscripción');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_inscripcion_calificaciones_vigentes', 'La baja no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const state = await t.sqlOne(`
      SELECT i.fecha_eliminacion IS NULL AS vigente,
             (SELECT COUNT(*)::INT FROM calificacion c
               WHERE c.inscripcion_id = i.inscripcion_id AND c.evaluacion_id = $2 AND c.fecha_eliminacion IS NULL) AS calificaciones
        FROM inscripcion i WHERE i.inscripcion_id = $1`, [scorePendingEnrollment, scorePendingEvaluationId]);
    t.equal(state, { vigente: true, calificaciones: 1 }, 'La inscripción quedó vigente, con la nota cargada mientras tanto');
  });

  test('graduate-pending-enrollment','Se inscribe a un alumno mientras se lo pasa a egresado: el egreso espera y se rechaza', async (t) => {
    const { courseA, studentBeingEnrolled } = t.data;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id)
                        VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'))`,
      [studentBeingEnrolled.id, courseA.id]);
      await other.query('BEGIN');
      const pending = other.query(`UPDATE alumno SET alumno_estado_id = (SELECT alumno_estado_id FROM alumno_estado WHERE nombre = 'EGRESADO')
                                    WHERE alumno_id = $1`, [studentBeingEnrolled.id])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'El egreso no esperó el bloqueo del alumno');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_alumno_inscripcion_activa', 'El egreso no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const state = await t.sqlOne(`
      SELECT e.nombre AS estado,
             (SELECT COUNT(*)::INT FROM inscripcion i JOIN inscripcion_estado ie USING (inscripcion_estado_id)
               WHERE i.alumno_id = a.alumno_id AND i.fecha_eliminacion IS NULL AND ie.nombre = 'ACTIVA') AS activas
        FROM alumno a JOIN alumno_estado e USING (alumno_estado_id) WHERE a.alumno_id = $1`, [studentBeingEnrolled.id]);
    t.equal(state, { estado: 'ACTIVO', activas: 1 }, 'El alumno quedó activo, con la inscripción creada mientras tanto');
  });

  test('enrollment-graduating-student', 'Se pasa a egresado a un alumno mientras se lo inscribe: la inscripción espera y se rechaza', async (t) => {
    const { courseA, studentGraduating } = t.data;
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`UPDATE alumno SET alumno_estado_id = (SELECT alumno_estado_id FROM alumno_estado WHERE nombre = 'EGRESADO')
                         WHERE alumno_id = $1`, [studentGraduating.id]);
      await other.query('BEGIN');
      const pending = other.query(`INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id)
                                   VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'))`,
      [studentGraduating.id, courseA.id])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'La inscripción no esperó el bloqueo del alumno');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_inscripcion_alumno_activo', 'La inscripción no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const state = await t.sqlOne(`
      SELECT e.nombre AS estado, (SELECT COUNT(*)::INT FROM inscripcion i WHERE i.alumno_id = a.alumno_id) AS inscripciones
        FROM alumno a JOIN alumno_estado e USING (alumno_estado_id) WHERE a.alumno_id = $1`, [studentGraduating.id]);
    t.equal(state, { estado: 'EGRESADO', inscripciones: 0 }, 'El alumno quedó egresado y sin inscripciones');
  });

  test('assignment-deleted-course', 'Se da de baja el curso mientras se le crea una asignación: el alta espera y se rechaza', async (t) => {
    const { courseBeingDeleted, grading } = t.data;
    const [subject] = await t.fixtures.subjectsOfGrade(courseBeingDeleted.gradeId);
    const other = await second(t);
    let committed = false;
    try {
      await t.db.query('BEGIN');
      await t.db.query(`UPDATE curso SET fecha_eliminacion = now() WHERE curso_id = $1`, [courseBeingDeleted.id]);
      await other.query('BEGIN');
      const pending = other.query(`INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id) VALUES ($1, $2, $3)`,
        [grading.teacher.id, courseBeingDeleted.id, subject.gradeSubjectId])
        .then(() => ({ ok: true }), (error) => ({ ok: false, constraint: error.constraint }));
      t.check(await isPending(pending), 'El alta no esperó el bloqueo del curso');
      await t.db.query('COMMIT');
      committed = true;
      const result = await pending;
      t.check(!result.ok && result.constraint === 'ck_asignacion_docente_curso_vigente', 'El alta no se rechazó', result);
      await other.query('ROLLBACK');
    } finally {
      if (!committed) await t.db.query('ROLLBACK').catch(() => {});
      await other.end();
    }
    const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM asignacion_docente WHERE curso_id = $1`, [courseBeingDeleted.id]);
    t.equal(count, 0, 'El curso dado de baja quedó sin asignaciones');
  });
});
