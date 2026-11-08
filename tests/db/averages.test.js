// Capa de base de datos (sin Electron): trimestres y promedios (plans/promedios/01-base-de-datos.md).
// fn_trimestre y fn_trimestre_cerrado; las reglas del trimestre cerrado y de la fecha de inscripción,
// y la vista vw_promedio_trimestral.
// Las reglas dependen del día: cada prueba corre en una transacción que siempre se deshace, en la que
// reemplaza el reloj (fn_fecha_actual) por días del ciclo actual (t.year), crea sus datos con el
// trimestre todavía abierto y después adelanta el reloj para cerrarlo. Así no dependen de TEST_TODAY
// ni dejan filas con fechas futuras. Cada intento corre en un SAVEPOINT que se deshace. Se comprueba
// el código y el nombre de la restricción, nunca el mensaje.
const { group, test } = require('../lib/framework');
const { rejectedBy } = require('../lib/sql');
const { replaceTodaySql } = require('../lib/clock');

// Corre `body` en una transacción del cliente de la suite que siempre se deshace, también el reloj
// reemplazado.
async function rolledBack(t, body) {
  await t.db.query('BEGIN');
  try {
    return await body();
  } finally {
    await t.db.query('ROLLBACK');
  }
}

// Un intento dentro de la transacción de rolledBack: en un SAVEPOINT que siempre se deshace.
// `statements` es una sentencia o una lista ({ sql, params } o texto).
async function attemptInSavepoint(client, statements) {
  const list = Array.isArray(statements) ? statements : [statements];
  await client.query('SAVEPOINT intento');
  try {
    let result;
    for (const statement of list) {
      result = typeof statement === 'string' ? await client.query(statement) : await client.query(statement.sql, statement.params);
    }
    return { ok: true, rows: result?.rows, rowCount: result?.rowCount };
  } catch (error) {
    return { ok: false, code: error.code, constraint: error.constraint, message: error.message };
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT intento');
  }
}

async function rejects(t, label, statements, constraint) {
  const result = await attemptInSavepoint(t.db, statements);
  return t.check(rejectedBy(result, constraint), `${label}: se esperaba el rechazo de ${constraint}`, result);
}

async function passes(t, label, statements) {
  const result = await attemptInSavepoint(t.db, statements);
  return t.check(result.ok, `${label}: la base no debería rechazarlo`, result);
}

// Fija el reloj de la base en `monthDay` ('MM-DD') del ciclo actual, dentro de la transacción de
// rolledBack
async function setClock(t, monthDay) {
  await t.db.query(replaceTodaySql(`${t.year}-${monthDay}`));
}

const scoreSql = (evaluationId, enrollmentId, value = 7) => ({
  sql: `INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, $3)`, params: [evaluationId, enrollmentId, value],
});
const updateScore = (scoreId, set) => ({ sql: `UPDATE calificacion SET ${set} WHERE calificacion_id = $1`, params: [scoreId] });
const updateEvaluation = (evaluationId, set, extraParams = []) => ({
  sql: `UPDATE evaluacion SET ${set} WHERE evaluacion_id = $1`, params: [evaluationId, ...extraParams],
});

