// Capa de base de datos (sin Electron): el ciclo lectivo. La fecha actual sale de fn_fecha_actual();
// lo de un ciclo cerrado queda en solo lectura, en un ciclo futuro no se carga nada, y el cierre
// (sp_inscripcion_finalizar_ciclos_cerrados) finaliza las inscripciones activas de los cerrados.
// Los datos de un ciclo cerrado se crean con fixtures.inSchoolYear; los de uno futuro, en una
// transacción que se deshace, para no dejar filas futuras. Cada intento corre en una transacción (o
// un SAVEPOINT) que se deshace. Se comprueba el código y el nombre de la restricción, nunca el mensaje.
const { group, test } = require('../lib/framework');
const { attempt, rejectedBy } = require('../lib/sql');
const { replaceTodaySql } = require('../lib/clock');

async function rejects(t, label, statements, constraint) {
  const result = await attempt(t.db, statements);
  return t.check(rejectedBy(result, constraint), `${label}: se esperaba el rechazo de ${constraint}`, result);
}

async function passes(t, label, statements) {
  const result = await attempt(t.db, statements);
  return t.check(result.ok, `${label}: la base no debería rechazarlo`, result);
}

// Corre `body` en una transacción del cliente de la suite que siempre se deshace.
async function rolledBack(t, body) {
  await t.db.query('BEGIN');
  try {
    return await body();
  } finally {
    await t.db.query('ROLLBACK');
  }
}

