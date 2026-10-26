// Capa main: casos de uso del Secretario por la API del preload (alumnos, inscripciones, comprobante
// e indicador del inicio). Inicia sesión con la secretaria del seed (solo la lee) y opera sobre datos
// propios; cada resultado se comprueba con una consulta independiente.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { group, test } = require('../lib/framework');
const { SEED_INSTITUTIONS } = require('../lib/fixtures');
const { ENROLLMENT_STATUS, STUDENT_STATUS, enrollmentNumber, sortedIds, sortedNumbers } = require('../lib/domain');

const SM = SEED_INSTITUTIONS.SM;
const EMPTY_FILTERS = { enrollmentIds: [], studentIds: [], grades: [], divisions: [], shifts: [], statuses: [] };

const studentData = (year, overrides) => ({
  firstName: 'Alumna', lastName: 'Nueva', dni: '', email: '', phone: '3794555000', street: 'Junín', streetNumber: '1200',
  birthDate: `${year - 11}-08-20`, ...overrides,
});

// Texto de un PDF con pdftotext, si está instalado (Git para Windows lo trae); si no, null.
function pdfText(file) {
  const candidates = ['pdftotext', 'C:/Program Files/Git/mingw64/bin/pdftotext.exe'];
  for (const command of candidates) {
    const result = spawnSync(command, ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0) return result.stdout.replace(/\s+/g, ' ');
  }
  return null;
}

