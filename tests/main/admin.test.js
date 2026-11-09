// Capa main: casos de uso del Administrador por la API del preload (usuarios, cursos, asignaciones
// docentes, indicadores del inicio y reportes). Inicia sesión con el administrador del seed (solo lo lee) y
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

// Reporte Materias sin docente por curso (plans/reportes-administrador/01-materias-sin-docente.md):
// solo los cursos incompletos del ciclo, con las materias del plan de su grado sin docente (sin
// asignación vigente o con el profesor dado de baja) y con un docente suspendido.
group('main.admin.reports.subject-coverage', 'Administrador: reporte Materias sin docente por curso', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId();
    const activeTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Activo' });
    const suspendedTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Suspendido' });
    // Del ciclo actual: una materia de un profesor activo, otra de uno que queda suspendido después
    // de asignarla y el resto sin asignar
    const partialCourse = await fixtures.createCourse({ level: 'SECUNDARIA', grade: '4°', shift: 'TARDE' });
    const activeAssignment = await fixtures.assign({ teacherId: activeTeacher.id, courseId: partialCourse.id });
    const suspendedAssignment = await fixtures.assign({ teacherId: suspendedTeacher.id, courseId: partialCourse.id });
    await fixtures.db.query(`UPDATE usuario SET estado = FALSE WHERE usuario_id = $1`, [suspendedTeacher.id]);
    // Del ciclo actual, con todas las materias de su plan a cargo del profesor activo
    const completeCourse = await fixtures.createCourse({ level: 'PRIMARIA', grade: '1°', shift: 'MAÑANA' });
    for (const subject of await fixtures.subjectsOfGrade(completeCourse.gradeId)) {
      await fixtures.assign({ teacherId: activeTeacher.id, courseId: completeCourse.id, subjectName: subject.name });
    }
    // De un ciclo cerrado, con una materia de un profesor que se da de baja después
    const closedTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const closed = await fixtures.inSchoolYear(fixtures.year - 1, async () => {
      const course = await fixtures.createCourse();
      return { course, assignment: await fixtures.assign({ teacherId: closedTeacher.id, courseId: course.id }) };
    });
    await fixtures.db.query(`UPDATE usuario SET estado = FALSE, fecha_eliminacion = now() WHERE usuario_id = $1`, [closedTeacher.id]);
    // Fuera del reporte: un curso dado de baja y uno de otra institución, los dos del ciclo actual
    const deletedCourse = await fixtures.createCourse({ deleted: true });
    const otherInstitution = await fixtures.createInstitution();
    const foreignCourse = await fixtures.createCourse({ institutionId: otherInstitution.id });
    return {
      institutionId, suspendedTeacher, partialCourse, activeAssignment, suspendedAssignment, completeCourse,
      closed, deletedCourse, foreignCourse,
    };
  },
}, () => {
  const filtersOf = (overrides) => ({ educationLevel: null, shift: null, ...overrides });

  const isIncomplete = (course) => course.unassigned.length > 0 || course.suspended.length > 0;

  // Lo esperado de cada curso incompleto de la institución en el ciclo `year`, con subconsultas por
  // materia (distinto de la consulta agrupada del repositorio). Sin docente: sin asignación vigente
  // o con el profesor dado de baja; con docente suspendido: "Materia (Nombre Apellido)". Con
  // `{ all: true }`, también los cursos completos.
  const expectedCourses = async (t, year, { all = false } = {}) => (await t.sql(`
    SELECT c.curso_id AS id, g.nivel_educativo, c.turno,
           (SELECT COUNT(*) FROM grado_materia gm WHERE gm.grado_id = c.grado_id)::INT AS "subjectCount",
           ARRAY(SELECT m.nombre FROM grado_materia gm JOIN materia m USING (materia_id)
                  WHERE gm.grado_id = c.grado_id
                    AND NOT EXISTS (SELECT 1 FROM asignacion_docente a JOIN usuario u USING (usuario_id)
                                     WHERE a.curso_id = c.curso_id AND a.grado_materia_id = gm.grado_materia_id
                                       AND a.fecha_eliminacion IS NULL AND u.fecha_eliminacion IS NULL)
                  ORDER BY m.nombre) AS unassigned,
           ARRAY(SELECT m.nombre || ' (' || u.nombre || ' ' || u.apellido || ')'
                   FROM asignacion_docente a JOIN usuario u USING (usuario_id)
                   JOIN grado_materia gm USING (grado_materia_id) JOIN materia m USING (materia_id)
                  WHERE a.curso_id = c.curso_id AND a.fecha_eliminacion IS NULL
                    AND u.fecha_eliminacion IS NULL AND NOT u.estado
                  ORDER BY m.nombre) AS suspended
      FROM curso c JOIN grado g USING (grado_id)
     WHERE c.institucion_id = $1 AND c.fecha_eliminacion IS NULL AND c.anio_ciclo_lectivo = $2
     ORDER BY c.curso_id`, [t.data.institutionId, year])).map((row) => ({
    id: row.id,
    educationLevel: LEVEL[row.nivel_educativo],
    shift: SHIFT[row.turno],
    subjectCount: row.subjectCount,
    assignedCount: row.subjectCount - row.unassigned.length,
    unassigned: row.unassigned,
    suspended: row.suspended,
  })).filter((course) => all || isIncomplete(course));

  // Las filas del reporte con la forma de expectedCourses, por id
  const shownCourses = (courses) => courses
    .map((course) => ({
      id: course.id,
      educationLevel: course.educationLevel,
      shift: course.shift,
      subjectCount: course.subjectCount,
      assignedCount: course.assignedCount,
      unassigned: course.unassignedSubjects,
      suspended: course.suspendedSubjects.map(({ subjectName, teacherName }) => `${subjectName} (${teacherName})`),
    }))
    .sort((a, b) => a.id - b.id);

  test('counts', 'Los conteos y las listas de cada curso incompleto del ciclo actual coinciden con una consulta propia', {
    history: [{ plan: 'Pedido del 2026-11-09: sin el interruptor "Solo cursos incompletos" (sin plan en plans/)', date: '2026-11-09', change: 'El reporte trae solo los cursos incompletos: la consulta propia deja afuera los completos' }],
  }, async (t) => {
    const { partialCourse, activeAssignment, suspendedAssignment, suspendedTeacher } = t.data;
    await t.login('admin');
    const { report } = await t.ok('reports.getSubjectCoverage', filtersOf({ schoolYear: t.year }));
    t.equal(report.schoolYear, t.year, 'El reporte es del ciclo pedido');
    t.equal(shownCourses(report.courses), await expectedCourses(t, t.year), 'Cursos, conteos y listas');

    const partial = report.courses.find((course) => course.id === partialCourse.id);
    t.require(partial, 'El curso con materias sin docente no está en el reporte', report.courses);
    t.equal({ gradeName: partial.gradeName, division: partial.division },
      { gradeName: partialCourse.grade, division: partialCourse.division }, 'Grado y división del curso');
    t.equal(partial.assignedCount, 2, 'Asignadas: la del profesor activo y la del suspendido');
    t.check(!partial.unassignedSubjects.includes(activeAssignment.name) && !partial.unassignedSubjects.includes(suspendedAssignment.name),
      'Sin docente no incluye a las materias asignadas', partial.unassignedSubjects);
    t.equal(partial.suspendedSubjects, [{ subjectName: suspendedAssignment.name, teacherName: `${suspendedTeacher.firstName} ${suspendedTeacher.lastName}` }],
      'Con docente suspendido: la materia y el nombre del profesor');
    await t.logout();
  });

  test('only-incomplete', 'Solo aparecen los cursos incompletos: el curso completo se excluye y el incompleto aparece', {
    history: [{ plan: 'Pedido del 2026-11-09: sin el interruptor "Solo cursos incompletos" (sin plan en plans/)', date: '2026-11-09', change: 'Sin onlyIncomplete: un único pedido trae solo los incompletos, sin el curso completo' }],
  }, async (t) => {
    const { partialCourse, completeCourse } = t.data;
    await t.login('admin');
    const { courses } = (await t.ok('reports.getSubjectCoverage', filtersOf({ schoolYear: t.year }))).report;
    const complete = (await expectedCourses(t, t.year, { all: true })).find((course) => course.id === completeCourse.id);
    t.require(complete, 'La consulta propia no tiene el curso completo', complete);
    t.equal({ unassigned: complete.unassigned, suspended: complete.suspended, assigned: complete.assignedCount === complete.subjectCount },
      { unassigned: [], suspended: [], assigned: true }, 'El curso completo tiene todas sus materias asignadas a profesores activos');
    t.check(!courses.some((course) => course.id === completeCourse.id), 'No aparece el curso completo');
    t.check(courses.some((course) => course.id === partialCourse.id), 'Aparece el curso incompleto');
    t.check(courses.every((course) => course.unassignedSubjects.length > 0 || course.suspendedSubjects.length > 0),
      'Cada curso del reporte tiene alguna materia sin docente o con un docente suspendido', courses);
    await t.logout();
  });

  test('closed-school-year-deleted-teacher', 'En un ciclo cerrado, la materia de un profesor dado de baja después cuenta como sin docente', {
    history: [{ plan: 'Pedido del 2026-11-09: sin el interruptor "Solo cursos incompletos" (sin plan en plans/)', date: '2026-11-09', change: 'El reporte trae solo los cursos incompletos del ciclo cerrado' }],
  }, async (t) => {
    const { closed } = t.data;
    await t.login('admin');
    const { report } = await t.ok('reports.getSubjectCoverage', filtersOf({ schoolYear: t.year - 1 }));
    t.equal(report.schoolYear, t.year - 1, 'El reporte es del ciclo pedido');
    t.equal(shownCourses(report.courses), await expectedCourses(t, t.year - 1), 'Cursos, conteos y listas del ciclo cerrado');
    const course = report.courses.find((row) => row.id === closed.course.id);
    t.require(course, 'El curso del ciclo cerrado no está en el reporte', report.courses);
    t.check(course.unassignedSubjects.includes(closed.assignment.name), 'La materia del profesor dado de baja está en Sin docente', course);
    t.equal({ assigned: course.assignedCount, suspended: course.suspendedSubjects },
      { assigned: course.subjectCount - course.unassignedSubjects.length, suspended: [] }, 'No cuenta como asignada ni como suspendida');
    await t.logout();
  });

  test('scope-and-filters', 'Fuera el curso dado de baja y los de otra institución; Nivel y Turno filtran; un año inválido es INVALID_INPUT', {
    history: [{ plan: 'Pedido del 2026-11-09: sin el interruptor "Solo cursos incompletos" (sin plan en plans/)', date: '2026-11-09', change: 'Nivel y Turno filtran los cursos incompletos; onlyIncomplete ya no existe ni se valida' }],
  }, async (t) => {
    const { deletedCourse, foreignCourse } = t.data;
    await t.login('admin');
    const ids = (courses) => courses.map((course) => course.id);
    const all = (await t.ok('reports.getSubjectCoverage', filtersOf({ schoolYear: t.year }))).report.courses;
    t.check(!ids(all).includes(deletedCourse.id), 'El curso dado de baja no aparece');
    t.check(!ids(all).includes(foreignCourse.id), 'El curso de otra institución no aparece');

    const expected = await expectedCourses(t, t.year);
    for (const educationLevel of ['PRIMARY', 'SECONDARY']) {
      const { courses } = (await t.ok('reports.getSubjectCoverage', filtersOf({ schoolYear: t.year, educationLevel }))).report;
      t.equal(shownCourses(courses), expected.filter((course) => course.educationLevel === educationLevel), `Nivel ${educationLevel}`);
    }
    for (const shift of ['MORNING', 'AFTERNOON']) {
      const { courses } = (await t.ok('reports.getSubjectCoverage', filtersOf({ schoolYear: t.year, shift }))).report;
      t.equal(shownCourses(courses), expected.filter((course) => course.shift === shift), `Turno ${shift}`);
    }
    const { courses: both } = (await t.ok('reports.getSubjectCoverage', filtersOf({ schoolYear: t.year, educationLevel: 'PRIMARY', shift: 'MORNING' }))).report;
    t.equal(shownCourses(both), expected.filter((course) => course.educationLevel === 'PRIMARY' && course.shift === 'MORNING'), 'Nivel y Turno combinados');

    for (const schoolYear of [1999, 2101, 2026.5, String(t.year), null]) {
      await t.rejects('INVALID_INPUT', 'reports.getSubjectCoverage', filtersOf({ schoolYear }));
    }
    await t.rejects('INVALID_INPUT', 'reports.getSubjectCoverage', filtersOf({ schoolYear: t.year, educationLevel: 'PRIMARIA' }));
    await t.rejects('INVALID_INPUT', 'reports.getSubjectCoverage', filtersOf({ schoolYear: t.year, shift: 'NIGHT' }));
    await t.rejects('INVALID_INPUT', 'reports.getSubjectCoverage', null);
    await t.logout();
  });
});

