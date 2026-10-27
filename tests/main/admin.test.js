// Capa main: casos de uso del Administrador por la API del preload (usuarios, cursos, asignaciones
// docentes e indicadores del inicio). Inicia sesión con el administrador del seed (solo lo lee) y
// opera sobre datos propios; cada resultado se comprueba con una consulta independiente.
const { group, test } = require('../lib/framework');
const { SEED_INSTITUTIONS } = require('../lib/fixtures');
const { LEVEL, SHIFT, sortedIds, sortedNumbers } = require('../lib/domain');
const { PATHS } = require('../config');

const bcrypt = require(require.resolve('bcrypt', { paths: [PATHS.root] }));
const SM = SEED_INSTITUTIONS.SM;

const userData = (overrides) => ({
  firstName: 'Nuevo', lastName: 'Usuario', dni: '', email: '', birthDate: '1985-03-15',
  password: 'Alta#Usuario2026x', image: null, removeImage: false, ...overrides,
});

group('main.admin.users', 'Administrador: usuarios', {
  async setup({ fixtures }) {
    const deletedSecretary = await fixtures.createUser({ role: 'SECRETARIO', deleted: true });
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const secretary = await fixtures.createUser({ role: 'SECRETARIO' });
    const assignedTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const course = await fixtures.createCourse();
    await fixtures.assign({ teacherId: assignedTeacher.id, courseId: course.id });
    const closedTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const closedAssignment = await fixtures.inSchoolYear(fixtures.year - 1, async () =>
      fixtures.assign({ teacherId: closedTeacher.id, courseId: (await fixtures.createCourse()).id }));
    return { deletedSecretary, teacher, secretary, assignedTeacher, closedTeacher, closedAssignment, adminId: await fixtures.seedUserId('admin') };
  },
}, () => {
  test('list', 'El listado trae a los demás usuarios de la institución, vigentes y dados de baja', async (t) => {
    await t.login('admin');
    const { users } = await t.ok('users.list');
    const expected = await t.sql(`
      SELECT usuario_id AS id, fecha_eliminacion IS NOT NULL AS deleted FROM usuario
       WHERE institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1) AND usuario_id <> $2`, [SM, t.data.adminId]);
    t.equal(sortedIds(users), sortedNumbers(expected), 'Los ids del listado son los de la institución, sin el de la sesión');
    const deleted = new Set(expected.filter((row) => row.deleted).map((row) => row.id));
    t.check(users.every((user) => Boolean(user.deletedAt) === deleted.has(user.id)), 'deletedAt coincide con la baja de cada usuario');
    await t.logout();
  });

  test('create', 'El alta crea un usuario activo con el rol elegido y solo el hash de la contraseña', async (t) => {
    await t.login('admin');
    const data = userData({ lastName: 'Creado', dni: '93000001', email: 'alta.usuario@prueba.edu.ar', role: 'PROFESOR' });
    const { user } = await t.ok('users.create', data);
    const row = await t.sqlOne(`
      SELECT u.usuario_id, u.estado, u.fecha_eliminacion, r.nombre AS rol, u.password_hash, u.dni, u.email,
             to_char(u.fecha_nacimiento, 'YYYY-MM-DD') AS nacimiento, u.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $2) AS en_institucion
        FROM usuario u JOIN usuario_rol r USING (usuario_rol_id) WHERE u.email = $1`, [data.email, SM]);
    t.require(row, 'El usuario no quedó en la base');
    t.equal(user?.id, row.usuario_id, 'La respuesta trae el id del usuario creado');
    t.equal({ estado: row.estado, baja: row.fecha_eliminacion, rol: row.rol, dni: row.dni, nacimiento: row.nacimiento, enInstitucion: row.en_institucion },
      { estado: true, baja: null, rol: 'PROFESOR', dni: data.dni, nacimiento: data.birthDate, enInstitucion: true }, 'Datos guardados');
    t.check(await bcrypt.compare(data.password, row.password_hash), 'La base guarda el hash de la contraseña elegida');
    await t.logout();
  });

  test('create-rejections', 'El alta rechaza un dni repetido y propone restaurar a un dado de baja, sin crear nada', async (t) => {
    await t.login('admin');
    const before = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM usuario`);
    const duplicate = await t.rejects('DUPLICATE_VALUE', 'users.create', userData({ dni: t.data.teacher.dni, email: 'otro.email@prueba.edu.ar', role: 'PROFESOR' }));
    t.check(duplicate?.error?.fieldErrors?.dni, 'El duplicado marca el dni', duplicate);
    await t.rejects('DELETED_USER_EXISTS', 'users.create', userData({ dni: t.data.deletedSecretary.dni, email: 'otro.mas@prueba.edu.ar', role: 'SECRETARIO' }));
    await t.rejects('INVALID_INPUT', 'users.create', userData({ dni: '93000002', email: 'sin.clave@prueba.edu.ar', role: 'PROFESOR', password: 'corta' }));
    t.equal(await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM usuario`), before, 'No se creó ningún usuario');
    await t.logout();
  });

  test('suspend', 'Suspender a un usuario lo deja en el listado y le impide iniciar sesión', async (t) => {
    await t.login('admin');
    const user = t.data.teacher;
    const data = userData({ firstName: user.firstName, lastName: user.lastName, dni: user.dni, email: user.email, birthDate: user.birthDate, password: null, isActive: false });
    await t.ok('users.update', user.id, data);
    t.equal(await t.sqlOne(`SELECT estado, fecha_eliminacion FROM usuario WHERE usuario_id = $1`, [user.id]), { estado: false, fecha_eliminacion: null }, 'Quedó suspendido y vigente');
    await t.logout();
    await t.rejects('INACTIVE_USER', 'auth.login', user.email, user.password, false);
  });

  test('delete-restore', 'La baja lógica deja al usuario suspendido entre los eliminados; la restauración lo vuelve a habilitar', async (t) => {
    await t.login('admin');
    const user = t.data.secretary;
    const deleted = await t.ok('users.delete', user.id);
    t.check(deleted.user?.deletedAt, 'La respuesta trae la fecha de baja', deleted);
    t.equal(await t.sqlOne(`SELECT estado, fecha_eliminacion IS NOT NULL AS baja FROM usuario WHERE usuario_id = $1`, [user.id]), { estado: false, baja: true }, 'Dado de baja y suspendido');
    await t.rejects('USER_ALREADY_DELETED', 'users.delete', user.id);
    await t.ok('users.restore', user.id);
    t.equal(await t.sqlOne(`SELECT estado, fecha_eliminacion FROM usuario WHERE usuario_id = $1`, [user.id]), { estado: true, fecha_eliminacion: null }, 'Restaurado y activo');
    await t.rejects('USER_NOT_DELETED', 'users.restore', user.id);
    await t.logout();
    await t.login(user);
    await t.logout();
  });

  test('delete-teacher-with-assignments', 'Un profesor con asignaciones vigentes del ciclo actual no se da de baja', async (t) => {
    await t.login('admin');
    await t.rejects('USER_HAS_TEACHER_ASSIGNMENTS', 'users.delete', t.data.assignedTeacher.id);
    t.equal(await t.sqlOne(`SELECT fecha_eliminacion FROM usuario WHERE usuario_id = $1`, [t.data.assignedTeacher.id]), { fecha_eliminacion: null }, 'Sigue vigente');
    await t.logout();
  });

  test('delete-teacher-closed-school-year', 'Un profesor con asignaciones vigentes solo de un ciclo cerrado se da de baja, y ellas siguen vigentes a su nombre', async (t) => {
    const { closedTeacher, closedAssignment } = t.data;
    await t.login('admin');
    await t.ok('users.delete', closedTeacher.id);
    t.equal(await t.sqlOne(`SELECT estado, fecha_eliminacion IS NOT NULL AS baja FROM usuario WHERE usuario_id = $1`, [closedTeacher.id]), { estado: false, baja: true }, 'Dado de baja y suspendido');
    t.equal(await t.sqlOne(`SELECT usuario_id, fecha_eliminacion FROM asignacion_docente WHERE asignacion_docente_id = $1`, [closedAssignment.id]),
      { usuario_id: closedTeacher.id, fecha_eliminacion: null }, 'La asignación del ciclo cerrado sigue vigente a su nombre');
    await t.logout();
  });
});

