// Capa main: el ciclo lectivo actual según la base (school-years:get-current) y lo de un ciclo cerrado
// en solo lectura. Los datos del ciclo cerrado se cargan con fixtures.inSchoolYear y, como la capa
// no arranca main.js, el cierre no corre: la inscripción del ciclo cerrado sigue activa.
const { group, test } = require('../lib/framework');
const { tableHashes, changedTables } = require('../lib/db-snapshot');
const { ROLES } = require('./permissions.table');

group('main.school-year', 'Ciclo lectivo: el actual según la base y los cerrados en solo lectura', {
  async setup({ fixtures }) {
    const users = {
      ADMIN: await fixtures.createUser({ role: 'ADMIN' }),
      SECRETARIO: await fixtures.createUser({ role: 'SECRETARIO' }),
      PROFESOR: await fixtures.createUser({ role: 'PROFESOR' }),
    };
    const closedYear = fixtures.year - 1;
    // Un curso del ciclo anterior con una asignación del profesor, un alumno inscripto (activo), una
    // evaluación y su nota
    const closed = await fixtures.inSchoolYear(closedYear, async () => {
      const course = await fixtures.createCourse();
      const assignment = await fixtures.assign({ teacherId: users.PROFESOR.id, courseId: course.id });
      const student = await fixtures.createStudent();
      const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
      const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
      await fixtures.score({ evaluationId, enrollmentId });
      return { course, assignment, enrollmentId, evaluationId };
    });
    return { users, closedYear, ...closed };
  },
}, () => {
  test('get-current', 'Los tres roles reciben el año del ciclo lectivo actual y la fecha del día según la base', async (t) => {
    for (const role of ROLES) {
      await t.login(t.data.users[role]);
      const { schoolYear } = await t.ok('schoolYears.getCurrent');
      t.equal(schoolYear, { year: t.year, today: t.today }, `${role}: ciclo lectivo actual`);
      await t.logout();
    }
  });

  test('closed-read-only', 'Toda edición y baja de lo de un ciclo cerrado da SCHOOL_YEAR_CLOSED y la base queda sin cambios', async (t) => {
    const { users, closedYear, course, assignment, enrollmentId, evaluationId } = t.data;
    const before = await tableHashes(t.db);
    // Datos válidos: el único motivo del rechazo es el ciclo cerrado
    const evaluationData = { title: 'En un ciclo cerrado', evaluationDate: `${closedYear}-07-01` };

    await t.login(users.ADMIN);
    await t.rejects('SCHOOL_YEAR_CLOSED', 'courses.update', course.id, { gradeId: course.gradeId, division: course.division, shift: 'MORNING' });
    await t.rejects('SCHOOL_YEAR_CLOSED', 'courses.delete', course.id);
    await t.rejects('SCHOOL_YEAR_CLOSED', 'teacherAssignments.update', assignment.id, { teacherId: assignment.teacherId, courseId: course.id, subjectId: assignment.subjectId });
    await t.rejects('SCHOOL_YEAR_CLOSED', 'teacherAssignments.delete', assignment.id);
    await t.logout();

    await t.login(users.SECRETARIO);
    await t.rejects('SCHOOL_YEAR_CLOSED', 'enrollments.update', enrollmentId, { status: 'CANCELLED' });
    // La base acepta pasar a finalizada en un ciclo cerrado (solo para el cierre): la rechaza el backend
    await t.rejects('SCHOOL_YEAR_CLOSED', 'enrollments.update', enrollmentId, { status: 'COMPLETED' });
    // Tiene una calificación vigente: el ciclo cerrado gana a ENROLLMENT_HAS_SCORES
    await t.rejects('SCHOOL_YEAR_CLOSED', 'enrollments.delete', enrollmentId);
    await t.logout();

    await t.login(users.PROFESOR);
    await t.rejects('SCHOOL_YEAR_CLOSED', 'evaluations.create', assignment.id, evaluationData);
    await t.rejects('SCHOOL_YEAR_CLOSED', 'evaluations.update', assignment.id, evaluationId, evaluationData);
    await t.rejects('SCHOOL_YEAR_CLOSED', 'evaluations.delete', assignment.id, evaluationId);
    await t.rejects('SCHOOL_YEAR_CLOSED', 'scores.save', assignment.id, evaluationId, { enrollmentId, value: 9 });
    await t.rejects('SCHOOL_YEAR_CLOSED', 'scores.delete', assignment.id, evaluationId, enrollmentId);
    await t.logout();

    const after = await tableHashes(t.db);
    t.equal(changedTables(before, after), [], 'Ninguna tabla cambió');
  });
});