// Reporte Carga docente por profesor (plans/reportes-administrador/02-carga-docente.md): los
// profesores no dados de baja de la institución, activos y suspendidos, también sin asignaciones,
// con sus asignaciones vigentes de cursos vigentes del ciclo (con Nivel y Turno del curso) y el
// promedio de todos ellos.
group('main.admin.reports.teacher-workload', 'Administrador: reporte Carga docente por profesor', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId();
    const idleTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Libre' });
    // Dos materias del mismo curso de secundaria a la tarde y una de un curso de primaria a la
    // mañana: 3 asignaciones en 2 cursos. Una cuarta, dada de baja, no cuenta.
    const busyTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Ocupado' });
    const secondaryCourse = await fixtures.createCourse({ level: 'SECUNDARIA', grade: '4°', shift: 'TARDE' });
    await fixtures.assign({ teacherId: busyTeacher.id, courseId: secondaryCourse.id });
    await fixtures.assign({ teacherId: busyTeacher.id, courseId: secondaryCourse.id });
    const primaryCourse = await fixtures.createCourse({ level: 'PRIMARIA', grade: '1°', shift: 'MAÑANA' });
    await fixtures.assign({ teacherId: busyTeacher.id, courseId: primaryCourse.id });
    const deletedAssignment = await fixtures.assign({ teacherId: busyTeacher.id, courseId: (await fixtures.createCourse()).id });
    await fixtures.db.query(`UPDATE asignacion_docente SET fecha_eliminacion = now() WHERE asignacion_docente_id = $1`, [deletedAssignment.id]);
    // Uno que queda suspendido después de recibir una asignación
    const suspendedTeacher = await fixtures.createUser({ role: 'PROFESOR', firstName: 'Suspendido' });
    await fixtures.assign({ teacherId: suspendedTeacher.id, courseId: primaryCourse.id });
    await fixtures.db.query(`UPDATE usuario SET estado = FALSE WHERE usuario_id = $1`, [suspendedTeacher.id]);
    // Uno dado de baja y una asignación del ciclo cerrado del profesor ocupado
    const deletedTeacher = await fixtures.createUser({ role: 'PROFESOR', deleted: true });
    await fixtures.inSchoolYear(fixtures.year - 1, async () =>
      fixtures.assign({ teacherId: busyTeacher.id, courseId: (await fixtures.createCourse()).id }));
    // Otra institución, con un profesor con una asignación y su administrador, y una sin profesores
    const otherInstitution = await fixtures.createInstitution();
    const foreignTeacher = await fixtures.createUser({ role: 'PROFESOR', institutionId: otherInstitution.id });
    await fixtures.assign({ teacherId: foreignTeacher.id, courseId: (await fixtures.createCourse({ institutionId: otherInstitution.id })).id });
    const foreignAdmin = await fixtures.createUser({ role: 'ADMIN', institutionId: otherInstitution.id });
    const emptyAdmin = await fixtures.createUser({ role: 'ADMIN', institutionId: (await fixtures.createInstitution()).id });
    return { institutionId, idleTeacher, busyTeacher, suspendedTeacher, deletedTeacher, foreignTeacher, foreignAdmin, emptyAdmin };
  },
}, () => {
  const filtersOf = (overrides) => ({ educationLevel: null, shift: null, ...overrides });
  const COLUMN_LEVEL = Object.fromEntries(Object.entries(LEVEL).map(([column, code]) => [code, column]));
  const COLUMN_SHIFT = Object.fromEntries(Object.entries(SHIFT).map(([column, code]) => [code, column]));

  // Lo esperado de cada profesor no dado de baja de la institución, con subconsultas por profesor
  // (distinto del LEFT JOIN agrupado del repositorio), en el orden del reporte: cantidad, apellido,
  // nombre y usuario_id
  const expectedTeachers = async (t, { institutionId = t.data.institutionId, schoolYear, educationLevel = null, shift = null }) => {
    const assignments = `FROM asignacion_docente a JOIN curso c USING (curso_id) JOIN grado g USING (grado_id)
                         WHERE a.usuario_id = u.usuario_id AND a.fecha_eliminacion IS NULL AND c.fecha_eliminacion IS NULL
                           AND c.anio_ciclo_lectivo = $2
                           AND ($3::TEXT IS NULL OR g.nivel_educativo = $3) AND ($4::TEXT IS NULL OR c.turno = $4)`;
    return t.sql(`
      SELECT u.usuario_id AS id, u.nombre AS "firstName", u.apellido AS "lastName", NOT u.estado AS suspended,
             (SELECT COUNT(*) ${assignments})::INT AS "assignmentCount",
             (SELECT COUNT(DISTINCT a.curso_id) ${assignments})::INT AS "courseCount"
        FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
       WHERE u.institucion_id = $1 AND r.nombre = 'PROFESOR' AND u.fecha_eliminacion IS NULL
       ORDER BY "assignmentCount" DESC, u.apellido, u.nombre, u.usuario_id`,
    [institutionId, schoolYear, COLUMN_LEVEL[educationLevel] ?? null, COLUMN_SHIFT[shift] ?? null]);
  };

  const averageOf = (teachers) => (teachers.length
    ? teachers.reduce((sum, teacher) => sum + teacher.assignmentCount, 0) / teachers.length
    : null);

  const teacherOf = (report, teacher) => report.teachers.find((row) => row.id === teacher.id);

  test('counts', 'Cada profesor no dado de baja, con sus asignaciones y sus cursos del ciclo actual, en el orden y con el promedio de una consulta propia', async (t) => {
    const { idleTeacher, busyTeacher, suspendedTeacher, deletedTeacher } = t.data;
    await t.login('admin');
    const { report } = await t.ok('reports.getTeacherWorkload', filtersOf({ schoolYear: t.year }));
    const expected = await expectedTeachers(t, { schoolYear: t.year });
    t.equal(report.schoolYear, t.year, 'El reporte es del ciclo pedido');
    t.equal(report.teachers, expected, 'Profesores, conteos y orden');
    t.equal(report.average, averageOf(expected), 'El promedio es el de todos los profesores listados');

    t.equal(teacherOf(report, busyTeacher) && { assignments: teacherOf(report, busyTeacher).assignmentCount, courses: teacherOf(report, busyTeacher).courseCount },
      { assignments: 3, courses: 2 }, 'Dos materias del mismo curso y una de otro: 3 asignaciones en 2 cursos (sin la dada de baja)');
    t.equal(teacherOf(report, idleTeacher), { id: idleTeacher.id, firstName: idleTeacher.firstName, lastName: idleTeacher.lastName, suspended: false, assignmentCount: 0, courseCount: 0 },
      'El profesor sin asignaciones aparece con 0');
    t.equal(teacherOf(report, suspendedTeacher) && { suspended: teacherOf(report, suspendedTeacher).suspended, assignments: teacherOf(report, suspendedTeacher).assignmentCount },
      { suspended: true, assignments: 1 }, 'El profesor suspendido aparece con suspended: true y su asignación');
    t.check(!teacherOf(report, deletedTeacher), 'El profesor dado de baja no aparece');
    const ids = report.teachers.map((teacher) => teacher.id);
    t.check(ids.indexOf(busyTeacher.id) < ids.indexOf(idleTeacher.id), 'El de más asignaciones va antes que el que no tiene', ids);
    const counts = report.teachers.map((teacher) => teacher.assignmentCount);
    t.check(counts.every((count, index) => index === 0 || counts[index - 1] >= count), 'De mayor a menor cantidad', counts);
    await t.logout();
  });

  test('filters', 'Nivel, Turno y un ciclo cerrado cuentan solo las asignaciones de esos cursos, y siguen listando a todos los profesores', async (t) => {
    const { busyTeacher } = t.data;
    await t.login('admin');
    const cases = [
      { filters: { schoolYear: t.year, educationLevel: 'PRIMARY' }, busy: { assignmentCount: 1, courseCount: 1 } },
      { filters: { schoolYear: t.year, educationLevel: 'SECONDARY' }, busy: { assignmentCount: 2, courseCount: 1 } },
      { filters: { schoolYear: t.year, shift: 'MORNING' }, busy: { assignmentCount: 1, courseCount: 1 } },
      { filters: { schoolYear: t.year, shift: 'AFTERNOON' }, busy: { assignmentCount: 2, courseCount: 1 } },
      { filters: { schoolYear: t.year, educationLevel: 'PRIMARY', shift: 'AFTERNOON' }, busy: { assignmentCount: 0, courseCount: 0 } },
      { filters: { schoolYear: t.year - 1 }, busy: { assignmentCount: 1, courseCount: 1 } },
    ];
    const all = await expectedTeachers(t, { schoolYear: t.year });
    for (const { filters, busy } of cases) {
      await t.step(JSON.stringify(filters), async () => {
        const { report } = await t.ok('reports.getTeacherWorkload', filtersOf(filters));
        const expected = await expectedTeachers(t, filters);
        t.equal(report.teachers, expected, 'Profesores, conteos y orden');
        t.equal(report.average, averageOf(expected), 'Promedio');
        t.equal(report.teachers.length, all.length, 'Lista a los mismos profesores que sin filtros');
        const row = teacherOf(report, busyTeacher);
        t.equal(row && { assignmentCount: row.assignmentCount, courseCount: row.courseCount }, busy, 'Asignaciones y cursos del profesor ocupado');
      });
    }
    for (const schoolYear of [1999, 2101, String(t.year), null]) {
      await t.rejects('INVALID_INPUT', 'reports.getTeacherWorkload', filtersOf({ schoolYear }));
    }
    await t.rejects('INVALID_INPUT', 'reports.getTeacherWorkload', filtersOf({ schoolYear: t.year, educationLevel: 'PRIMARIA' }));
    await t.rejects('INVALID_INPUT', 'reports.getTeacherWorkload', filtersOf({ schoolYear: t.year, shift: 'NIGHT' }));
    await t.rejects('INVALID_INPUT', 'reports.getTeacherWorkload', null);
    await t.logout();
  });

  test('institution-scope', 'Cada administrador ve solo a los profesores de su institución; sin profesores, la lista está vacía y el promedio es null', async (t) => {
    const { foreignTeacher, foreignAdmin, emptyAdmin } = t.data;
    await t.login('admin');
    const own = (await t.ok('reports.getTeacherWorkload', filtersOf({ schoolYear: t.year }))).report;
    t.check(!teacherOf(own, foreignTeacher), 'El profesor de la otra institución no aparece');
    await t.logout();

    await t.login(foreignAdmin);
    const foreign = (await t.ok('reports.getTeacherWorkload', filtersOf({ schoolYear: t.year }))).report;
    t.equal(foreign.teachers.map((teacher) => ({ id: teacher.id, assignmentCount: teacher.assignmentCount })),
      [{ id: foreignTeacher.id, assignmentCount: 1 }], 'El administrador de la otra institución ve solo a su profesor');
    t.equal(foreign.average, 1, 'Promedio de la otra institución');
    await t.logout();

    await t.login(emptyAdmin);
    t.equal((await t.ok('reports.getTeacherWorkload', filtersOf({ schoolYear: t.year }))).report,
      { schoolYear: t.year, average: null, teachers: [] }, 'Sin profesores: lista vacía y promedio null');
    await t.logout();
  });
});