group('main.admin.courses', 'Administrador: cursos y catálogo de grados', {
  async setup({ fixtures }) {
    const course = await fixtures.createCourse();
    const assignedCourse = await fixtures.createCourse();
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    await fixtures.assign({ teacherId: teacher.id, courseId: assignedCourse.id });
    const otherInstitution = await fixtures.createInstitution();
    const foreignCourse = await fixtures.createCourse({ institutionId: otherInstitution.id });
    // Un curso con la inscripción activa de un alumno nuevo y otro con una sola inscripción, dada de
    // baja
    const enrolledCourse = await fixtures.createCourse();
    await fixtures.enroll({ studentId: (await fixtures.createStudent()).id, courseId: enrolledCourse.id });
    const deletedEnrollmentCourse = await fixtures.createCourse();
    await fixtures.enroll({ studentId: (await fixtures.createStudent()).id, courseId: deletedEnrollmentCourse.id, deleted: true });
    return { course, assignedCourse, foreignCourse, enrolledCourse, deletedEnrollmentCourse };
  },
}, () => {
  // Datos válidos para editar un curso de fixtures.createCourse: su grado y su turno, con otra
  // división libre
  const otherDivisionData = async (t, course) => ({
    gradeId: course.gradeId,
    division: await t.fixtures.freeDivision(course.institutionId, course.gradeId, course.shift, t.year),
    shift: SHIFT[course.shift],
  });
  const courseRow = (t, course) => t.sqlOne(`SELECT grado_id, division, turno, fecha_eliminacion FROM curso WHERE curso_id = $1`, [course.id]);

  test('grades', 'El catálogo de grados es el de la base', async (t) => {
    await t.login('admin');
    const { grades } = await t.ok('grades.list');
    const rows = await t.sql(`SELECT grado_id AS id, nombre, nivel_educativo FROM grado`);
    t.equal(
      grades.map((grade) => `${grade.id}|${grade.name}|${grade.educationLevel}`).sort(),
      rows.map((row) => `${row.id}|${row.nombre}|${LEVEL[row.nivel_educativo]}`).sort(),
      'grades.list coincide con la tabla grado'
    );
    await t.logout();
  });

  test('list', 'El listado trae los cursos vigentes de la institución, de todos los ciclos', async (t) => {
    await t.login('admin');
    const { courses } = await t.ok('courses.list');
    const expected = await t.sql(`
      SELECT curso_id AS id FROM curso WHERE fecha_eliminacion IS NULL
         AND institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM]);
    t.equal(sortedIds(courses), sortedNumbers(expected), 'Los ids del listado son los cursos vigentes de la institución');
    await t.logout();
  });

  test('list-in-use', 'Cada curso del listado informa si tiene asignaciones docentes vigentes y si tiene inscripciones vigentes', async (t) => {
    const { assignedCourse, enrolledCourse, deletedEnrollmentCourse, course } = t.data;
    await t.login('admin');
    const { courses } = await t.ok('courses.list');
    const expected = await t.sql(`
      SELECT c.curso_id AS id,
             EXISTS (SELECT 1 FROM asignacion_docente a WHERE a.curso_id = c.curso_id AND a.fecha_eliminacion IS NULL) AS "hasTeacherAssignments",
             EXISTS (SELECT 1 FROM inscripcion i WHERE i.curso_id = c.curso_id AND i.fecha_eliminacion IS NULL) AS "hasEnrollments"
        FROM curso c
       WHERE c.fecha_eliminacion IS NULL AND c.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)
       ORDER BY c.curso_id`, [SM]);
    const listed = (courses ?? [])
      .map(({ id, hasTeacherAssignments, hasEnrollments }) => ({ id, hasTeacherAssignments, hasEnrollments }))
      .sort((a, b) => a.id - b.id);
    t.equal(listed, expected, 'hasTeacherAssignments y hasEnrollments coinciden con las asignaciones y las inscripciones vigentes de cada curso');
    const flags = (target) => {
      const listedCourse = courses?.find((candidate) => candidate.id === target.id);
      return { hasTeacherAssignments: listedCourse?.hasTeacherAssignments, hasEnrollments: listedCourse?.hasEnrollments };
    };
    t.equal(flags(assignedCourse), { hasTeacherAssignments: true, hasEnrollments: false }, 'El curso con una asignación vigente');
    t.equal(flags(enrolledCourse), { hasTeacherAssignments: false, hasEnrollments: true }, 'El curso con una inscripción activa');
    t.equal(flags(deletedEnrollmentCourse), { hasTeacherAssignments: false, hasEnrollments: false }, 'El curso con una sola inscripción, dada de baja');
    t.equal(flags(course), { hasTeacherAssignments: false, hasEnrollments: false }, 'El curso sin asignaciones ni inscripciones');
    await t.logout();
  });

  test('create-update-delete', 'Alta en el ciclo actual, edición y baja lógica de un curso', async (t) => {
    await t.login('admin');
    const gradeId = await t.fixtures.gradeId('SECUNDARIA', '3°');
    const institutionId = await t.fixtures.institutionId(SM);
    const division = await t.fixtures.freeDivision(institutionId, gradeId, 'MAÑANA', t.year);
    const { course } = await t.ok('courses.create', { gradeId, division, shift: 'MORNING' });
    const row = await t.sqlOne(`SELECT grado_id, division, turno, anio_ciclo_lectivo, institucion_id FROM curso WHERE curso_id = $1`, [course?.id]);
    t.equal(row, { grado_id: gradeId, division, turno: 'MAÑANA', anio_ciclo_lectivo: t.year, institucion_id: institutionId }, 'El curso quedó en el ciclo actual');
    await t.rejects('DUPLICATE_VALUE', 'courses.create', { gradeId, division, shift: 'MORNING' });

    const newDivision = await t.fixtures.freeDivision(institutionId, gradeId, 'TARDE', t.year);
    await t.ok('courses.update', course.id, { gradeId, division: newDivision, shift: 'AFTERNOON' });
    t.equal(await t.sqlOne(`SELECT division, turno FROM curso WHERE curso_id = $1`, [course.id]), { division: newDivision, turno: 'TARDE' }, 'La edición se guardó');

    await t.ok('courses.delete', course.id);
    t.equal(await t.sqlOne(`SELECT fecha_eliminacion IS NOT NULL AS baja FROM curso WHERE curso_id = $1`, [course.id]), { baja: true }, 'Quedó dado de baja');
    await t.rejects('COURSE_ALREADY_DELETED', 'courses.delete', course.id);
    await t.rejects('COURSE_NOT_FOUND', 'courses.delete', t.data.foreignCourse.id);
    await t.logout();
  });

  test('delete-with-assignments', 'Un curso con asignaciones docentes vigentes no se edita ni se da de baja', {
    history: [{ plan: 'plans/administrador-cursos/00-base-de-datos-y-backend.md', date: '2026-10-27', change: 'La baja de un curso con asignaciones docentes vigentes ya no pasa: la baja y la edición esperan COURSE_IN_USE y la fila no cambia (pasa de current a estable)' }],
  }, async (t) => {
    const { assignedCourse } = t.data;
    await t.login('admin');
    const before = await courseRow(t, assignedCourse);
    await t.rejects('COURSE_IN_USE', 'courses.delete', assignedCourse.id);
    await t.rejects('COURSE_IN_USE', 'courses.update', assignedCourse.id, await otherDivisionData(t, assignedCourse));
    t.equal(await courseRow(t, assignedCourse), before, 'El curso no cambió');
    await t.logout();
  });

  test('in-use-enrollments', 'Un curso con inscripciones vigentes no se edita ni se da de baja; las dadas de baja no lo impiden', async (t) => {
    const { enrolledCourse, deletedEnrollmentCourse } = t.data;
    await t.login('admin');
    const before = await courseRow(t, enrolledCourse);
    await t.rejects('COURSE_IN_USE', 'courses.update', enrolledCourse.id, await otherDivisionData(t, enrolledCourse));
    await t.rejects('COURSE_IN_USE', 'courses.delete', enrolledCourse.id);
    t.equal(await courseRow(t, enrolledCourse), before, 'El curso con una inscripción activa no cambió');

    const data = await otherDivisionData(t, deletedEnrollmentCourse);
    await t.ok('courses.update', deletedEnrollmentCourse.id, data);
    t.equal(await t.sqlOne(`SELECT division FROM curso WHERE curso_id = $1`, [deletedEnrollmentCourse.id]), { division: data.division },
      'La edición del curso con una sola inscripción, dada de baja, se guardó');
    await t.ok('courses.delete', deletedEnrollmentCourse.id);
    t.equal(await t.sqlOne(`SELECT fecha_eliminacion IS NOT NULL AS baja FROM curso WHERE curso_id = $1`, [deletedEnrollmentCourse.id]), { baja: true },
      'Quedó dado de baja');
    await t.logout();
  });
});

group('main.admin.assignments', 'Administrador: asignaciones docentes', {
  async setup({ fixtures }) {
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const otherTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const suspendedTeacher = await fixtures.createUser({ role: 'PROFESOR', active: false });
    const course = await fixtures.createCourse();
    const evaluatedCourse = await fixtures.createCourse();
    const evaluated = await fixtures.assign({ teacherId: teacher.id, courseId: evaluatedCourse.id });
    const evaluatedEvaluationId = await fixtures.createEvaluation({ assignmentId: evaluated.id });
    const keptTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const keptAssignment = await fixtures.assign({ teacherId: keptTeacher.id, courseId: evaluatedCourse.id });
    // Un curso del ciclo actual sin asignaciones, del mismo grado que los demás, y una asignación con
    // una calificación vigente en su evaluación
    const freeCourse = await fixtures.createCourse();
    const scored = await fixtures.teacherScenario();
    await fixtures.score({ evaluationId: scored.evaluationId, enrollmentId: scored.enrollmentId });
    // Un curso del ciclo actual sin asignaciones, que una prueba da de baja mientras se le crea una
    // asignación
    const deletableCourse = await fixtures.createCourse();
    return { teacher, otherTeacher, suspendedTeacher, course, evaluated, evaluatedEvaluationId, keptTeacher, keptAssignment,
      freeCourse, scored, deletableCourse };
  },
}, () => {
  test('list', 'El listado trae las asignaciones vigentes de la institución', async (t) => {
    await t.login('admin');
    const { teacherAssignments } = await t.ok('teacherAssignments.list');
    const expected = await t.sql(`
      SELECT a.asignacion_docente_id AS id FROM asignacion_docente a JOIN curso c USING (curso_id)
       WHERE a.fecha_eliminacion IS NULL AND c.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM]);
    t.equal(sortedIds(teacherAssignments), sortedNumbers(expected), 'Los ids del listado son las asignaciones vigentes');
    await t.logout();
  });

  test('list-has-evaluations', 'Cada asignación del listado informa si tiene evaluaciones vigentes', async (t) => {
    await t.login('admin');
    const { teacherAssignments } = await t.ok('teacherAssignments.list');
    const expected = await t.sql(`
      SELECT a.asignacion_docente_id AS id,
             EXISTS (SELECT 1 FROM evaluacion e WHERE e.asignacion_docente_id = a.asignacion_docente_id AND e.fecha_eliminacion IS NULL) AS "hasEvaluations"
        FROM asignacion_docente a JOIN curso c USING (curso_id)
       WHERE a.fecha_eliminacion IS NULL AND c.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)
       ORDER BY a.asignacion_docente_id`, [SM]);
    const listed = (teacherAssignments ?? [])
      .map(({ id, hasEvaluations }) => ({ id, hasEvaluations }))
      .sort((a, b) => a.id - b.id);
    t.equal(listed, expected, 'hasEvaluations coincide con las evaluaciones vigentes de cada asignación');
    const evaluated = teacherAssignments?.find((teacherAssignment) => teacherAssignment.id === t.data.evaluated.id);
    t.equal(evaluated?.hasEvaluations, true, 'La asignación con una evaluación vigente trae hasEvaluations en true');
    await t.logout();
  });

  test('form-options', 'El alta ofrece los profesores activos, los cursos vigentes del ciclo actual y las materias sin profesor del curso', async (t) => {
    await t.login('admin');
    const { teachers } = await t.ok('teacherAssignments.listAssignableTeachers');
    const expectedTeachers = await t.sql(`
      SELECT u.usuario_id AS id FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
       WHERE r.nombre = 'PROFESOR' AND u.estado AND u.fecha_eliminacion IS NULL
         AND u.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM]);
    t.equal(sortedIds(teachers), sortedNumbers(expectedTeachers), 'Profesores asignables');
    const { courses } = await t.ok('teacherAssignments.listAssignableCourses');
    const expectedCourses = await t.sql(`
      SELECT curso_id AS id FROM curso WHERE fecha_eliminacion IS NULL AND anio_ciclo_lectivo = $2
         AND institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM, t.year]);
    t.equal(sortedIds(courses), sortedNumbers(expectedCourses), 'Cursos asignables');
    const { subjects } = await t.ok('teacherAssignments.listAssignableSubjects', t.data.evaluated.courseId);
    const expectedSubjects = await t.sql(`
      SELECT gm.materia_id AS id FROM grado_materia gm JOIN curso c ON c.grado_id = gm.grado_id
       WHERE c.curso_id = $1 AND NOT EXISTS (SELECT 1 FROM asignacion_docente a WHERE a.curso_id = c.curso_id
             AND a.grado_materia_id = gm.grado_materia_id AND a.fecha_eliminacion IS NULL)`, [t.data.evaluated.courseId]);
    t.equal(sortedIds(subjects), sortedNumbers(expectedSubjects), 'Materias sin profesor del curso');
    await t.logout();
  });

  test('create-update-delete', 'Alta, cambio de profesor y baja lógica de una asignación', async (t) => {
    await t.login('admin');
    const { teacher, otherTeacher, course } = t.data;
    const [subject] = (await t.ok('teacherAssignments.listAssignableSubjects', course.id)).subjects;
    const { teacherAssignment } = await t.ok('teacherAssignments.create', { teacherId: teacher.id, courseId: course.id, subjectId: subject.id });
    const row = () => t.sqlOne(`
      SELECT a.usuario_id, a.curso_id, gm.materia_id, a.fecha_eliminacion IS NOT NULL AS baja
        FROM asignacion_docente a JOIN grado_materia gm USING (grado_materia_id) WHERE a.asignacion_docente_id = $1`, [teacherAssignment?.id]);
    t.equal(await row(), { usuario_id: teacher.id, curso_id: course.id, materia_id: subject.id, baja: false }, 'La asignación quedó en la base');
    const after = (await t.ok('teacherAssignments.listAssignableSubjects', course.id)).subjects;
    t.check(!after.some((candidate) => candidate.id === subject.id), 'La materia asignada ya no se ofrece');
    const duplicate = await t.rejects('DUPLICATE_VALUE', 'teacherAssignments.create', { teacherId: otherTeacher.id, courseId: course.id, subjectId: subject.id });
    t.check(duplicate?.error?.fieldErrors?.subject, 'El duplicado marca la materia', duplicate);

    await t.ok('teacherAssignments.update', teacherAssignment.id, { teacherId: otherTeacher.id, courseId: course.id, subjectId: subject.id });
    t.equal((await row()).usuario_id, otherTeacher.id, 'El cambio de profesor se guardó');

    await t.ok('teacherAssignments.delete', teacherAssignment.id);
    t.equal((await row()).baja, true, 'Quedó dada de baja');
    await t.rejects('TEACHER_ASSIGNMENT_ALREADY_DELETED', 'teacherAssignments.delete', teacherAssignment.id);
    await t.logout();
  });

  test('create-unavailable-teacher', 'Un profesor suspendido no recibe una asignación nueva', async (t) => {
    await t.login('admin');
    const { course, suspendedTeacher } = t.data;
    const [subject] = (await t.ok('teacherAssignments.listAssignableSubjects', course.id)).subjects;
    await t.rejects('TEACHER_NOT_AVAILABLE', 'teacherAssignments.create', { teacherId: suspendedTeacher.id, courseId: course.id, subjectId: subject.id });
    await t.logout();
  });

  test('create-deleted-course', 'Si el curso se da de baja mientras se crea la asignación, el alta responde COURSE_NOT_AVAILABLE y no guarda nada', async (t) => {
    const { teacher, deletableCourse } = t.data;
    await t.login('admin');
    const [subject] = (await t.ok('teacherAssignments.listAssignableSubjects', deletableCourse.id)).subjects;
    // El INSERT se demora después de las comprobaciones del servicio; mientras tanto, otra sesión da
    // de baja el curso y confirma
    const fault = t.injectFault({ match: /INSERT INTO asignacion_docente/i, action: 'delay', ms: 600 });
    const rejection = t.rejects('COURSE_NOT_AVAILABLE', 'teacherAssignments.create', { teacherId: teacher.id, courseId: deletableCourse.id, subjectId: subject?.id });
    const deadline = Date.now() + 5000;
    while (fault.hits < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    t.check(fault.hits === 1, 'El alta no llegó al INSERT de la asignación', { hits: fault.hits });
    await t.sql(`UPDATE curso SET fecha_eliminacion = now() WHERE curso_id = $1`, [deletableCourse.id]);
    await rejection;
    const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM asignacion_docente WHERE curso_id = $1`, [deletableCourse.id]);
    t.equal(count, 0, 'El curso dado de baja quedó sin asignaciones');
    await t.logout();
  });

  test('update-keeps-suspended-teacher', 'La edición no conserva al profesor de la asignación si está suspendido: hay que reemplazarlo por uno activo', {
    history: [{ plan: 'plans/administrador-usuarios.md', date: '2026-10-26', change: 'Conservar a un profesor suspendido ya no se acepta: ahora espera TEACHER_NOT_AVAILABLE sin cambiar la fila, y reemplazarlo por otro activo se guarda' }],
  }, async (t) => {
    const { keptTeacher, keptAssignment, otherTeacher } = t.data;
    await t.db.query(`UPDATE usuario SET estado = false WHERE usuario_id = $1`, [keptTeacher.id]);
    await t.login('admin');
    const data = (teacherId) => ({ teacherId, courseId: keptAssignment.courseId, subjectId: keptAssignment.subjectId });
    const row = () => t.sqlOne(`
      SELECT usuario_id, curso_id, grado_materia_id, fecha_eliminacion FROM asignacion_docente WHERE asignacion_docente_id = $1`, [keptAssignment.id]);
    const before = await row();
    await t.rejects('TEACHER_NOT_AVAILABLE', 'teacherAssignments.update', keptAssignment.id, data(keptTeacher.id));
    t.equal(await row(), before, 'La asignación no cambió');
    await t.ok('teacherAssignments.update', keptAssignment.id, data(otherTeacher.id));
    t.equal(await row(), { ...before, usuario_id: otherTeacher.id }, 'La asignación quedó con el profesor activo, con su curso y su materia');
    await t.logout();
  });

  test('delete-with-evaluations', 'Una asignación con evaluaciones vigentes no se da de baja', {
    history: [{ plan: 'plans/administrador-docencia/00-base-de-datos-y-backend.md', date: '2026-10-27', change: 'La baja de una asignación con evaluaciones vigentes ya no pasa: ahora espera TEACHER_ASSIGNMENT_HAS_EVALUATIONS y la asignación sigue vigente (pasa de current a estable)' }],
  }, async (t) => {
    const { evaluated } = t.data;
    await t.login('admin');
    await t.rejects('TEACHER_ASSIGNMENT_HAS_EVALUATIONS', 'teacherAssignments.delete', evaluated.id);
    t.equal(await t.sqlOne(`SELECT fecha_eliminacion IS NULL AS vigente FROM asignacion_docente WHERE asignacion_docente_id = $1`, [evaluated.id]),
      { vigente: true }, 'La asignación sigue vigente');
    await t.logout();
  });

  test('update-with-evaluations', 'Una asignación con evaluaciones vigentes no cambia de curso ni de materia; sí de profesor, que hereda sus evaluaciones', async (t) => {
    const { evaluated, evaluatedEvaluationId, scored, freeCourse, otherTeacher } = t.data;
    await t.login('admin');
    const row = (teacherAssignmentId) => t.sqlOne(`
      SELECT usuario_id, curso_id, grado_materia_id, fecha_eliminacion FROM asignacion_docente WHERE asignacion_docente_id = $1`, [teacherAssignmentId]);
    const before = { evaluated: await row(evaluated.id), scored: await row(scored.assignment.id) };
    const data = (assignment, changes) => ({ teacherId: assignment.teacherId, courseId: assignment.courseId, subjectId: assignment.subjectId, ...changes });

    const { subjects } = await t.ok('teacherAssignments.listAssignableSubjects', evaluated.courseId, evaluated.id);
    const otherSubject = subjects?.find((subject) => subject.id !== evaluated.subjectId);
    t.check(otherSubject, 'El curso de la asignación ofrece otra materia', subjects);
    await t.rejects('TEACHER_ASSIGNMENT_HAS_EVALUATIONS', 'teacherAssignments.update', evaluated.id, data(evaluated, { subjectId: otherSubject?.id }));
    await t.rejects('TEACHER_ASSIGNMENT_HAS_EVALUATIONS', 'teacherAssignments.update', evaluated.id, data(evaluated, { courseId: freeCourse.id }));
    // Con calificaciones vigentes, el cambio de curso lo rechaza antes
    // ck_asignacion_docente_calificaciones_vigentes, con el mismo código
    await t.rejects('TEACHER_ASSIGNMENT_HAS_EVALUATIONS', 'teacherAssignments.update', scored.assignment.id, data(scored.assignment, { courseId: freeCourse.id }));
    t.equal(await row(evaluated.id), before.evaluated, 'La asignación con evaluaciones no cambió');
    t.equal(await row(scored.assignment.id), before.scored, 'La asignación con calificaciones no cambió');

    const { teacherAssignment } = await t.ok('teacherAssignments.update', evaluated.id, data(evaluated, { teacherId: otherTeacher.id }));
    t.equal(teacherAssignment?.hasEvaluations, true, 'La respuesta trae hasEvaluations en true');
    t.equal(await row(evaluated.id), { ...before.evaluated, usuario_id: otherTeacher.id }, 'El cambio de profesor se guardó, con el curso y la materia');
    await t.logout();

    await t.login(otherTeacher);
    const { evaluations } = await t.ok('evaluations.listByOwnAssignment', evaluated.id);
    t.check(evaluations?.some((evaluation) => evaluation.id === evaluatedEvaluationId), 'El profesor nuevo ve la evaluación de la asignación', evaluations);
    await t.logout();
  });
});

group('main.admin.dashboard', 'Administrador: indicadores del inicio', () => {
  test('summary', 'Los indicadores coinciden con conteos independientes de la base', async (t) => {
    await t.login('admin');
    const { summary } = await t.ok('dashboard.getAdminSummary');
    const expected = await t.sqlOne(`
      WITH i AS (SELECT institucion_id FROM institucion WHERE cuit = $1)
      SELECT (SELECT COUNT(*) FROM usuario WHERE institucion_id IN (SELECT institucion_id FROM i) AND fecha_eliminacion IS NULL)::INT AS "userCount",
             (SELECT COUNT(*) FROM curso WHERE institucion_id IN (SELECT institucion_id FROM i) AND fecha_eliminacion IS NULL)::INT AS "courseCount",
             (SELECT COUNT(*) FROM asignacion_docente WHERE fecha_eliminacion IS NULL
                AND curso_id IN (SELECT curso_id FROM curso WHERE institucion_id IN (SELECT institucion_id FROM i) AND fecha_eliminacion IS NULL))::INT AS "teacherAssignmentCount",
             (SELECT COUNT(DISTINCT usuario_id) FROM asignacion_docente WHERE fecha_eliminacion IS NULL
                AND curso_id IN (SELECT curso_id FROM curso WHERE institucion_id IN (SELECT institucion_id FROM i) AND fecha_eliminacion IS NULL))::INT AS "assignedTeacherCount"`, [SM]);
    t.equal(summary, expected, 'Indicadores del administrador');
    await t.logout();
  });
});
