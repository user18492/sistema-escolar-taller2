// Capa de base de datos (sin Electron): las reglas que hacen cumplir los triggers y las
// restricciones. Cada intento corre en una transacción que se deshace (lib/sql.js), sobre datos
// propios del grupo. Se comprueba el código y el nombre de la restricción, nunca el mensaje.
const { group, test } = require('../lib/framework');
const { attempt, rejectedBy } = require('../lib/sql');
const { SEED_INSTITUTIONS } = require('../lib/fixtures');

async function rejects(t, label, statements, constraint) {
  const result = await attempt(t.db, statements);
  return t.check(rejectedBy(result, constraint), `${label}: se esperaba el rechazo de ${constraint}`, result);
}

async function passes(t, label, statements) {
  const result = await attempt(t.db, statements);
  return t.check(result.ok, `${label}: la base no debería rechazarlo`, result);
}

const userInsert = (fields) => ({
  sql: `INSERT INTO usuario (institucion_id, usuario_rol_id, estado, nombre, apellido, dni, email, fecha_nacimiento, password_hash, fecha_eliminacion)
        VALUES ($1, (SELECT usuario_rol_id FROM usuario_rol WHERE nombre = $2), $3, 'Regla', 'Prueba', $4, $5, '1990-01-01',
                '$2b$04$' || repeat('a', 53), $6)`,
  params: [fields.institutionId, fields.role ?? 'PROFESOR', fields.active ?? true, fields.dni ?? '91234567', fields.email ?? 'regla.prueba@prueba.edu.ar', fields.deletedAt ?? null],
});

group('db.users', 'Reglas de usuario', {
  async setup({ fixtures }) {
    const institution = await fixtures.createInstitution();
    const onlyAdmin = await fixtures.createUser({ institutionId: institution.id, role: 'ADMIN' });
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const course = await fixtures.createCourse();
    await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    // Un profesor con una sola asignación vigente, de un ciclo cerrado, y un curso del ciclo actual
    // sin asignaciones para sumarle otra
    const closedTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    await fixtures.inSchoolYear(fixtures.year - 1, async () => {
      const closedCourse = await fixtures.createCourse();
      await fixtures.assign({ teacherId: closedTeacher.id, courseId: closedCourse.id });
    });
    const emptyCourse = await fixtures.createCourse();
    return { institution, onlyAdmin, teacher, closedTeacher, emptyCourse, sm: await fixtures.institutionId(SEED_INSTITUTIONS.SM) };
  },
}, () => {
  test('format-checks', 'Formato de los datos: dado de baja suspendido, email en minúsculas, dni y hash bcrypt', async (t) => {
    const sm = t.data.sm;
    await rejects(t, 'dado de baja y activo', userInsert({ institutionId: sm, active: true, deletedAt: '2026-01-01' }), 'ck_usuario_baja_suspendido');
    await rejects(t, 'email con mayúsculas', userInsert({ institutionId: sm, email: 'Regla.Prueba@prueba.edu.ar' }), 'ck_usuario_email');
    await rejects(t, 'dni que empieza con 0', userInsert({ institutionId: sm, dni: '01234567' }), 'ck_usuario_dni');
    await rejects(t, 'contraseña sin hash', {
      sql: `UPDATE usuario SET password_hash = 'texto plano' WHERE usuario_id = $1`, params: [t.data.teacher.id],
    }, 'ck_usuario_password_hash');
    await passes(t, 'usuario válido', userInsert({ institutionId: sm }));
  });

  test('unique-among-current', 'El dni y el email no se repiten entre los vigentes de una institución y un rol; los dados de baja no cuentan', async (t) => {
    const { teacher } = t.data;
    await rejects(t, 'mismo dni y rol', userInsert({ institutionId: teacher.institutionId, dni: teacher.dni }), 'uq_usuario_institucion_usuario_rol_dni');
    await rejects(t, 'mismo email y rol', userInsert({ institutionId: teacher.institutionId, email: teacher.email }), 'uq_usuario_institucion_usuario_rol_email');
    await passes(t, 'mismo dni con otro rol', userInsert({ institutionId: teacher.institutionId, dni: teacher.dni, role: 'SECRETARIO' }));
    await passes(t, 'mismo dni después de la baja del primero', [
      { sql: `UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE usuario_id = $1`, params: [teacher.id] },
      { sql: `UPDATE usuario SET estado = false, fecha_eliminacion = now() WHERE usuario_id = $1`, params: [teacher.id] },
      userInsert({ institutionId: teacher.institutionId, dni: teacher.dni }),
    ]);
  });

  test('role-institution-immutable', 'El rol y la institución de un usuario no cambian', async (t) => {
    const { teacher, institution } = t.data;
    await rejects(t, 'cambio de rol', {
      sql: `UPDATE usuario SET usuario_rol_id = (SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO') WHERE usuario_id = $1`,
      params: [teacher.id],
    }, 'ck_usuario_rol_inmutable');
    await rejects(t, 'cambio de institución', {
      sql: `UPDATE usuario SET institucion_id = $2 WHERE usuario_id = $1`, params: [teacher.id, institution.id],
    }, 'ck_usuario_institucion_inmutable');
  });

  test('last-admin', 'El último administrador activo y vigente de una institución no se suspende ni se da de baja', async (t) => {
    const { onlyAdmin, institution } = t.data;
    await rejects(t, 'suspender al único', { sql: `UPDATE usuario SET estado = false WHERE usuario_id = $1`, params: [onlyAdmin.id] }, 'ck_usuario_ultimo_administrador');
    await rejects(t, 'dar de baja al único', {
      sql: `UPDATE usuario SET estado = false, fecha_eliminacion = now() WHERE usuario_id = $1`, params: [onlyAdmin.id],
    }, 'ck_usuario_ultimo_administrador');
    await passes(t, 'suspender con otro administrador activo', [
      userInsert({ institutionId: institution.id, role: 'ADMIN', dni: '91111111', email: 'otro.admin@prueba.edu.ar' }),
      { sql: `UPDATE usuario SET estado = false WHERE usuario_id = $1`, params: [onlyAdmin.id] },
    ]);
  });

  test('teacher-with-assignments', 'Un profesor con asignaciones vigentes del ciclo actual no se da de baja, pero sí se suspende', async (t) => {
    const { teacher } = t.data;
    await rejects(t, 'baja con asignación vigente', {
      sql: `UPDATE usuario SET estado = false, fecha_eliminacion = now() WHERE usuario_id = $1`, params: [teacher.id],
    }, 'ck_usuario_asignaciones_vigentes');
    await passes(t, 'suspensión con asignación vigente', { sql: `UPDATE usuario SET estado = false WHERE usuario_id = $1`, params: [teacher.id] });
  });

  test('teacher-closed-school-year', 'Las asignaciones vigentes de un ciclo cerrado no impiden la baja del profesor; una del ciclo actual sí', async (t) => {
    const { closedTeacher, emptyCourse } = t.data;
    const markAsDeleted = { sql: `UPDATE usuario SET estado = false, fecha_eliminacion = now() WHERE usuario_id = $1`, params: [closedTeacher.id] };
    await passes(t, 'baja con una asignación vigente de un ciclo cerrado', markAsDeleted);
    await rejects(t, 'baja con otra asignación vigente del ciclo actual', [
      {
        sql: `INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
              SELECT $1, c.curso_id, gm.grado_materia_id FROM curso c JOIN grado_materia gm ON gm.grado_id = c.grado_id
               WHERE c.curso_id = $2 ORDER BY gm.grado_materia_id LIMIT 1`,
        params: [closedTeacher.id, emptyCourse.id],
      },
      markAsDeleted,
    ], 'ck_usuario_asignaciones_vigentes');
  });
});

