// Capa main: flujo general mínimo que encadena los tres roles, por la API del preload. Usa solo
// operaciones que ninguna restricción pendiente prohíbe (ciclo actual, entidades activas y vigentes,
// fechas que no son futuras), así pasa igual antes y después de todos los planes.
// La versión con la interfaz está en tests/ui/minimal-flow.test.js.
const fs = require('node:fs');
const { group, test } = require('../lib/framework');
const { SEED_INSTITUTIONS } = require('../lib/fixtures');

const flow = {};

group('main.minimal', 'Flujo mínimo por IPC: administrador, secretario y profesor', {
  async setup({ fixtures }) {
    return { teacher: await fixtures.createUser({ role: 'PROFESOR' }) };
  },
}, () => {
  test('admin', 'El administrador crea un curso del ciclo actual y le asigna un profesor activo', { minimal: true }, async (t) => {
    await t.login('admin');
    const institutionId = await t.fixtures.institutionId(SEED_INSTITUTIONS.SM);
    const gradeId = await t.fixtures.gradeId('SECUNDARIA', '6°');
    const division = await t.fixtures.freeDivision(institutionId, gradeId, 'MAÑANA', t.year);
    const { course } = await t.ok('courses.create', { gradeId, division, shift: 'MORNING' });
    t.require(course, 'No se creó el curso');
    t.equal(await t.sqlOne(`SELECT anio_ciclo_lectivo, fecha_eliminacion FROM curso WHERE curso_id = $1`, [course.id]),
      { anio_ciclo_lectivo: t.year, fecha_eliminacion: null }, 'El curso es del ciclo actual y vigente');

    const { teachers } = await t.ok('teacherAssignments.listAssignableTeachers');
    t.require(teachers.some((teacher) => teacher.id === t.data.teacher.id), 'El profesor activo se ofrece para asignar');
    const { courses } = await t.ok('teacherAssignments.listAssignableCourses');
    t.require(courses.some((candidate) => candidate.id === course.id), 'El curso nuevo se ofrece para asignar');
    const { subjects } = await t.ok('teacherAssignments.listAssignableSubjects', course.id);
    t.require(subjects.length > 0, 'El curso tiene materias para asignar');
    const { teacherAssignment } = await t.ok('teacherAssignments.create', { teacherId: t.data.teacher.id, courseId: course.id, subjectId: subjects[0].id });
    t.require(teacherAssignment, 'No se creó la asignación');
    t.equal(await t.sqlOne(`SELECT usuario_id, curso_id, fecha_eliminacion FROM asignacion_docente WHERE asignacion_docente_id = $1`, [teacherAssignment.id]),
      { usuario_id: t.data.teacher.id, curso_id: course.id, fecha_eliminacion: null }, 'La asignación quedó vigente');
    Object.assign(flow, { course, assignment: teacherAssignment });
    await t.logout();
  });

  test('secretary', 'El secretario crea un alumno, lo inscribe en ese curso e imprime el comprobante', { minimal: true }, async (t) => {
    t.require(flow.course, 'Falló el paso anterior (administrador): no hay curso');
    await t.login('secretary');
    const data = {
      firstName: 'Flujo', lastName: 'Minimo', dni: '93900001', email: 'flujo.minimo@prueba.edu.ar', phone: '3794000111',
      street: 'Mitre', streetNumber: '500', birthDate: `${t.year - 16}-03-03`,
    };
    const { student } = await t.ok('students.create', data);
    t.require(student, 'No se creó el alumno');
    const { students } = await t.ok('enrollments.listEnrollableStudents');
    t.require(students.some((candidate) => candidate.id === student.id), 'El alumno nuevo se ofrece para inscribir');
    const { courses } = await t.ok('enrollments.listEnrollableCourses');
    t.require(courses.some((candidate) => candidate.id === flow.course.id), 'El curso nuevo se ofrece para inscribir');
    const { enrollment } = await t.ok('enrollments.create', { studentId: student.id, educationLevel: flow.course.educationLevel, courseId: flow.course.id });
    t.require(enrollment, 'No se creó la inscripción');
    t.equal(await t.sqlOne(`
      SELECT e.nombre AS estado, to_char(i.fecha_inscripcion, 'YYYY-MM-DD') AS fecha, i.fecha_eliminacion
        FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.inscripcion_id = $1`, [enrollment.id]),
    { estado: 'ACTIVA', fecha: t.today, fecha_eliminacion: null }, 'La inscripción es activa, vigente y de hoy');
    await t.ok('enrollments.openReceipt', enrollment.id);
    const opened = t.openedPaths.at(-1)?.filePath;
    t.check(opened && fs.existsSync(opened) && fs.readFileSync(opened).subarray(0, 5).toString() === '%PDF-', 'El comprobante es un PDF', opened);
    Object.assign(flow, { student, enrollment });
    await t.logout();
  });

  test('teacher', 'El profesor ve la asignación y al alumno, crea una evaluación de hoy y le carga una nota que persiste', { minimal: true }, async (t) => {
    t.require(flow.enrollment, 'Falló un paso anterior: no hay inscripción');
    await t.login(t.data.teacher);
    const { teacherAssignments } = await t.ok('teacherAssignments.listOwn');
    t.require(teacherAssignments.some((assignment) => assignment.id === flow.assignment.id), 'El profesor ve la asignación');
    const { enrollments } = await t.ok('enrollments.listByOwnAssignment', flow.assignment.id);
    t.require(enrollments.some((enrollment) => enrollment.id === flow.enrollment.id), 'El profesor ve al alumno inscripto');
    const { evaluation } = await t.ok('evaluations.create', flow.assignment.id, { title: 'Evaluación del flujo mínimo', evaluationDate: t.today });
    t.require(evaluation, 'No se creó la evaluación');
    const before = await t.ok('scores.listByOwnEvaluation', flow.assignment.id, evaluation.id);
    t.equal(before.scores.find((score) => score.enrollmentId === flow.enrollment.id)?.value, null, 'El alumno aparece sin nota');
    await t.ok('scores.save', flow.assignment.id, evaluation.id, { enrollmentId: flow.enrollment.id, value: 8 });
    const after = await t.ok('scores.listByOwnEvaluation', flow.assignment.id, evaluation.id);
    t.equal(after.scores.find((score) => score.enrollmentId === flow.enrollment.id)?.value, 8, 'La nota persiste al volver a leer');
    t.equal(await t.sqlOne(`SELECT nota::TEXT AS nota, fecha_eliminacion FROM calificacion WHERE evaluacion_id = $1 AND inscripcion_id = $2`, [evaluation.id, flow.enrollment.id]),
      { nota: '8.00', fecha_eliminacion: null }, 'La nota quedó en la base');
    await t.logout();
  });
});