// Reporte Regularidad de los backups (plans/reportes-administrador/03-regularidad-backups.md): los
// backups de la institución por mes del ciclo elegido, con los meses futuros marcados, y el último
// backup, que no depende del ciclo. Las filas de respaldo se insertan por SQL (no tiene clave
// foránea al usuario), siempre a las 12:00, lejos del cambio de día en cualquier zona horaria.
// Lo que depende del día se prueba con la fecha de la base fijada (fixtures.onDate).
group('main.admin.reports.backup-regularity', 'Administrador: reporte Regularidad de los backups', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId();
    const year = fixtures.year;
    const insertBackups = async (targetInstitutionId, dates) => {
      for (const date of dates) {
        await fixtures.db.query(
          `INSERT INTO respaldo (institucion_id, usuario_id, usuario_nombre, usuario_apellido, fecha)
           VALUES ($1, 0, 'Suite', 'Backup', ($2 || ' 12:00')::TIMESTAMP::TIMESTAMPTZ)`, [targetInstitutionId, date]);
      }
    };
    // Ciclo anterior: dos en febrero, uno en mayo y uno en noviembre. Ciclo actual: dos en enero y
    // uno en marzo, el último de la institución.
    await insertBackups(institutionId, [`${year - 1}-02-10`, `${year - 1}-02-25`, `${year - 1}-05-20`, `${year - 1}-11-03`,
      `${year}-01-10`, `${year}-01-28`, `${year}-03-15`]);
    // Otra institución, con backups en meses que la propia no tiene, y su administrador; y otra sin
    // ningún backup
    const otherInstitution = await fixtures.createInstitution();
    await insertBackups(otherInstitution.id, [`${year - 1}-07-07`, `${year}-04-04`, `${year}-04-20`]);
    const foreignAdmin = await fixtures.createUser({ role: 'ADMIN', institutionId: otherInstitution.id });
    const emptyAdmin = await fixtures.createUser({ role: 'ADMIN', institutionId: (await fixtures.createInstitution()).id });
    return { institutionId, otherInstitutionId: otherInstitution.id, foreignAdmin, emptyAdmin, lastBackupDay: `${year}-03-15` };
  },
}, () => {
  const midYear = (t) => `${t.year}-06-09`;

  // Los 12 meses del año, con los backups de la institución en cada uno: rangos de fechas por mes
  // (distinto del EXTRACT agrupado del repositorio)
  const expectedCounts = async (t, schoolYear, institutionId = t.data.institutionId) => (await t.sql(`
    SELECT m AS month,
           (SELECT COUNT(*) FROM respaldo r
             WHERE r.institucion_id = $1
               AND r.fecha >= make_date($2, m, 1)
               AND r.fecha < make_date($2, m, 1) + INTERVAL '1 month')::INT AS count
      FROM generate_series(1, 12) AS m
     ORDER BY m`, [institutionId, schoolYear])).map(({ month, count }) => ({ month, count }));

  const countsOf = (report) => report.months.map(({ month, count }) => ({ month, count }));
  const futureMonthsOf = (report) => report.months.filter((month) => month.future).map((month) => month.month);
  const countOf = (report, month) => report.months.find((row) => row.month === month)?.count;

  test('counts', 'Los 12 meses del ciclo pedido, con los backups de cada uno según una consulta propia y 0 en los que no tienen', async (t) => {
    await t.login('admin');
    await t.fixtures.onDate(midYear(t), async () => {
      for (const schoolYear of [t.year - 1, t.year]) {
        await t.step(String(schoolYear), async () => {
          const { report } = await t.ok('reports.getBackupRegularity', { schoolYear });
          t.equal(report.schoolYear, schoolYear, 'El reporte es del ciclo pedido');
          t.equal(report.months.map((month) => month.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'Los 12 meses, en orden');
          t.equal(countsOf(report), await expectedCounts(t, schoolYear), 'Backups por mes');
        });
      }
      const previous = (await t.ok('reports.getBackupRegularity', { schoolYear: t.year - 1 })).report;
      t.equal([2, 3, 5, 7, 11].map((month) => countOf(previous, month)), [2, 0, 1, 0, 1],
        'Ciclo anterior: dos en febrero, uno en mayo y en noviembre, y 0 en marzo y en julio (julio es de la otra institución)');
      const current = (await t.ok('reports.getBackupRegularity', { schoolYear: t.year })).report;
      t.equal([1, 2, 3, 4].map((month) => countOf(current, month)), [2, 0, 1, 0],
        'Ciclo actual: el año del filtro cuenta solo los de ese año (abril es de la otra institución)');
    });
    await t.logout();
  });

  test('future', 'En el ciclo actual, los meses posteriores al de hoy son futuros; en uno pasado, ninguno; en uno futuro, todos', async (t) => {
    await t.login('admin');
    await t.fixtures.onDate(midYear(t), async () => {
      const futureOf = async (schoolYear) => futureMonthsOf((await t.ok('reports.getBackupRegularity', { schoolYear })).report);
      t.equal(await futureOf(t.year), [7, 8, 9, 10, 11, 12], 'El 09/06, de julio a diciembre');
      t.equal(await futureOf(t.year - 1), [], 'Ciclo pasado: ninguno');
      const next = (await t.ok('reports.getBackupRegularity', { schoolYear: t.year + 1 })).report;
      t.equal(futureMonthsOf(next).length, 12, 'Ciclo futuro: todos');
      t.check(next.months.every((month) => month.count === 0), 'Ciclo futuro: sin backups', next.months);
    });
    await t.fixtures.onDate(`${t.year}-12-31`, async () => {
      t.equal(futureMonthsOf((await t.ok('reports.getBackupRegularity', { schoolYear: t.year })).report), [], 'El 31/12, ninguno');
    });
    await t.logout();
  });

  test('last-backup', 'El último backup es el más reciente de la institución, con los días según la fecha de la base, en cualquier ciclo', async (t) => {
    const { institutionId, lastBackupDay } = t.data;
    const { max } = await t.sqlOne(`SELECT MAX(fecha) AS max FROM respaldo WHERE institucion_id = $1`, [institutionId]);
    await t.login('admin');
    const cases = [
      { today: midYear(t), label: 'Meses después' },
      { today: lastBackupDay, label: 'El mismo día: 0' },
      { today: `${t.year}-01-05`, label: 'La fecha de la base antes del backup: 0, nunca negativo' },
    ];
    for (const { today, label } of cases) {
      await t.step(label, async () => {
        const { days } = await t.sqlOne(`SELECT GREATEST(0, $1::DATE - $2::DATE) AS days`, [today, lastBackupDay]);
        await t.fixtures.onDate(today, async () => {
          for (const schoolYear of [t.year, t.year - 1, t.year + 1]) {
            const { report } = await t.ok('reports.getBackupRegularity', { schoolYear });
            t.equal(report.lastBackup && { createdAt: new Date(report.lastBackup.createdAt).getTime(), daysAgo: report.lastBackup.daysAgo },
              { createdAt: max.getTime(), daysAgo: days }, `Ciclo ${schoolYear}: el último backup no depende del filtro`);
            t.check(typeof report.lastBackup?.createdAt === 'string' && !Number.isNaN(Date.parse(report.lastBackup.createdAt)),
              'createdAt es un texto ISO 8601', report.lastBackup);
          }
        });
      });
    }
    await t.logout();
  });

  test('institution-scope', 'Cada administrador ve solo los backups de su institución; sin backups, lastBackup es null y todos los meses en 0', async (t) => {
    const { otherInstitutionId, foreignAdmin, emptyAdmin } = t.data;
    await t.login(foreignAdmin);
    for (const schoolYear of [t.year - 1, t.year]) {
      t.equal(countsOf((await t.ok('reports.getBackupRegularity', { schoolYear })).report),
        await expectedCounts(t, schoolYear, otherInstitutionId), `Ciclo ${schoolYear}: solo los de la otra institución`);
    }
    const { max } = await t.sqlOne(`SELECT MAX(fecha) AS max FROM respaldo WHERE institucion_id = $1`, [otherInstitutionId]);
    const foreign = (await t.ok('reports.getBackupRegularity', { schoolYear: t.year })).report;
    t.equal(new Date(foreign.lastBackup?.createdAt).getTime(), max.getTime(), 'Su último backup es el de su institución');
    await t.logout();

    await t.login(emptyAdmin);
    const empty = (await t.ok('reports.getBackupRegularity', { schoolYear: t.year })).report;
    t.equal(empty.lastBackup, null, 'Sin backups: lastBackup es null');
    t.equal(empty.months.map((month) => month.count), Array(12).fill(0), 'Sin backups: los 12 meses en 0');
    for (const schoolYear of [1999, 2101, String(t.year), null]) {
      await t.rejects('INVALID_INPUT', 'reports.getBackupRegularity', { schoolYear });
    }
    await t.rejects('INVALID_INPUT', 'reports.getBackupRegularity', null);
    await t.logout();
  });
});