group('db.averages', 'Trimestres y promedios: trimestre cerrado, fecha de inscripción y vw_promedio_trimestral', {
  async setup({ fixtures }) {
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const course = await fixtures.createCourse();
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    // Una inscripción finalizada, del ciclo anterior, cargada como en su año: una evaluación del
    // 15/06 (2° trimestre) con una nota
    const closed = await fixtures.inSchoolYear(fixtures.year - 1, async () => {
      const closedCourse = await fixtures.createCourse();
      const closedAssignment = await fixtures.assign({ teacherId: teacher.id, courseId: closedCourse.id });
      const enrollmentId = await fixtures.enroll({ studentId: (await fixtures.createStudent()).id, courseId: closedCourse.id });
      const evaluationId = await fixtures.createEvaluation({ assignmentId: closedAssignment.id });
      await fixtures.score({ evaluationId, enrollmentId, value: 8.5 });
      return { assignment: closedAssignment, enrollmentId };
    });
    await fixtures.setEnrollmentStatus(closed.enrollmentId, 'FINALIZADA');
    return { teacher, course, assignment, closed };
  },
}, () => {
  // Inscripción activa nueva en el curso del grupo, con fecha `monthDay` del ciclo actual
  const enrollOn = async (t, monthDay, options = {}) => t.fixtures.enroll({
    studentId: (await t.fixtures.createStudent()).id, courseId: t.data.course.id, date: `${t.year}-${monthDay}`, ...options,
  });
  const evaluationOn = (t, monthDay) => t.fixtures.createEvaluation({ assignmentId: t.data.assignment.id, date: `${t.year}-${monthDay}` });

  test('term-of-date', 'fn_trimestre: 1 hasta el 31/05, 2 del 01/06 al 31/08 y 3 del 01/09 al 31/12', async (t) => {
    const cases = { '01-01': 1, '05-31': 1, '06-01': 2, '08-31': 2, '09-01': 3, '12-31': 3 };
    const dates = Object.keys(cases).map((monthDay) => `${t.year}-${monthDay}`);
    const rows = await t.sql(
      `SELECT to_char(d, 'MM-DD') AS day, fn_trimestre(d) AS term FROM unnest($1::DATE[]) AS d ORDER BY d`, [dates]);
    t.equal(Object.fromEntries(rows.map((row) => [row.day, row.term])), cases, 'Trimestre de cada corte');
    t.equal((await t.sqlOne(`SELECT fn_trimestre(NULL) AS term`)).term, null, 'Con una fecha NULL devuelve NULL');
  });

  test('term-closed', 'fn_trimestre_cerrado: cierra 7 días después del fin del trimestre, o con su ciclo lectivo', async (t) => {
    const closedAt = async (monthDay) => {
      await setClock(t, monthDay);
      const row = await t.sqlOne(
        `SELECT fn_trimestre_cerrado($1, 1) AS t1, fn_trimestre_cerrado($1, 2) AS t2, fn_trimestre_cerrado($1, 3) AS t3,
                fn_trimestre_cerrado($1 - 1, 1) AS previous1, fn_trimestre_cerrado($1 - 1, 3) AS previous3,
                fn_trimestre_cerrado($1 + 1, 1) AS next1`,
        [t.year]);
      return row;
    };
    await rolledBack(t, async () => {
      const always = { previous1: true, previous3: true, next1: false };
      const expected = {
        '01-01': { t1: false, t2: false, t3: false },
        '06-07': { t1: false, t2: false, t3: false },
        '06-08': { t1: true, t2: false, t3: false },
        '09-07': { t1: true, t2: false, t3: false },
        '09-08': { t1: true, t2: true, t3: false },
        '12-31': { t1: true, t2: true, t3: false },
      };
      for (const [monthDay, terms] of Object.entries(expected)) {
        t.equal(await closedAt(monthDay), { ...terms, ...always }, `Trimestres cerrados el ${monthDay}`);
      }
      const nulls = await t.sqlOne(`SELECT fn_trimestre_cerrado(NULL, 1) AS no_year, fn_trimestre_cerrado($1, NULL) AS no_term`, [t.year]);
      t.equal(nulls, { no_year: null, no_term: null }, 'Es STRICT: con un argumento NULL devuelve NULL');
    });
  });

  test('score-before-enrollment', 'Una nota no se carga ni se corrige en una evaluación anterior a la fecha de inscripción; darla de baja, sí', async (t) => {
    const constraint = 'ck_calificacion_evaluacion_anterior_inscripcion';
    await rolledBack(t, async () => {
      await setClock(t, '10-20');
      const enrollmentId = await enrollOn(t, '10-05');
      const before = await evaluationOn(t, '10-01');
      const sameDay = await evaluationOn(t, '10-05');
      await rejects(t, 'cargar en una evaluación anterior a la inscripción', scoreSql(before, enrollmentId), constraint);
      await passes(t, 'cargar en una evaluación del día de la inscripción', scoreSql(sameDay, enrollmentId));
      const scoreId = await t.fixtures.score({ evaluationId: sameDay, enrollmentId });
      await rejects(t, 'pasar la nota a una evaluación anterior a la inscripción', updateScore(scoreId, `evaluacion_id = ${before}`), constraint);
      // La fecha de inscripción no tiene barrera (limitación conocida): si pasa a una posterior a la
      // evaluación, la nota ya no se corrige, pero se da de baja
      const moveEnrollment = { sql: `UPDATE inscripcion SET fecha_inscripcion = $2 WHERE inscripcion_id = $1`, params: [enrollmentId, `${t.year}-10-10`] };
      await rejects(t, 'corregir con la inscripción posterior', [moveEnrollment, updateScore(scoreId, 'nota = 9')], constraint);
      await passes(t, 'dar de baja con la inscripción posterior', [moveEnrollment, updateScore(scoreId, 'fecha_eliminacion = now()')]);
    });
  });

  test('score-closed-term', 'En una evaluación de un trimestre cerrado no se carga, no se corrige ni se da de baja ninguna nota; en el plazo de 7 días, sí', {
    history: [{ plan: 'Pedido del 2026-11-08: formato único de los trimestres (sin plan en plans/)', date: '2026-11-08', change: 'Los trimestres se nombran "1° trimestre", "2° trimestre" y "3° trimestre" (antes "1.er", "2.º", "3.er") en los comentarios' }],
  }, async (t) => {
    const constraint = 'ck_calificacion_trimestre_cerrado';
    await rolledBack(t, async () => {
      await setClock(t, '05-20');
      const enrollmentId = await enrollOn(t, '03-01');
      const unscoredId = await enrollOn(t, '03-01');
      const firstTerm = await evaluationOn(t, '05-10');
      const scoreId = await t.fixtures.score({ evaluationId: firstTerm, enrollmentId });
      // En el plazo de carga: el 07/06 el 1° trimestre sigue abierto
      await setClock(t, '06-07');
      await passes(t, 'cargar en el plazo', scoreSql(firstTerm, unscoredId));
      await passes(t, 'corregir en el plazo', updateScore(scoreId, 'nota = 9'));
      const secondTerm = await evaluationOn(t, '06-05');
      // Vencido el plazo: el 08/06 se cierra
      await setClock(t, '06-08');
      await rejects(t, 'cargar', scoreSql(firstTerm, unscoredId), constraint);
      await rejects(t, 'corregir', updateScore(scoreId, 'nota = 9'), constraint);
      await rejects(t, 'dar de baja', updateScore(scoreId, 'fecha_eliminacion = now()'), constraint);
      await rejects(t, 'pasar la nota a una evaluación del trimestre abierto', updateScore(scoreId, `evaluacion_id = ${secondTerm}`), constraint);
      const openScore = await t.fixtures.score({ evaluationId: secondTerm, enrollmentId: unscoredId });
      await rejects(t, 'pasar una nota del trimestre abierto al cerrado', updateScore(openScore, `evaluacion_id = ${firstTerm}`), constraint);
      await passes(t, 'corregir en el trimestre abierto', updateScore(openScore, 'nota = 4'));
      // Una calificación dada de baja se rechaza antes por la baja
      await rejects(t, 'corregir una dada de baja', [
        'ALTER TABLE calificacion DISABLE TRIGGER trg_calificacion_trimestre_cerrado',
        updateScore(scoreId, 'fecha_eliminacion = now()'),
        'ALTER TABLE calificacion ENABLE TRIGGER trg_calificacion_trimestre_cerrado',
        updateScore(scoreId, 'nota = 2'),
      ], 'ck_calificacion_vigente');
      // La baja en cascada de la evaluación la rechaza antes trg_evaluacion_trimestre_cerrado; sin
      // él (se vuelve a activar al deshacer el intento), este rechazo queda como segunda barrera
      await rejects(t, 'baja en cascada', [
        'ALTER TABLE evaluacion DISABLE TRIGGER trg_evaluacion_trimestre_cerrado',
        updateEvaluation(firstTerm, 'fecha_eliminacion = now()'),
      ], constraint);
    });
  });

  test('evaluation-closed-term', 'Una evaluación de un trimestre cerrado no se crea, no se edita, no se da de baja y ninguna pasa a uno cerrado', async (t) => {
    const constraint = 'ck_evaluacion_trimestre_cerrado';
    await rolledBack(t, async () => {
      await setClock(t, '05-20');
      const enrollmentId = await enrollOn(t, '03-01');
      const unscored = await evaluationOn(t, '05-10');
      const scored = await evaluationOn(t, '05-11');
      await t.fixtures.score({ evaluationId: scored, enrollmentId });
      const deleted = await evaluationOn(t, '05-12');
      await t.db.query(`UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, [deleted]);
      const otherAssignment = await t.fixtures.assign({ teacherId: t.data.teacher.id, courseId: t.data.course.id });
      await setClock(t, '06-20');
      const open = await evaluationOn(t, '06-15');
      const insert = (monthDay) => ({
        sql: `INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, 'En un trimestre cerrado', $2)`,
        params: [t.data.assignment.id, `${t.year}-${monthDay}`],
      });
      await rejects(t, 'crear con una fecha del trimestre cerrado', insert('05-25'), constraint);
      await passes(t, 'crear con una fecha del trimestre abierto', insert('06-01'));
      for (const [label, evaluationId] of [['sin notas', unscored], ['calificada', scored]]) {
        await rejects(t, `editar el título (${label})`, updateEvaluation(evaluationId, `titulo = titulo || ' (corregida)'`), constraint);
        await rejects(t, `pasarla al trimestre abierto (${label})`, updateEvaluation(evaluationId, 'fecha_evaluacion = $2', [`${t.year}-06-15`]), constraint);
        await rejects(t, `darla de baja (${label})`, updateEvaluation(evaluationId, 'fecha_eliminacion = now()'), constraint);
      }
      await rejects(t, 'cambiarle la asignación', updateEvaluation(unscored, 'asignacion_docente_id = $2', [otherAssignment.id]), constraint);
      await rejects(t, 'pasar una del trimestre abierto al cerrado', updateEvaluation(open, 'fecha_evaluacion = $2', [`${t.year}-05-30`]), constraint);
      await passes(t, 'editar una del trimestre abierto', updateEvaluation(open, `titulo = titulo || ' (corregida)', fecha_evaluacion = $2`, [`${t.year}-06-18`]));
      await passes(t, 'dar de baja una del trimestre abierto', updateEvaluation(open, 'fecha_eliminacion = now()'));
      // En una dada de baja gana ck_evaluacion_vigente
      await rejects(t, 'editar una dada de baja', updateEvaluation(deleted, `titulo = titulo || ' (corregida)'`), 'ck_evaluacion_vigente');
    });
  });

  test('evaluation-before-enrollment', 'Una evaluación calificada no pasa a una fecha anterior a la inscripción de un calificado', async (t) => {
    const constraint = 'ck_evaluacion_fecha_anterior_inscripcion';
    await rolledBack(t, async () => {
      await setClock(t, '10-20');
      const scoredId = await enrollOn(t, '10-05');
      const laterUnscored = await enrollOn(t, '10-08');
      const evaluationId = await evaluationOn(t, '10-10');
      const scoreId = await t.fixtures.score({ evaluationId, enrollmentId: scoredId });
      const moveTo = (monthDay) => updateEvaluation(evaluationId, 'fecha_evaluacion = $2', [`${t.year}-${monthDay}`]);
      await rejects(t, 'antes de la inscripción del calificado', moveTo('10-01'), constraint);
      await passes(t, 'al día de la inscripción del calificado, antes de la de un inscripto sin nota', moveTo('10-05'));
      await passes(t, 'a una fecha posterior', moveTo('10-15'));
      await passes(t, 'antes de la inscripción, después de dar de baja la nota', [updateScore(scoreId, 'fecha_eliminacion = now()'), moveTo('10-01')]);
      t.check(laterUnscored, 'La inscripción sin nota existe');
    });
  });

  test('term-average-view', 'vw_promedio_trimestral: sin nota o con la nota dada de baja cuenta 0, sin redondear, solo desde la inscripción y hasta hoy, sin canceladas ni dadas de baja', {
    history: [{ plan: 'Pedido del 2026-11-08: formato único de los trimestres (sin plan en plans/)', date: '2026-11-08', change: 'Los trimestres se nombran "1° trimestre", "2° trimestre" y "3° trimestre" (antes "1.er", "2.º", "3.er") en los comentarios y en el mensaje de la comprobación' }],
  }, async (t) => {
    await rolledBack(t, async () => {
      // 1° trimestre, todavía abierto
      await setClock(t, '05-20');
      const full = await enrollOn(t, '03-01');
      const late = await enrollOn(t, '05-12');
      const cancelled = await enrollOn(t, '03-01');
      const deleted = await enrollOn(t, '03-01', { deleted: true });
      const first = [await evaluationOn(t, '04-10'), await evaluationOn(t, '05-10'), await evaluationOn(t, '05-15')];
      for (const [evaluationId, value] of [[first[0], 7], [first[1], 7], [first[2], 8]]) {
        await t.fixtures.score({ evaluationId, enrollmentId: full, value });
      }
      await t.fixtures.score({ evaluationId: first[0], enrollmentId: cancelled, value: 10 });
      await t.fixtures.setEnrollmentStatus(cancelled, 'CANCELADA');
      // late se inscribió el 12/05: solo cuenta la del 15/05, con la nota dada de baja
      const lateScore = await t.fixtures.score({ evaluationId: first[2], enrollmentId: late, value: 9 });
      await t.db.query(`UPDATE calificacion SET fecha_eliminacion = now() WHERE calificacion_id = $1`, [lateScore]);
      // Sin evaluaciones en el 2° trimestre. En el 3°, una con nota, otra sin nota y una futura
      await setClock(t, '10-20');
      const third = await evaluationOn(t, '10-10');
      await evaluationOn(t, '10-15');
      const future = await evaluationOn(t, '12-20');
      await t.fixtures.score({ evaluationId: third, enrollmentId: full, value: 6 });
      // Una materia del curso sin evaluaciones
      const emptyAssignment = await t.fixtures.assign({ teacherId: t.data.teacher.id, courseId: t.data.course.id });
      const ids = [full, late, cancelled, deleted, t.data.closed.enrollmentId];
      const rows = await t.sql(
        `SELECT inscripcion_id AS enrollment, asignacion_docente_id AS assignment, trimestre AS term,
                ROUND(promedio, 6)::TEXT AS average, promedio <> ROUND(promedio, 2) AS "moreThanTwoDecimals", evaluaciones AS evaluations
           FROM vw_promedio_trimestral WHERE inscripcion_id = ANY($1::INT[]) ORDER BY 1, 2, 3`, [ids]);
      const { assignment, closed } = t.data;
      const row = (enrollment, assignmentId, term, average, evaluations, moreThanTwoDecimals = false) =>
        ({ enrollment, assignment: assignmentId, term, average, moreThanTwoDecimals, evaluations });
      const expected = [
        row(full, assignment.id, 1, '7.333333', 3, true),
        row(full, assignment.id, 3, '3.000000', 2),
        row(late, assignment.id, 1, '0.000000', 1),
        row(late, assignment.id, 3, '0.000000', 2),
        row(closed.enrollmentId, closed.assignment.id, 2, '8.500000', 1),
      ].sort((a, b) => a.enrollment - b.enrollment || a.assignment - b.assignment || a.term - b.term);
      t.equal(rows, expected,
        'Promedios: 22/3 sin redondear; la evaluación sin nota y la nota dada de baja cuentan 0; la anterior a la inscripción y la futura no cuentan; la finalizada tiene promedio; la cancelada, la dada de baja, el 2° trimestre y la materia sin evaluaciones no tienen filas');
      t.check(future && emptyAssignment.id, 'La evaluación futura y la materia sin evaluaciones existen');
    });
  });
});