group('db.courses', 'Reglas de cursos y asignaciones docentes', {
  async setup({ fixtures }) {
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const secretary = await fixtures.createUser({ role: 'SECRETARIO' });
    const deletedTeacher = await fixtures.createUser({ role: 'PROFESOR', deleted: true });
    const suspendedTeacher = await fixtures.createUser({ role: 'PROFESOR', active: false });
    const otherTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const otherInstitution = await fixtures.createInstitution();
    const foreignTeacher = await fixtures.createUser({ institutionId: otherInstitution.id, role: 'PROFESOR' });
    const course = await fixtures.createCourse();
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    const emptyCourse = await fixtures.createCourse();
    const evaluatedCourse = await fixtures.createCourse();
    const evaluatedAssignment = await fixtures.assign({ teacherId: teacher.id, courseId: evaluatedCourse.id });
    await fixtures.createEvaluation({ assignmentId: evaluatedAssignment.id });
    const enrolledCourse = await fixtures.createCourse();
    const student = await fixtures.createStudent();
    await fixtures.enroll({ studentId: student.id, courseId: enrolledCourse.id });
    const otherGrade = await fixtures.gradeId('PRIMARIA', '1°');
    const otherGradeSubject = (await fixtures.subjectsOfGrade(otherGrade))[0];
    return { teacher, secretary, deletedTeacher, suspendedTeacher, otherTeacher, foreignTeacher, course, assignment, emptyCourse,
      evaluatedCourse, evaluatedAssignment, enrolledCourse, otherGrade, otherGradeSubject };
  },
}, () => {
  // Sin trg_curso_ciclo_lectivo (se vuelve a activar al deshacer el intento), que rechaza antes
  // cualquier cambio de ciclo lectivo
  const withoutSchoolYearRule = (statement) => ['ALTER TABLE curso DISABLE TRIGGER trg_curso_ciclo_lectivo', statement];

  test('course-checks', 'División, turno y ciclo lectivo con formato válido', {
    history: [{ plan: 'plans/ciclo-lectivo/00-base-de-datos.md', date: '2026-10-26', change: 'El ciclo fuera de rango se prueba con trg_curso_ciclo_lectivo desactivado dentro del intento: si no, lo rechaza antes como ciclo cerrado' }],
  }, async (t) => {
    const { emptyCourse } = t.data;
    const update = (set) => ({ sql: `UPDATE curso SET ${set} WHERE curso_id = $1`, params: [emptyCourse.id] });
    await rejects(t, 'división en minúscula', update(`division = 'a'`), 'ck_curso_division');
    await rejects(t, 'turno desconocido', update(`turno = 'NOCHE'`), 'ck_curso_turno');
    await rejects(t, 'ciclo fuera de rango', withoutSchoolYearRule(update('anio_ciclo_lectivo = 1999')), 'ck_curso_anio_ciclo_lectivo');
  });

  test('course-unique-among-current', 'Un curso vigente no se repite; uno dado de baja no cuenta', async (t) => {
    const { course } = t.data;
    const duplicate = {
      sql: `INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
            SELECT institucion_id, grado_id, division, turno, anio_ciclo_lectivo FROM curso WHERE curso_id = $1`,
      params: [course.id],
    };
    await rejects(t, 'curso repetido', duplicate, 'uq_curso_institucion_grado_division_turno_anio_ciclo_lectivo');
    await passes(t, 'repetido después de la baja', [
      { sql: `UPDATE curso SET fecha_eliminacion = now() WHERE curso_id = $1`, params: [course.id] },
      duplicate,
    ]);
  });

  test('course-locked-by-dependents', 'Un curso conserva su grado con asignaciones, su ciclo con inscripciones o evaluaciones y su institución con inscripciones', {
    history: [{ plan: 'plans/ciclo-lectivo/00-base-de-datos.md', date: '2026-10-26', change: 'Los dos cambios de ciclo se prueban con trg_curso_ciclo_lectivo desactivado dentro del intento: si no, los rechaza antes como ciclo futuro' }],
  }, async (t) => {
    const { course, enrolledCourse, evaluatedCourse, otherGrade } = t.data;
    await rejects(t, 'grado con asignaciones', { sql: `UPDATE curso SET grado_id = $2 WHERE curso_id = $1`, params: [course.id, otherGrade] }, 'ck_curso_asignaciones_vigentes');
    await rejects(t, 'ciclo con inscripciones', withoutSchoolYearRule({ sql: `UPDATE curso SET anio_ciclo_lectivo = anio_ciclo_lectivo + 1 WHERE curso_id = $1`, params: [enrolledCourse.id] }), 'ck_curso_inscripciones');
    await rejects(t, 'ciclo con evaluaciones', withoutSchoolYearRule({ sql: `UPDATE curso SET anio_ciclo_lectivo = anio_ciclo_lectivo + 1 WHERE curso_id = $1`, params: [evaluatedCourse.id] }), 'ck_curso_evaluaciones_vigentes');
  });

  test('assignment-coherence', 'Una asignación vigente es de un profesor vigente de la institución del curso, con una materia de su grado', async (t) => {
    const { course, secretary, deletedTeacher, foreignTeacher, teacher, otherGradeSubject } = t.data;
    const insert = (userId, gradeSubjectSql = `(SELECT grado_materia_id FROM grado_materia WHERE grado_id = c.grado_id ORDER BY grado_materia_id DESC LIMIT 1)`) => ({
      sql: `INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id) SELECT $1, c.curso_id, ${gradeSubjectSql} FROM curso c WHERE c.curso_id = $2`,
      params: [userId, course.id],
    });
    await rejects(t, 'usuario que no es profesor', insert(secretary.id), 'ck_asignacion_docente_usuario_profesor');
    await rejects(t, 'profesor dado de baja', insert(deletedTeacher.id), 'ck_asignacion_docente_usuario_vigente');
    await rejects(t, 'profesor de otra institución', insert(foreignTeacher.id), 'ck_asignacion_docente_misma_institucion');
    await rejects(t, 'materia de otro grado', insert(teacher.id, String(otherGradeSubject.gradeSubjectId)), 'ck_asignacion_docente_materia_del_grado');
  });

  test('assignment-unique-subject', 'Una materia de un curso tiene un solo profesor vigente; una asignación dada de baja no cuenta', async (t) => {
    const { assignment, course, teacher } = t.data;
    const duplicate = {
      sql: `INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id) VALUES ($1, $2, $3)`,
      params: [teacher.id, course.id, assignment.gradeSubjectId],
    };
    await rejects(t, 'misma materia y curso', duplicate, 'uq_asignacion_docente_curso_grado_materia');
    await passes(t, 'después de la baja', [
      { sql: `UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, params: [assignment.id] },
      duplicate,
    ]);
  });

  test('assignment-course-locked', 'Una asignación con evaluaciones vigentes conserva su curso', async (t) => {
    const { evaluatedAssignment, emptyCourse } = t.data;
    await rejects(t, 'cambio de curso con evaluaciones', {
      sql: `UPDATE asignacion_docente SET curso_id = $2 WHERE asignacion_docente_id = $1`, params: [evaluatedAssignment.id, emptyCourse.id],
    }, 'ck_asignacion_docente_evaluaciones_vigentes');
  });

  test('assignment-subject-locked', 'Una asignación con evaluaciones vigentes conserva su materia, pero le cambia el profesor', async (t) => {
    const { evaluatedAssignment, evaluatedCourse, otherTeacher } = t.data;
    const otherSubject = (await t.fixtures.subjectsOfGrade(evaluatedCourse.gradeId))
      .find((subject) => subject.gradeSubjectId !== evaluatedAssignment.gradeSubjectId);
    await rejects(t, 'cambio de materia con evaluaciones', {
      sql: `UPDATE asignacion_docente SET grado_materia_id = $2 WHERE asignacion_docente_id = $1`,
      params: [evaluatedAssignment.id, otherSubject.gradeSubjectId],
    }, 'ck_asignacion_docente_evaluaciones_vigentes');
    await passes(t, 'cambio de profesor con evaluaciones', {
      sql: `UPDATE asignacion_docente SET usuario_id = $2 WHERE asignacion_docente_id = $1`, params: [evaluatedAssignment.id, otherTeacher.id],
    });
  });

  test('assignment-delete-with-evaluations', 'Una asignación con evaluaciones vigentes no se da de baja; sin ellas, sí', async (t) => {
    const { evaluatedAssignment } = t.data;
    const markAsDeleted = {
      sql: `UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, params: [evaluatedAssignment.id],
    };
    await rejects(t, 'baja con evaluaciones', markAsDeleted, 'ck_asignacion_docente_evaluaciones_vigentes');
    await passes(t, 'baja después de dar de baja sus evaluaciones', [
      { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1 AND fecha_eliminacion IS NULL`, params: [evaluatedAssignment.id] },
      markAsDeleted,
    ]);
  });

  test('assignment-deleted-frozen', 'Una asignación dada de baja no se modifica ni se restaura', async (t) => {
    const { assignment, course, otherTeacher, emptyCourse } = t.data;
    const otherSubject = (await t.fixtures.subjectsOfGrade(course.gradeId))
      .find((subject) => subject.gradeSubjectId !== assignment.gradeSubjectId);
    const markAsDeleted = { sql: `UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, params: [assignment.id] };
    const changes = [
      ['cambiar el profesor', `UPDATE asignacion_docente SET usuario_id = $2 WHERE asignacion_docente_id = $1`, [otherTeacher.id]],
      ['cambiar el curso', `UPDATE asignacion_docente SET curso_id = $2 WHERE asignacion_docente_id = $1`, [emptyCourse.id]],
      ['cambiar la materia', `UPDATE asignacion_docente SET grado_materia_id = $2 WHERE asignacion_docente_id = $1`, [otherSubject.gradeSubjectId]],
      ['restaurarla', `UPDATE asignacion_docente SET fecha_eliminacion = NULL WHERE asignacion_docente_id = $1`, []],
      ['cambiar la fecha de baja', `UPDATE asignacion_docente SET fecha_eliminacion = now() - interval '1 day' WHERE asignacion_docente_id = $1`, []],
    ];
    for (const [label, sql, params] of changes) {
      await rejects(t, label, [markAsDeleted, { sql, params: [assignment.id, ...params] }], 'ck_asignacion_docente_vigente');
    }
  });

  test('deleted-course-editable', 'Hoy la base deja editar un curso dado de baja', {
    kind: 'current',
    affectedBy: ['administrador-cursos'],
  }, async (t) => {
    await passes(t, 'edición de un curso dado de baja', [
      { sql: `UPDATE curso SET fecha_eliminacion = now() WHERE curso_id = $1`, params: [t.data.emptyCourse.id] },
      { sql: `UPDATE curso SET turno = 'MAÑANA' WHERE curso_id = $1`, params: [t.data.emptyCourse.id] },
    ]);
  });

  test('assignment-suspended-teacher', 'Una asignación vigente no se crea ni se edita con un profesor suspendido, aunque sea el que ya tiene; sí se da de baja o se le cambia el profesor', {
    history: [{ plan: 'plans/administrador-usuarios.md', date: '2026-10-26', change: 'La base ya no acepta a un profesor suspendido en una asignación vigente: el alta, la edición que lo conserva y el cambio a uno suspendido esperan ck_asignacion_docente_usuario_activo; la baja lógica y el cambio a uno activo pasan' }],
  }, async (t) => {
    const { suspendedTeacher, otherTeacher, teacher, assignment, emptyCourse } = t.data;
    const suspend = { sql: `UPDATE usuario SET estado = false WHERE usuario_id = $1`, params: [teacher.id] };
    const updateAssignment = (set, params = []) => ({
      sql: `UPDATE asignacion_docente SET ${set} WHERE asignacion_docente_id = $1`, params: [assignment.id, ...params],
    });
    await rejects(t, 'alta con un profesor suspendido', {
      sql: `INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
            SELECT $1, c.curso_id, gm.grado_materia_id FROM curso c JOIN grado_materia gm ON gm.grado_id = c.grado_id
             WHERE c.curso_id = $2 ORDER BY gm.grado_materia_id DESC LIMIT 1`,
      params: [suspendedTeacher.id, emptyCourse.id],
    }, 'ck_asignacion_docente_usuario_activo');
    await rejects(t, 'edición que conserva al profesor después de suspenderlo', [suspend, updateAssignment('usuario_id = usuario_id')], 'ck_asignacion_docente_usuario_activo');
    await rejects(t, 'cambio a un profesor suspendido', updateAssignment('usuario_id = $2', [suspendedTeacher.id]), 'ck_asignacion_docente_usuario_activo');
    await passes(t, 'baja lógica de la asignación de un profesor suspendido', [suspend, updateAssignment('fecha_eliminacion = now()')]);
    await passes(t, 'cambio del profesor suspendido por uno activo', [suspend, updateAssignment('usuario_id = $2', [otherTeacher.id])]);
  });
});

group('db.enrollments', 'Reglas de alumnos e inscripciones', {
  async setup({ fixtures }) {
    const course = await fixtures.createCourse();
    const otherCourse = await fixtures.createCourse();
    const pastCourse = await fixtures.inSchoolYear(fixtures.year - 1, () => fixtures.createCourse());
    const otherInstitution = await fixtures.createInstitution();
    const foreignCourse = await fixtures.createCourse({ institutionId: otherInstitution.id });
    const student = await fixtures.createStudent();
    const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
    const free = await fixtures.createStudent();
    const toDelete = await fixtures.createStudent();
    const toDeleteEnrollment = await fixtures.enroll({ studentId: toDelete.id, courseId: course.id });
    const graduated = await fixtures.createStudent({ status: 'EGRESADO' });
    return { course, otherCourse, pastCourse, foreignCourse, otherInstitution, student, enrollmentId, free, toDelete, toDeleteEnrollment, graduated };
  },
}, () => {
  const enrollSql = (studentId, courseId, status = 'ACTIVA', date = null) => ({
    sql: `INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
          VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = $3), COALESCE($4::date, CURRENT_DATE))`,
    params: [studentId, courseId, status, date],
  });

  test('student-checks', 'Teléfono con solo dígitos y dni y email únicos por institución (también con dados de baja)', async (t) => {
    const { student, free } = t.data;
    await rejects(t, 'teléfono con guiones', { sql: `UPDATE alumno SET telefono = '379-412-3456' WHERE alumno_id = $1`, params: [free.id] }, 'ck_alumno_telefono');
    await rejects(t, 'dni repetido', { sql: `UPDATE alumno SET dni = $2 WHERE alumno_id = $1`, params: [free.id, student.dni] }, 'uq_alumno_institucion_dni');
    await rejects(t, 'email repetido', { sql: `UPDATE alumno SET email = $2 WHERE alumno_id = $1`, params: [free.id, student.email] }, 'uq_alumno_institucion_email');
  });

  test('enrollment-coherence', 'La inscripción es de la misma institución, del año del ciclo del curso y no de un ciclo cerrado, y el alumno con inscripciones conserva su institución', {
    history: [{ plan: 'plans/ciclo-lectivo/00-base-de-datos.md', date: '2026-10-26', change: 'Un curso de un ciclo anterior ya no acepta inscripciones, ni con fecha de ese año: ahora espera ck_inscripcion_ciclo_lectivo_cerrado' }],
  }, async (t) => {
    const { free, foreignCourse, course, student, otherInstitution, pastCourse } = t.data;
    await rejects(t, 'curso de otra institución', enrollSql(free.id, foreignCourse.id), 'ck_inscripcion_misma_institucion');
    await rejects(t, 'fecha de otro año', enrollSql(free.id, course.id, 'ACTIVA', `${t.year - 1}-12-31`), 'ck_inscripcion_fecha_ciclo_lectivo');
    await rejects(t, 'curso de un ciclo anterior con fecha de ese año', enrollSql(free.id, pastCourse.id, 'CANCELADA', `${t.year - 1}-06-01`), 'ck_inscripcion_ciclo_lectivo_cerrado');
    await rejects(t, 'cambio de institución con inscripciones', {
      sql: `UPDATE alumno SET institucion_id = $2 WHERE alumno_id = $1`, params: [student.id, otherInstitution.id],
    }, 'ck_alumno_inscripciones');
  });

  test('one-active', 'Un alumno tiene una sola inscripción activa y vigente; las dadas de baja no cuentan', async (t) => {
    const { student, otherCourse, enrollmentId } = t.data;
    await rejects(t, 'segunda activa', enrollSql(student.id, otherCourse.id), 'ck_inscripcion_alumno_una_activa');
    await passes(t, 'segunda cancelada', enrollSql(student.id, otherCourse.id, 'CANCELADA'));
    await passes(t, 'activa después de la baja de la anterior', [
      { sql: `UPDATE inscripcion SET fecha_eliminacion = now() WHERE inscripcion_id = $1`, params: [enrollmentId] },
      enrollSql(student.id, otherCourse.id),
    ]);
  });

  test('student-delete-procedure', 'sp_alumno_dar_de_baja da de baja al alumno y cancela su inscripción activa sin darla de baja, todo o nada', async (t) => {
    const { toDelete, toDeleteEnrollment, course } = t.data;
    const institutionId = (await t.sqlOne(`SELECT institucion_id FROM curso WHERE curso_id = $1`, [course.id])).institucion_id;
    const result = await attempt(t.db, [
      { sql: 'CALL sp_alumno_dar_de_baja($1, $2, NULL)', params: [toDelete.id, institutionId] },
    ]);
    t.check(result.ok && result.rows?.[0]?.p_inscripciones_canceladas === 1, 'Canceló una inscripción', result);
    const effects = await attempt(t.db, [
      { sql: 'CALL sp_alumno_dar_de_baja($1, $2, NULL)', params: [toDelete.id, institutionId] },
      {
        sql: `SELECT a.fecha_eliminacion IS NOT NULL AS alumno_baja, e.nombre AS estado, i.fecha_eliminacion IS NULL AS inscripcion_vigente
                FROM alumno a JOIN inscripcion i USING (alumno_id) JOIN inscripcion_estado e USING (inscripcion_estado_id)
               WHERE i.inscripcion_id = $1`,
        params: [toDeleteEnrollment],
      },
    ]);
    t.equal(effects.rows?.[0], { alumno_baja: true, estado: 'CANCELADA', inscripcion_vigente: true }, 'Estado después de la baja');
    const twice = await attempt(t.db, [
      { sql: 'CALL sp_alumno_dar_de_baja($1, $2, NULL)', params: [toDelete.id, institutionId] },
      { sql: 'CALL sp_alumno_dar_de_baja($1, $2, NULL)', params: [toDelete.id, institutionId] },
    ]);
    t.check(twice.code === '55000', 'La segunda baja da object_not_in_prerequisite_state', twice);
    const missing = await attempt(t.db, { sql: 'CALL sp_alumno_dar_de_baja($1, $2, NULL)', params: [2147483000, institutionId] });
    t.check(missing.code === 'P0002', 'Un alumno inexistente da no_data_found', missing);
    const foreign = await attempt(t.db, { sql: 'CALL sp_alumno_dar_de_baja($1, $2, NULL)', params: [toDelete.id, t.data.otherInstitution.id] });
    t.check(foreign.code === 'P0002', 'Un alumno de otra institución da no_data_found', foreign);
  });

  test('deleted-student-enrollable', 'Hoy la base acepta inscribir a un alumno dado de baja o egresado', {
    kind: 'current',
    affectedBy: ['secretario-alumnos', 'secretario-inscripciones'],
  }, async (t) => {
    await passes(t, 'alumno dado de baja', [
      { sql: `UPDATE alumno SET fecha_eliminacion = now() WHERE alumno_id = $1`, params: [t.data.free.id] },
      enrollSql(t.data.free.id, t.data.otherCourse.id),
    ]);
    await passes(t, 'alumno egresado', enrollSql(t.data.graduated.id, t.data.otherCourse.id));
  });

  test('completed-in-current-cycle', 'Hoy la base acepta una inscripción finalizada en el ciclo actual', {
    kind: 'current',
    affectedBy: ['secretario-inscripciones', 'ciclo-lectivo'],
  }, async (t) => {
    await passes(t, 'finalizada en el ciclo actual', {
      sql: `UPDATE inscripcion SET inscripcion_estado_id = (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'FINALIZADA')
             WHERE inscripcion_id = $1`,
      params: [t.data.enrollmentId],
    });
  });
});

group('db.scores', 'Reglas de evaluaciones y calificaciones', {
  async setup({ fixtures }) {
    const { teacher, course, assignment, student, enrollmentId, evaluationId } = await fixtures.teacherScenario();
    const otherCourse = await fixtures.createCourse();
    const otherAssignment = await fixtures.assign({ teacherId: teacher.id, courseId: otherCourse.id });
    const otherEvaluation = await fixtures.createEvaluation({ assignmentId: otherAssignment.id });
    const cancelledStudent = await fixtures.createStudent();
    const cancelledEnrollment = await fixtures.enroll({ studentId: cancelledStudent.id, courseId: course.id, status: 'CANCELADA' });
    const deletedStudent = await fixtures.createStudent();
    const deletedEnrollment = await fixtures.enroll({ studentId: deletedStudent.id, courseId: course.id, deleted: true });
    const scoredStudent = await fixtures.createStudent();
    const scoredEnrollment = await fixtures.enroll({ studentId: scoredStudent.id, courseId: course.id });
    const scoreId = await fixtures.score({ evaluationId, enrollmentId: scoredEnrollment, value: 8 });
    const lastDay = `${fixtures.year}-12-31`;
    const futureDate = fixtures.today < lastDay ? lastDay : null;
    const futureEvaluation = futureDate ? await fixtures.createEvaluation({ assignmentId: assignment.id, date: futureDate }) : null;
    // Baja en cascada: una evaluación propia con la nota vigente de scoredEnrollment, una ya dada de
    // baja (de enrollmentId) y la de una inscripción que se canceló después de calificarla. No se
    // usa evaluationId, porque otras pruebas dan de baja todas sus calificaciones con un UPDATE
    const cascadeEvaluation = await fixtures.createEvaluation({ assignmentId: assignment.id });
    await fixtures.score({ evaluationId: cascadeEvaluation, enrollmentId: scoredEnrollment });
    const cascadeDeletedScore = await fixtures.score({ evaluationId: cascadeEvaluation, enrollmentId });
    await fixtures.db.query(`UPDATE calificacion SET fecha_eliminacion = now() WHERE calificacion_id = $1`, [cascadeDeletedScore]);
    const laterCancelledStudent = await fixtures.createStudent();
    const laterCancelledEnrollment = await fixtures.enroll({ studentId: laterCancelledStudent.id, courseId: course.id });
    await fixtures.score({ evaluationId: cascadeEvaluation, enrollmentId: laterCancelledEnrollment });
    await fixtures.setEnrollmentStatus(laterCancelledEnrollment, 'CANCELADA');
    return { teacher, course, assignment, student, enrollmentId, evaluationId, otherCourse, otherAssignment, otherEvaluation,
      cancelledEnrollment, deletedEnrollment, scoredEnrollment, scoreId, futureDate, futureEvaluation,
      cascadeEvaluation, cascadeDeletedScore };
  },
}, () => {
  const scoreSql = (evaluationId, enrollmentId, value = 7) => ({
    sql: `INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, $3)`, params: [evaluationId, enrollmentId, value],
  });

  test('evaluation-rules', 'La fecha de una evaluación vigente es del ciclo de su curso y su título no se repite en la asignación', async (t) => {
    const { assignment, evaluationId } = t.data;
    await rejects(t, 'fecha de otro año', {
      sql: `INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, 'Otro año', $2)`,
      params: [assignment.id, `${t.year - 1}-06-10`],
    }, 'ck_evaluacion_fecha_ciclo_lectivo');
    const title = (await t.sqlOne(`SELECT titulo FROM evaluacion WHERE evaluacion_id = $1`, [evaluationId])).titulo;
    const duplicate = { sql: `INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, $2, CURRENT_DATE)`, params: [assignment.id, title] };
    await rejects(t, 'título repetido', duplicate, 'uq_evaluacion_asignacion_docente_titulo');
    await passes(t, 'título repetido después de la baja', [
      { sql: `UPDATE calificacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [evaluationId] },
      { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [evaluationId] },
      duplicate,
    ]);
  });

  test('score-coherence', 'Una nota es de 0 a 10, de una inscripción activa y vigente del curso de la evaluación, y única por evaluación', async (t) => {
    const { evaluationId, enrollmentId, otherEvaluation, cancelledEnrollment, deletedEnrollment, scoredEnrollment } = t.data;
    await rejects(t, 'nota mayor que 10', scoreSql(evaluationId, enrollmentId, 10.5), 'ck_calificacion_nota');
    await rejects(t, 'nota negativa', scoreSql(evaluationId, enrollmentId, -1), 'ck_calificacion_nota');
    await rejects(t, 'inscripción de otro curso', scoreSql(otherEvaluation, enrollmentId), 'ck_calificacion_mismo_curso');
    await rejects(t, 'inscripción cancelada', scoreSql(evaluationId, cancelledEnrollment), 'ck_calificacion_inscripcion_activa');
    await rejects(t, 'inscripción dada de baja', scoreSql(evaluationId, deletedEnrollment), 'ck_calificacion_inscripcion_vigente');
    await rejects(t, 'segunda nota vigente', scoreSql(evaluationId, scoredEnrollment), 'uq_calificacion_evaluacion_inscripcion');
    await passes(t, 'nota válida', scoreSql(evaluationId, enrollmentId, 9.75));
  });

  test('score-frozen-after-enrollment-change', 'La nota de una inscripción que dejó de estar activa no se corrige ni se da de baja', async (t) => {
    const { scoreId, scoredEnrollment } = t.data;
    const cancel = {
      sql: `UPDATE inscripcion SET inscripcion_estado_id = (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'CANCELADA') WHERE inscripcion_id = $1`,
      params: [scoredEnrollment],
    };
    await rejects(t, 'corregir', [cancel, { sql: `UPDATE calificacion SET nota = 9 WHERE calificacion_id = $1`, params: [scoreId] }], 'ck_calificacion_inscripcion_activa');
    await rejects(t, 'dar de baja', [cancel, { sql: `UPDATE calificacion SET fecha_eliminacion = now() WHERE calificacion_id = $1`, params: [scoreId] }], 'ck_calificacion_inscripcion_activa');
  });

  test('locked-by-scores', 'Con notas vigentes, la inscripción conserva su curso y la evaluación su asignación', async (t) => {
    const { scoredEnrollment, otherCourse, evaluationId, otherAssignment } = t.data;
    await rejects(t, 'inscripción cambia de curso', {
      sql: `UPDATE inscripcion SET curso_id = $2 WHERE inscripcion_id = $1`, params: [scoredEnrollment, otherCourse.id],
    }, 'ck_inscripcion_calificaciones_vigentes');
    await rejects(t, 'evaluación cambia de asignación', {
      sql: `UPDATE evaluacion SET asignacion_docente_id = $2 WHERE evaluacion_id = $1`, params: [evaluationId, otherAssignment.id],
    }, 'ck_evaluacion_calificaciones_vigentes');
  });

  test('evaluation-delete-keeps-scores', 'La baja de una evaluación da de baja todas sus calificaciones vigentes, también la de una inscripción cancelada', {
    history: [{ plan: 'plans/profesor-evaluaciones/00-base-de-datos-y-backend.md', date: '2026-10-26', change: 'La baja de una evaluación ya no conserva vigentes sus calificaciones: ahora, sobre cascadeEvaluation, deja 0 vigentes, las dos que lo estaban (una de una inscripción cancelada) quedan con la fecha de baja de la evaluación y la ya dada de baja conserva la suya' }],
  }, async (t) => {
    const { cascadeEvaluation, cascadeDeletedScore } = t.data;
    // Como texto: un Date de JS perdería los microsegundos
    const before = await t.sqlOne(`SELECT fecha_eliminacion::TEXT AS fecha FROM calificacion WHERE calificacion_id = $1`, [cascadeDeletedScore]);
    const result = await attempt(t.db, [
      { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [cascadeEvaluation] },
      {
        sql: `SELECT COUNT(*) FILTER (WHERE c.fecha_eliminacion IS NULL)::INT AS vigentes,
                     COUNT(*) FILTER (WHERE c.calificacion_id <> $2 AND c.fecha_eliminacion = e.fecha_eliminacion)::INT AS con_la_fecha_de_la_evaluacion,
                     bool_and(c.fecha_eliminacion::TEXT = $3) FILTER (WHERE c.calificacion_id = $2) AS conserva_su_fecha
                FROM calificacion c JOIN evaluacion e ON e.evaluacion_id = c.evaluacion_id
               WHERE c.evaluacion_id = $1`,
        params: [cascadeEvaluation, cascadeDeletedScore, before.fecha],
      },
    ]);
    t.check(result.ok, 'La baja de la evaluación no debería rechazarse', result);
    t.equal(result.rows?.[0], { vigentes: 0, con_la_fecha_de_la_evaluacion: 2, conserva_su_fecha: true },
      'Las vigentes quedan dadas de baja con la fecha de la evaluación y la ya dada de baja conserva la suya');
  });

  test('evaluation-delete-completed-scores', 'Una evaluación con calificaciones vigentes de inscripciones finalizadas no se da de baja', async (t) => {
    // La finalizada del ciclo actual hoy se acepta (db.enrollments.completed-in-current-cycle); si
    // secretario-inscripciones la prohíbe, ese plan adapta esta prueba
    const { cascadeEvaluation, scoredEnrollment } = t.data;
    await rejects(t, 'baja con la nota de una inscripción finalizada', [
      {
        sql: `UPDATE inscripcion SET inscripcion_estado_id = (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'FINALIZADA') WHERE inscripcion_id = $1`,
        params: [scoredEnrollment],
      },
      { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [cascadeEvaluation] },
    ], 'ck_calificacion_inscripcion_finalizada');
  });

  test('evaluation-deleted-frozen', 'Una evaluación dada de baja no se modifica ni se restaura', async (t) => {
    const { otherEvaluation, assignment } = t.data;
    const markAsDeleted = { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [otherEvaluation] };
    const changes = [
      ['cambiar el título', `UPDATE evaluacion SET titulo = titulo || ' (corregida)' WHERE evaluacion_id = $1`, []],
      ['cambiar la fecha', `UPDATE evaluacion SET fecha_evaluacion = $2 WHERE evaluacion_id = $1`, [`${t.year}-01-01`]],
      ['cambiar la asignación', `UPDATE evaluacion SET asignacion_docente_id = $2 WHERE evaluacion_id = $1`, [assignment.id]],
      ['restaurarla', `UPDATE evaluacion SET fecha_eliminacion = NULL WHERE evaluacion_id = $1`, []],
      ['cambiar la fecha de baja', `UPDATE evaluacion SET fecha_eliminacion = now() - interval '1 day' WHERE evaluacion_id = $1`, []],
    ];
    for (const [label, sql, params] of changes) {
      await rejects(t, label, [markAsDeleted, { sql, params: [otherEvaluation, ...params] }], 'ck_evaluacion_vigente');
    }
  });

  test('evaluation-deleted-assignment', 'En una asignación dada de baja no se crea ni se edita una evaluación, pero sí se da de baja', {
    history: [{ plan: 'plans/administrador-docencia/00-base-de-datos-y-backend.md', date: '2026-10-27', change: 'La baja de otherAssignment ya no pasa con otherEvaluation vigente: para crear una evaluación, el intento da de baja antes otherEvaluation; editar el título y dar de baja la evaluación se prueban como segunda barrera, con trg_asignacion_docente_evaluaciones_vigentes desactivado dentro del intento, y esperan lo mismo que antes' }],
  }, async (t) => {
    const { otherAssignment, otherEvaluation } = t.data;
    const deleteAssignment = {
      sql: `UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, params: [otherAssignment.id],
    };
    const deleteEvaluation = { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [otherEvaluation] };
    await rejects(t, 'crear una evaluación', [deleteEvaluation, deleteAssignment, {
      sql: `INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, 'En una asignación dada de baja', $2)`,
      params: [otherAssignment.id, t.today],
    }], 'ck_evaluacion_asignacion_vigente');
    // Una asignación con evaluaciones vigentes ya no se da de baja, así que una dada de baja no tiene
    // evaluaciones que editar o dar de baja: el control de fn_evaluacion_coherencia queda como
    // segunda barrera. Para llegar a él, la baja se hace sin trg_asignacion_docente_evaluaciones_vigentes
    // (se vuelve a activar al deshacer el intento), como withoutSchoolYearRule en db.courses
    const withoutEvaluationsRule = (statement) => [
      'ALTER TABLE asignacion_docente DISABLE TRIGGER trg_asignacion_docente_evaluaciones_vigentes', deleteAssignment, statement,
    ];
    await rejects(t, 'editar el título', withoutEvaluationsRule({
      sql: `UPDATE evaluacion SET titulo = titulo || ' (corregida)' WHERE evaluacion_id = $1`, params: [otherEvaluation],
    }), 'ck_evaluacion_asignacion_vigente');
    await passes(t, 'dar de baja la evaluación', withoutEvaluationsRule(deleteEvaluation));
  });

  test('score-on-future-evaluation', 'Una evaluación con fecha futura no se califica, y una calificada no pasa a una fecha futura', {
    history: [{ plan: 'plans/profesor-calificaciones.md', date: '2026-10-26', change: 'La base ya no acepta calificar una evaluación con fecha futura (ck_calificacion_evaluacion_futura) ni pasar a una fecha futura una evaluación con calificaciones vigentes (ck_evaluacion_futura_calificaciones_vigentes); sin ellas, el cambio pasa' }],
  }, async (t) => {
    const { futureDate, futureEvaluation, evaluationId, enrollmentId } = t.data;
    if (!futureDate || futureDate <= t.today) return t.warn('No queda una fecha futura en el ciclo: no se comprobó');
    await rejects(t, 'calificar una evaluación con fecha futura', scoreSql(futureEvaluation, enrollmentId), 'ck_calificacion_evaluacion_futura');
    const moveToFuture = { sql: `UPDATE evaluacion SET fecha_evaluacion = $2 WHERE evaluacion_id = $1`, params: [evaluationId, futureDate] };
    await rejects(t, 'pasar a una fecha futura una evaluación calificada', moveToFuture, 'ck_evaluacion_futura_calificaciones_vigentes');
    await passes(t, 'pasar a una fecha futura después de dar de baja sus calificaciones', [
      { sql: `UPDATE calificacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1 AND fecha_eliminacion IS NULL`, params: [evaluationId] },
      moveToFuture,
    ]);
  });

  test('score-deleted-frozen', 'Una calificación dada de baja no se modifica ni se restaura', async (t) => {
    const { scoreId } = t.data;
    const markAsDeleted = { sql: `UPDATE calificacion SET fecha_eliminacion = now() WHERE calificacion_id = $1`, params: [scoreId] };
    const changes = [
      ['cambiar la nota', `UPDATE calificacion SET nota = 9 WHERE calificacion_id = $1`],
      ['restaurarla', `UPDATE calificacion SET fecha_eliminacion = NULL WHERE calificacion_id = $1`],
      ['cambiar la fecha de baja', `UPDATE calificacion SET fecha_eliminacion = now() - interval '1 day' WHERE calificacion_id = $1`],
    ];
    for (const [label, sql] of changes) {
      await rejects(t, label, [markAsDeleted, { sql, params: [scoreId] }], 'ck_calificacion_vigente');
    }
  });

  test('score-deleted-evaluation', 'En una evaluación dada de baja no se carga una nota, y las que tenía ya se dieron de baja con ella', {
    history: [{ plan: 'plans/profesor-evaluaciones/00-base-de-datos-y-backend.md', date: '2026-10-26', change: 'Después de la baja de la evaluación, corregir scoreId o darla de baja ya no se rechaza con ck_calificacion_evaluacion_vigente ni pasa: los dos se rechazan con ck_calificacion_vigente, porque la baja en cascada ya la dio de baja; cargar una nota sigue rechazándose con ck_calificacion_evaluacion_vigente' }],
  }, async (t) => {
    const { evaluationId, enrollmentId, scoreId } = t.data;
    const deleteEvaluation = { sql: `UPDATE evaluacion SET fecha_eliminacion = now() WHERE evaluacion_id = $1`, params: [evaluationId] };
    await rejects(t, 'cargar una nota', [deleteEvaluation, scoreSql(evaluationId, enrollmentId)], 'ck_calificacion_evaluacion_vigente');
    await rejects(t, 'corregir una nota', [
      deleteEvaluation,
      { sql: `UPDATE calificacion SET nota = 9 WHERE calificacion_id = $1`, params: [scoreId] },
    ], 'ck_calificacion_vigente');
    await rejects(t, 'dar de baja la nota de una inscripción activa', [
      deleteEvaluation,
      { sql: `UPDATE calificacion SET fecha_eliminacion = now() WHERE calificacion_id = $1`, params: [scoreId] },
    ], 'ck_calificacion_vigente');
  });
});