// Un intento dentro de la transacción de rolledBack, como attempt (lib/sql.js): en un SAVEPOINT que
// siempre se deshace.
async function attemptInSavepoint(client, statement) {
  await client.query('SAVEPOINT intento');
  try {
    const result = await client.query(statement.sql, statement.params);
    return { ok: true, rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    return { ok: false, code: error.code, constraint: error.constraint, message: error.message };
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT intento');
  }
}

const setEnrollmentStatus = (enrollmentId, status, alsoSet = '', extraParams = []) => ({
  sql: `UPDATE inscripcion SET inscripcion_estado_id = (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = $2)${alsoSet}
         WHERE inscripcion_id = $1`,
  params: [enrollmentId, status, ...extraParams],
});

group('db.school-year', 'Ciclo lectivo: fecha actual, ciclo cerrado en solo lectura, ciclo futuro bloqueado y cierre', {
  async setup({ fixtures }) {
    // El ciclo anterior, cargado como en su año: un curso con una asignación, una evaluación con una
    // nota e inscripciones en cada estado, y otro curso vacío
    const closed = await fixtures.inSchoolYear(fixtures.year - 1, async () => {
      const teacher = await fixtures.createUser({ role: 'PROFESOR' });
      const course = await fixtures.createCourse();
      const otherCourse = await fixtures.createCourse();
      const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
      const enroll = async (options) => fixtures.enroll({ studentId: (await fixtures.createStudent()).id, courseId: course.id, ...options });
      const active = await enroll();
      const unscored = await enroll();
      const cancelled = await enroll({ status: 'CANCELADA' });
      // Activa por ahora: en su año, ese ciclo es el actual y la base no acepta una finalizada
      const completed = await enroll();
      const deleted = await enroll({ deleted: true });
      const scoreId = await fixtures.score({ evaluationId, enrollmentId: active });
      return { teacher, course, otherCourse, assignment, evaluationId, active, unscored, cancelled, completed, deleted, scoreId,
        date: fixtures.today };
    });
    // Con el ciclo ya cerrado, pasa a finalizada como en el cierre (la excepción de
    // trg_inscripcion_ciclo_lectivo)
    await fixtures.setEnrollmentStatus(closed.completed, 'FINALIZADA');
    // El ciclo actual
    const course = await fixtures.createCourse();
    const assignment = await fixtures.assign({ teacherId: closed.teacher.id, courseId: course.id, subjectName: 'Historia' });
    const free = await fixtures.createStudent();
    const enrollmentId = await fixtures.enroll({ studentId: (await fixtures.createStudent()).id, courseId: course.id });
    return { closed, course, assignment, free, enrollmentId };
  },
}, () => {
  test('current-date', 'La fecha y el año actuales salen de fn_fecha_actual(), que también completa la fecha de inscripción', async (t) => {
    const current = await t.sqlOne(`SELECT to_char(fn_fecha_actual(), 'YYYY-MM-DD') AS today, fn_anio_ciclo_lectivo_actual() AS year`);
    t.equal(current, { today: t.today, year: t.year }, 'Fecha y año actuales');
    const states = await t.sqlOne(
      `SELECT fn_ciclo_lectivo_estado($1) AS closed, fn_ciclo_lectivo_estado($2) AS current,
              fn_ciclo_lectivo_estado($3) AS future, fn_ciclo_lectivo_estado(NULL) AS unknown`,
      [t.year - 1, t.year, t.year + 1]
    );
    t.equal(states, { closed: 'CERRADO', current: 'ACTUAL', future: 'FUTURO', unknown: null }, 'Estado de cada ciclo lectivo');
    // Otro día del ciclo actual: el alta sin fecha tiene que tomarlo de fn_fecha_actual()
    const otherDay = t.today === `${t.year}-01-01` ? `${t.year}-01-02` : `${t.year}-01-01`;
    const created = await attempt(t.db, [
      replaceTodaySql(otherDay),
      {
        sql: `INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id)
              VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'))
              RETURNING to_char(fecha_inscripcion, 'YYYY-MM-DD') AS date`,
        params: [t.data.free.id, t.data.course.id],
      },
    ]);
    t.equal(created.rows?.[0]?.date, otherDay, 'El DEFAULT de fecha_inscripcion es fn_fecha_actual()');
  });

  test('closed-read-only', 'En un ciclo cerrado no se crea, edita ni da de baja ningún curso, asignación, inscripción, evaluación ni calificación', async (t) => {
    const { closed, free } = t.data;
    const otherSubject = (await t.fixtures.subjectsOfGrade(closed.course.gradeId))
      .find((subject) => subject.gradeSubjectId !== closed.assignment.gradeSubjectId);
    const cases = [
      ['curso', 'alta', {
        sql: `INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
              SELECT institucion_id, grado_id, division, 'MAÑANA', anio_ciclo_lectivo FROM curso WHERE curso_id = $1`,
        params: [closed.course.id],
      }],
      ['curso', 'edición', { sql: `UPDATE curso SET turno = 'MAÑANA' WHERE curso_id = $1`, params: [closed.course.id] }],
      ['curso', 'baja', { sql: `UPDATE curso SET fecha_eliminacion = now() WHERE curso_id = $1`, params: [closed.course.id] }],
      ['asignacion_docente', 'alta', {
        sql: `INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id) VALUES ($1, $2, $3)`,
        params: [closed.teacher.id, closed.otherCourse.id, closed.assignment.gradeSubjectId],
      }],
      ['asignacion_docente', 'edición', {
        sql: `UPDATE asignacion_docente SET grado_materia_id = $2 WHERE asignacion_docente_id = $1`,
        params: [closed.assignment.id, otherSubject.gradeSubjectId],
      }],
      ['asignacion_docente', 'baja', {
        sql: `UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, params: [closed.assignment.id],
      }],
      ['inscripcion', 'alta', {
        sql: `INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
              VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'), $3)`,
        params: [free.id, closed.course.id, closed.date],
      }],
      ['inscripcion', 'edición', {
        sql: `UPDATE inscripcion SET fecha_inscripcion = fecha_inscripcion + 1 WHERE inscripcion_id = $1`, params: [closed.unscored],
      }],
      ['inscripcion', 'baja', { sql: `UPDATE inscripcion SET fecha_eliminacion = now() WHERE inscripcion_id = $1`, params: [closed.unscored] }],
      ['evaluacion', 'alta', {
        sql: `INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, 'Evaluación de un ciclo cerrado', $2)`,
        params: [closed.assignment.id, closed.date],
      }],
      ['evaluacion', 'edición', {
        sql: `UPDATE evaluacion SET titulo = titulo || ' (corregida)' WHERE evaluacion_id = $1`, params: [closed.evaluationId],
      }],
      ['evaluacion', 'baja', { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [closed.evaluationId] }],
      ['calificacion', 'alta', {
        sql: `INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, 8)`, params: [closed.evaluationId, closed.unscored],
      }],
      ['calificacion', 'edición', { sql: `UPDATE calificacion SET nota = 9 WHERE calificacion_id = $1`, params: [closed.scoreId] }],
      ['calificacion', 'baja', { sql: `UPDATE calificacion SET fecha_eliminacion = now() WHERE calificacion_id = $1`, params: [closed.scoreId] }],
    ];
    for (const [table, action, statement] of cases) {
      await rejects(t, `${action} en ${table}`, statement, `ck_${table}_ciclo_lectivo_cerrado`);
    }
  });

  test('move-to-closed', 'Nada pasa del ciclo actual a uno cerrado: ni una asignación o una inscripción a un curso cerrado, ni un curso a un año anterior', async (t) => {
    const { closed, course, assignment, enrollmentId } = t.data;
    await rejects(t, 'asignación a un curso cerrado', {
      sql: `UPDATE asignacion_docente SET curso_id = $2 WHERE asignacion_docente_id = $1`, params: [assignment.id, closed.course.id],
    }, 'ck_asignacion_docente_ciclo_lectivo_cerrado');
    await rejects(t, 'inscripción a un curso cerrado', {
      sql: `UPDATE inscripcion SET curso_id = $2 WHERE inscripcion_id = $1`, params: [enrollmentId, closed.course.id],
    }, 'ck_inscripcion_ciclo_lectivo_cerrado');
    await rejects(t, 'curso a un año anterior', {
      sql: `UPDATE curso SET anio_ciclo_lectivo = anio_ciclo_lectivo - 1 WHERE curso_id = $1`, params: [course.id],
    }, 'ck_curso_ciclo_lectivo_cerrado');
  });

  test('future', 'En un ciclo futuro no se crea ningún curso, asignación, inscripción, evaluación ni calificación', async (t) => {
    const { closed, free } = t.data;
    await rolledBack(t, async () => {
      // Datos del ciclo siguiente, cargados como en su año: se deshacen al terminar la prueba
      const future = await t.fixtures.asOfSchoolYear(t.year + 1, async () => {
        const course = await t.fixtures.createCourse();
        const assignment = await t.fixtures.assign({ teacherId: closed.teacher.id, courseId: course.id });
        const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id });
        const enrollmentId = await t.fixtures.enroll({ studentId: (await t.fixtures.createStudent()).id, courseId: course.id });
        return { course, assignment, evaluationId, enrollmentId, date: t.fixtures.today };
      });
      const otherSubject = (await t.fixtures.subjectsOfGrade(future.course.gradeId))
        .find((subject) => subject.gradeSubjectId !== future.assignment.gradeSubjectId);
      const cases = [
        ['curso', {
          sql: `INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
                SELECT institucion_id, grado_id, division, 'MAÑANA', anio_ciclo_lectivo FROM curso WHERE curso_id = $1`,
          params: [future.course.id],
        }],
        ['asignacion_docente', {
          sql: `INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id) VALUES ($1, $2, $3)`,
          params: [closed.teacher.id, future.course.id, otherSubject.gradeSubjectId],
        }],
        ['inscripcion', {
          sql: `INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
                VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'), $3)`,
          params: [free.id, future.course.id, future.date],
        }],
        ['evaluacion', {
          sql: `INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, 'Evaluación de un ciclo futuro', $2)`,
          params: [future.assignment.id, future.date],
        }],
        ['calificacion', {
          sql: `INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, 7)`,
          params: [future.evaluationId, future.enrollmentId],
        }],
      ];
      for (const [table, statement] of cases) {
        const constraint = `ck_${table}_ciclo_lectivo_futuro`;
        const result = await attemptInSavepoint(t.db, statement);
        t.check(rejectedBy(result, constraint), `alta en ${table}: se esperaba el rechazo de ${constraint}`, result);
      }
    });
  });

  test('closing-exception', 'En un ciclo cerrado solo se acepta pasar una inscripción vigente de activa a finalizada, sin cambiar nada más', async (t) => {
    const { closed, free } = t.data;
    const closedRule = 'ck_inscripcion_ciclo_lectivo_cerrado';
    await passes(t, 'activa a finalizada', setEnrollmentStatus(closed.active, 'FINALIZADA'));
    await rejects(t, 'activa a cancelada', setEnrollmentStatus(closed.active, 'CANCELADA'), closedRule);
    await rejects(t, 'finalizada a activa', setEnrollmentStatus(closed.completed, 'ACTIVA'), closedRule);
    const otherChanges = [
      ['cambiando el alumno', ', alumno_id = $3', [free.id]],
      ['cambiando el curso', ', curso_id = $3', [closed.otherCourse.id]],
      ['cambiando la fecha', ', fecha_inscripcion = fecha_inscripcion + 1', []],
      ['dándola de baja', ', fecha_eliminacion = now()', []],
    ];
    for (const [label, alsoSet, extraParams] of otherChanges) {
      await rejects(t, `activa a finalizada ${label}`, setEnrollmentStatus(closed.unscored, 'FINALIZADA', alsoSet, extraParams), closedRule);
    }
    await rejects(t, 'dada de baja de activa a finalizada', setEnrollmentStatus(closed.deleted, 'FINALIZADA'), closedRule);
  });

  test('close-procedure', 'El cierre finaliza solo las inscripciones activas y vigentes de los ciclos cerrados, informa cuántas y es idempotente', async (t) => {
    const { closed, enrollmentId } = t.data;
    const expected = (await t.sql(
      `SELECT i.inscripcion_id AS id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) JOIN curso c USING (curso_id)
        WHERE e.nombre = 'ACTIVA' AND i.fecha_eliminacion IS NULL AND c.anio_ciclo_lectivo < $1 ORDER BY 1`,
      [t.year]
    )).map((row) => row.id);
    t.check(
      [closed.active, closed.unscored].every((id) => expected.includes(id))
        && ![closed.cancelled, closed.completed, closed.deleted, enrollmentId].some((id) => expected.includes(id)),
      'Los datos del grupo cubren cada caso: activas vigentes del ciclo cerrado, canceladas, finalizadas, dadas de baja y del ciclo actual',
      expected
    );
    const snapshot = () => t.sql(
      `SELECT i.inscripcion_id AS id, i.alumno_id, i.curso_id, to_char(i.fecha_inscripcion, 'YYYY-MM-DD') AS date,
              i.fecha_eliminacion IS NOT NULL AS deleted, e.nombre AS status
         FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) ORDER BY 1`
    );
    await rolledBack(t, async () => {
      const before = await snapshot();
      const first = await t.sqlOne('CALL sp_inscripcion_finalizar_ciclos_cerrados(NULL)');
      const after = await snapshot();
      const second = await t.sqlOne('CALL sp_inscripcion_finalizar_ciclos_cerrados(NULL)');
      const changed = after.filter((row, index) => JSON.stringify(row) !== JSON.stringify(before[index]));
      const finalized = before.filter((row) => expected.includes(row.id)).map((row) => ({ ...row, status: 'FINALIZADA' }));
      t.equal(changed, finalized, 'Solo cambió el estado de las activas y vigentes de los ciclos cerrados, a finalizada');
      t.equal(first?.p_inscripciones_finalizadas, expected.length, 'Informa cuántas finalizó');
      t.equal(second?.p_inscripciones_finalizadas, 0, 'La segunda llamada no finaliza ninguna');
    });
  });
});