group('main.secretary.students', 'Secretario: alumnos', {
  async setup({ fixtures }) {
    const course = await fixtures.createCourse();
    const enrolled = await fixtures.createStudent();
    const enrollmentId = await fixtures.enroll({ studentId: enrolled.id, courseId: course.id });
    const free = await fixtures.createStudent();
    const deleted = await fixtures.createStudent({ deleted: true });
    return { course, enrolled, enrollmentId, free, deleted };
  },
}, () => {
  test('list', 'El listado trae a los alumnos de la institución, vigentes y dados de baja, con su estado', async (t) => {
    await t.login('secretary');
    const { students } = await t.ok('students.list');
    const expected = await t.sql(`
      SELECT a.alumno_id AS id, e.nombre AS estado, a.fecha_eliminacion IS NOT NULL AS deleted FROM alumno a JOIN alumno_estado e USING (alumno_estado_id)
       WHERE a.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM]);
    t.equal(sortedIds(students), sortedNumbers(expected), 'Los ids del listado son los alumnos de la institución');
    const byId = new Map(expected.map((row) => [row.id, row]));
    t.check(students.every((student) => student.status === STUDENT_STATUS[byId.get(student.id)?.estado] && Boolean(student.deletedAt) === byId.get(student.id)?.deleted),
      'El estado y la baja de cada alumno coinciden con la base');
    await t.logout();
  });

  test('create', 'El alta registra al alumno activo en la institución', async (t) => {
    await t.login('secretary');
    const data = studentData(t.year, { dni: '93100001', email: 'alta.alumna@prueba.edu.ar' });
    const { student } = await t.ok('students.create', data);
    const row = await t.sqlOne(`
      SELECT a.alumno_id, e.nombre AS estado, a.dni, a.email, a.telefono, a.direccion_calle, a.direccion_altura, a.fecha_eliminacion,
             to_char(a.fecha_nacimiento, 'YYYY-MM-DD') AS nacimiento
        FROM alumno a JOIN alumno_estado e USING (alumno_estado_id) WHERE a.dni = $1
         AND a.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $2)`, [data.dni, SM]);
    t.require(row, 'El alumno no quedó en la base');
    t.equal(student?.id, row.alumno_id, 'La respuesta trae el id del alumno creado');
    t.equal({ estado: row.estado, email: row.email, telefono: row.telefono, calle: row.direccion_calle, altura: row.direccion_altura, nacimiento: row.nacimiento, baja: row.fecha_eliminacion },
      { estado: 'ACTIVO', email: data.email, telefono: data.phone, calle: data.street, altura: data.streetNumber, nacimiento: data.birthDate, baja: null }, 'Datos guardados');
    await t.logout();
  });

  test('create-rejections', 'El alta rechaza un dni repetido y propone restaurar a un dado de baja, sin crear nada', async (t) => {
    await t.login('secretary');
    const before = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM alumno`);
    const duplicate = await t.rejects('DUPLICATE_VALUE', 'students.create', studentData(t.year, { dni: t.data.free.dni, email: 'otro.alumno@prueba.edu.ar' }));
    t.check(duplicate?.error?.fieldErrors?.dni, 'El duplicado marca el dni', duplicate);
    await t.rejects('DELETED_STUDENT_EXISTS', 'students.create', studentData(t.year, { dni: t.data.deleted.dni, email: 'otro.mas@prueba.edu.ar' }));
    await t.rejects('INVALID_INPUT', 'students.create', studentData(t.year, { dni: '93100002', email: 'tel.invalido@prueba.edu.ar', phone: '379-455' }));
    t.equal(await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM alumno`), before, 'No se creó ningún alumno');
    await t.logout();
  });

  test('update', 'La edición guarda los datos y el estado de un alumno sin inscripción activa', async (t) => {
    await t.login('secretary');
    const student = t.data.free;
    const data = { ...studentData(t.year, {}), firstName: student.firstName, lastName: student.lastName, dni: student.dni, email: student.email, birthDate: student.birthDate, phone: '3794999888', status: 'GRADUATED' };
    await t.ok('students.update', student.id, data);
    t.equal(await t.sqlOne(`SELECT a.telefono, e.nombre AS estado FROM alumno a JOIN alumno_estado e USING (alumno_estado_id) WHERE a.alumno_id = $1`, [student.id]),
      { telefono: '3794999888', estado: 'EGRESADO' }, 'La edición se guardó');
    await t.rejects('STUDENT_NOT_FOUND', 'students.update', t.data.deleted.id, { ...data, dni: t.data.deleted.dni, email: t.data.deleted.email });
    await t.logout();
  });

  test('delete-restore', 'La baja cancela la inscripción activa sin darla de baja; la restauración no la reactiva', async (t) => {
    await t.login('secretary');
    const { enrolled, enrollmentId } = t.data;
    const result = await t.ok('students.delete', enrolled.id);
    t.equal(result.cancelledEnrollmentCount, 1, 'Informa una inscripción cancelada');
    const state = () => t.sqlOne(`
      SELECT a.fecha_eliminacion IS NOT NULL AS alumno_baja, e.nombre AS estado, i.fecha_eliminacion IS NOT NULL AS inscripcion_baja
        FROM alumno a JOIN inscripcion i USING (alumno_id) JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.inscripcion_id = $1`, [enrollmentId]);
    t.equal(await state(), { alumno_baja: true, estado: 'CANCELADA', inscripcion_baja: false }, 'Después de la baja');
    await t.rejects('STUDENT_ALREADY_DELETED', 'students.delete', enrolled.id);
    await t.ok('students.restore', enrolled.id);
    t.equal(await state(), { alumno_baja: false, estado: 'CANCELADA', inscripcion_baja: false }, 'Después de la restauración');
    await t.rejects('STUDENT_NOT_DELETED', 'students.restore', enrolled.id);
    await t.logout();
  });
});

group('main.secretary.enrollments', 'Secretario: inscripciones y comprobante', {
  async setup({ fixtures }) {
    const course = await fixtures.createCourse();
    const pastCourse = await fixtures.inSchoolYear(fixtures.year - 1, () => fixtures.createCourse());
    const students = [];
    for (let i = 0; i < 4; i += 1) students.push(await fixtures.createStudent());
    const active = await fixtures.enroll({ studentId: students[0].id, courseId: course.id });
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
    const scored = await fixtures.enroll({ studentId: students[1].id, courseId: course.id });
    await fixtures.score({ evaluationId, enrollmentId: scored });
    return { course, pastCourse, students, active, scored };
  },
}, () => {
  const expectedListed = (t) => t.sql(`
    SELECT i.inscripcion_id AS id, e.nombre AS estado FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
      JOIN curso c USING (curso_id) JOIN alumno a USING (alumno_id)
     WHERE i.fecha_eliminacion IS NULL AND a.fecha_eliminacion IS NULL
       AND c.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM]);

  async function listAll(t, filters) {
    const ids = [];
    let page = 1;
    let total;
    for (;;) {
      const result = await t.ok('enrollments.list', filters, page, 100);
      total = result.total;
      ids.push(...result.enrollments.map((enrollment) => enrollment.id));
      if (!result.enrollments.length || ids.length >= total || result.page < page) break;
      page += 1;
    }
    return { ids: ids.sort((a, b) => a - b), total };
  }

  test('list', 'El listado pagina las inscripciones vigentes de alumnos vigentes y filtra por estado', async (t) => {
    await t.login('secretary');
    const expected = await expectedListed(t);
    const all = await listAll(t, EMPTY_FILTERS);
    t.equal(all.ids, sortedNumbers(expected), 'Recorriendo las páginas se ven todas las inscripciones vigentes');
    t.equal(all.total, expected.length, 'total coincide con la base');
    const cancelled = await listAll(t, { ...EMPTY_FILTERS, statuses: ['CANCELLED'] });
    t.equal(cancelled.ids, sortedNumbers(expected.filter((row) => row.estado === 'CANCELADA')), 'El filtro por estado');
    const options = await t.ok('enrollments.listFilterOptions');
    t.equal(sortedIds(options.enrollments), sortedNumbers(expected), 'Las opciones de filtro son las mismas inscripciones');
    await t.logout();
  });

  test('form-options', 'El alta ofrece los alumnos activos sin inscripción activa y los cursos vigentes del ciclo actual', async (t) => {
    await t.login('secretary');
    const { students } = await t.ok('enrollments.listEnrollableStudents');
    const expectedStudents = await t.sql(`
      SELECT a.alumno_id AS id FROM alumno a JOIN alumno_estado e USING (alumno_estado_id)
       WHERE a.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)
         AND a.fecha_eliminacion IS NULL AND e.nombre = 'ACTIVO'
         AND NOT EXISTS (SELECT 1 FROM inscripcion i JOIN inscripcion_estado ie USING (inscripcion_estado_id)
                          WHERE i.alumno_id = a.alumno_id AND i.fecha_eliminacion IS NULL AND ie.nombre = 'ACTIVA')`, [SM]);
    t.equal(sortedIds(students), sortedNumbers(expectedStudents), 'Alumnos inscribibles');
    const { courses } = await t.ok('enrollments.listEnrollableCourses');
    const expectedCourses = await t.sql(`
      SELECT curso_id AS id FROM curso WHERE fecha_eliminacion IS NULL AND anio_ciclo_lectivo = $2
         AND institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM, t.year]);
    t.equal(sortedIds(courses), sortedNumbers(expectedCourses), 'Cursos inscribibles');
    await t.logout();
  });

  test('create', 'El alta inscribe al alumno activo, con la fecha de hoy y su número', async (t) => {
    await t.login('secretary');
    const student = t.data.students[2];
    const { enrollment } = await t.ok('enrollments.create', { studentId: student.id, educationLevel: 'SECONDARY', courseId: t.data.course.id });
    const row = await t.sqlOne(`
      SELECT i.alumno_id, i.curso_id, e.nombre AS estado, to_char(i.fecha_inscripcion, 'YYYY-MM-DD') AS fecha
        FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.inscripcion_id = $1`, [enrollment?.id]);
    t.equal(row, { alumno_id: student.id, curso_id: t.data.course.id, estado: 'ACTIVA', fecha: t.today }, 'La inscripción quedó en la base');
    t.equal(enrollment.number, enrollmentNumber(enrollment.id), 'El número es INS- y el id');
    const page = await t.ok('enrollments.list', EMPTY_FILTERS, 1, 10, enrollment.id);
    t.check(page.enrollments.some((listed) => listed.id === enrollment.id), 'list con enrollmentId devuelve la página de la nueva');
    await t.rejects('STUDENT_ALREADY_ENROLLED', 'enrollments.create', { studentId: student.id, educationLevel: 'SECONDARY', courseId: t.data.course.id });
    await t.rejects('COURSE_OUT_OF_SCHOOL_YEAR', 'enrollments.create', { studentId: t.data.students[3].id, educationLevel: 'SECONDARY', courseId: t.data.pastCourse.id });
    await t.logout();
  });

  test('update-status', 'Una inscripción pasa de activa a cancelada y vuelve a activa', async (t) => {
    await t.login('secretary');
    const id = t.data.active;
    const status = async () => (await t.sqlOne(`SELECT e.nombre FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.inscripcion_id = $1`, [id])).nombre;
    const fetched = await t.ok('enrollments.get', id);
    t.equal(fetched.enrollment?.status, ENROLLMENT_STATUS[await status()], 'get informa el estado de la base');
    const cancelled = await t.ok('enrollments.update', id, { status: 'CANCELLED' });
    t.equal([cancelled.changed, await status()], [true, 'CANCELADA'], 'Quedó cancelada');
    const same = await t.ok('enrollments.update', id, { status: 'CANCELLED' });
    t.equal(same.changed, false, 'Guardar el mismo estado no cambia nada');
    await t.ok('enrollments.update', id, { status: 'ACTIVE' });
    t.equal(await status(), 'ACTIVA', 'Volvió a activa');
    await t.logout();
  });

  test('update-to-completed', 'Hoy la edición acepta pasar una inscripción del ciclo actual a finalizada', {
    kind: 'current',
    affectedBy: ['secretario-inscripciones', 'ciclo-lectivo'],
  }, async (t) => {
    await t.login('secretary');
    const student = t.data.students[3];
    const enrollmentId = await t.fixtures.enroll({ studentId: student.id, courseId: t.data.course.id });
    await t.ok('enrollments.update', enrollmentId, { status: 'COMPLETED' });
    await t.logout();
  });

  test('delete', 'La baja lógica conserva el estado; con calificaciones vigentes se rechaza', async (t) => {
    await t.login('secretary');
    const student = await t.fixtures.createStudent();
    const id = await t.fixtures.enroll({ studentId: student.id, courseId: t.data.course.id, status: 'CANCELADA' });
    await t.ok('enrollments.delete', id);
    t.equal(await t.sqlOne(`SELECT e.nombre AS estado, i.fecha_eliminacion IS NOT NULL AS baja FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.inscripcion_id = $1`, [id]),
      { estado: 'CANCELADA', baja: true }, 'Dada de baja con el mismo estado');
    await t.rejects('ENROLLMENT_ALREADY_DELETED', 'enrollments.delete', id);
    await t.rejects('ENROLLMENT_DELETED', 'enrollments.get', id);
    await t.rejects('ENROLLMENT_HAS_SCORES', 'enrollments.delete', t.data.scored);
    t.equal(await t.sqlOne(`SELECT fecha_eliminacion FROM inscripcion WHERE inscripcion_id = $1`, [t.data.scored]), { fecha_eliminacion: null }, 'La calificada sigue vigente');
    await t.logout();
  });

  test('receipt', 'El comprobante se genera como PDF en la carpeta temporal y se abre con el visor (reemplazado por la suite)', async (t) => {
    await t.login('secretary');
    const id = t.data.active;
    await t.ok('enrollments.openReceipt', id);
    t.require(t.openedPaths.length === 1, 'Se pidió abrir un solo archivo', t.openedPaths);
    const file = t.openedPaths[0].filePath;
    t.check(path.resolve(file).startsWith(path.resolve(t.harness.tempDir)), 'El PDF quedó en la carpeta temporal de la corrida', file);
    t.check(file.toLowerCase().endsWith('.pdf') && fs.existsSync(file), 'El archivo existe y es .pdf', file);
    t.check(fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-', 'El archivo es un PDF');
    const text = pdfText(file);
    if (text === null) t.warn('pdftotext no está instalado: no se comprobó el contenido del comprobante');
    else t.check(text.includes(enrollmentNumber(id)), 'El comprobante lleva el número de la inscripción', text.slice(0, 300));
    await t.rejects('ENROLLMENT_NOT_FOUND', 'enrollments.openReceipt', 2147483000);
    t.harness.openPathResult = 'No hay un programa asociado';
    await t.rejects('PDF_VIEWER_UNAVAILABLE', 'enrollments.openReceipt', id);
    await t.logout();
  });
});

group('main.secretary.dashboard', 'Secretario: indicador del inicio', () => {
  test('summary', 'Inscripciones activas: las vigentes del ciclo actual, contadas en la base', async (t) => {
    await t.login('secretary');
    const { summary } = await t.ok('dashboard.getSecretarySummary');
    const expected = await t.sqlOne(`
      SELECT COUNT(*)::INT AS "activeEnrollmentCount" FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
        JOIN curso c USING (curso_id)
       WHERE e.nombre = 'ACTIVA' AND i.fecha_eliminacion IS NULL AND c.anio_ciclo_lectivo = $2
         AND c.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $1)`, [SM, t.year]);
    t.equal(summary, expected, 'Indicador del secretario');
    await t.logout();
  });
});
