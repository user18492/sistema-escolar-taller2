// Capa ui: flujo general mínimo que encadena los tres roles con mouse y teclado reales sobre la
// aplicación, comprobando cada paso en la base. Usa solo operaciones que ninguna restricción
// pendiente prohíbe (ciclo actual, entidades activas y vigentes, fechas que no son futuras).
const fs = require('node:fs');
const { group, test } = require('../lib/framework');
const { SEED_USERS, SEED_INSTITUTIONS } = require('../lib/fixtures');
const { toDayMonth } = require('../lib/clock');
const { waitUntil } = require('../lib/electron/app-harness');
const { loginViaUi, logoutViaUi, openFromSidebar, pickDropdown, pickSearchable, waitEnabled } = require('./helpers');

const flow = {};

group('ui.minimal', 'Flujo mínimo con la interfaz: administrador, secretario y profesor', {
  async setup({ fixtures }) {
    return { teacher: await fixtures.createUser({ role: 'PROFESOR' }) };
  },
}, () => {
  test('admin', 'El administrador crea un curso del ciclo actual y le asigna un profesor activo', { minimal: true }, async (t) => {
    const { ui } = t;
    await loginViaUi(t, SEED_USERS.admin);
    const institutionId = await t.fixtures.institutionId(SEED_INSTITUTIONS.SM);
    const gradeId = await t.fixtures.gradeId('SECUNDARIA', '6°');
    const division = await t.fixtures.freeDivision(institutionId, gradeId, 'MAÑANA', t.year);

    await t.step('Nuevo curso', async () => {
      await openFromSidebar(t, 'admin/courses/index.html');
      await ui.click('#openNewCourseModalBtn');
      await ui.waitModal('#newCourseOverlay', true);
      await ui.click('[data-filter="new-course-grade"] .dropdown-toggle', { scroll: false });
      await ui.chooseOption('[data-filter="new-course-grade"] .grade-card[data-value="6°"]');
      await ui.fill('#newCourseDivision', division);
      await pickDropdown(t, '[data-filter="new-course-shift"]', 'MORNING');
      await pickDropdown(t, '[data-filter="new-course-level"]', 'SECONDARY');
      await waitEnabled(t, '#createCourseBtn', 'Crear curso');
      await ui.click('#createCourseBtn', { scroll: false });
      await ui.waitModal('#newCourseOverlay', false);
      await ui.idle();
    });
    const course = await t.sqlOne(`
      SELECT curso_id AS id FROM curso WHERE institucion_id = $1 AND grado_id = $2 AND division = $3 AND turno = 'MAÑANA'
         AND anio_ciclo_lectivo = $4 AND fecha_eliminacion IS NULL`, [institutionId, gradeId, division, t.year]);
    t.require(course, 'El curso no quedó en la base');
    t.check(await ui.exists(`tr[data-course-id="${course.id}"]`), 'El curso nuevo aparece en la tabla');

    const subject = (await t.fixtures.subjectsOfGrade(gradeId))[0];
    await t.step('Nueva asignación', async () => {
      await openFromSidebar(t, 'admin/assignments/index.html');
      await ui.waitFor(`document.querySelectorAll('[data-role="teacher-select"] .dropdown-option').length > 0`, { message: 'No cargaron los profesores del formulario' });
      await ui.click('#openNewAssignmentModalBtn');
      await ui.waitModal('#newAssignmentOverlay', true);
      await pickSearchable(t, '[data-role="teacher-select"]', t.data.teacher.id, t.data.teacher.lastName);
      await pickDropdown(t, '[data-filter="new-assignment-level"]', 'SECONDARY');
      await pickSearchable(t, '[data-role="course-select"]', course.id);
      await waitEnabled(t, '#newAssignmentSubject', 'El campo Materia');
      await ui.click('#newAssignmentSubject', { scroll: false });
      await ui.chooseOption(`[data-filter="new-assignment-subject"] .dropdown-option[data-value="${subject.subjectId}"]`);
      await waitEnabled(t, '#createAssignmentBtn', 'Crear asignación');
      await ui.click('#createAssignmentBtn', { scroll: false });
      await ui.waitModal('#newAssignmentOverlay', false);
      await ui.idle();
    });
    const assignment = await t.sqlOne(`
      SELECT asignacion_docente_id AS id FROM asignacion_docente
       WHERE usuario_id = $1 AND curso_id = $2 AND grado_materia_id = $3 AND fecha_eliminacion IS NULL`,
    [t.data.teacher.id, course.id, subject.gradeSubjectId]);
    t.require(assignment, 'La asignación no quedó en la base');
    Object.assign(flow, { course, assignment });
    await logoutViaUi(t);
  });

  test('secretary', 'El secretario crea un alumno, lo inscribe en ese curso e imprime el comprobante', { minimal: true }, async (t) => {
    t.require(flow.course, 'Falló el paso anterior (administrador): no hay curso');
    const { ui } = t;
    await loginViaUi(t, SEED_USERS.secretary);
    const student = { firstName: 'Flujo', lastName: 'Interfaz', dni: '93900002', email: 'flujo.interfaz@prueba.edu.ar', phone: '3794000222', street: 'Mitre', streetNumber: '600', birthDate: `15/03/${t.year - 16}` };

    await t.step('Nuevo alumno', async () => {
      await openFromSidebar(t, 'secretary/students/index.html');
      await ui.click('#openNewStudentModalBtn');
      await ui.waitModal('#newStudentOverlay', true);
      await ui.fill('#newStudentFirstName', student.firstName);
      await ui.fill('#newStudentLastName', student.lastName);
      await ui.fill('#newStudentDni', student.dni);
      await ui.fill('#newStudentBirthdate', student.birthDate.replace(/\//g, ''));
      await ui.fill('#newStudentEmail', student.email);
      await ui.fill('#newStudentPhone', student.phone);
      await ui.fill('#newStudentStreet', student.street);
      await ui.fill('#newStudentStreetNumber', student.streetNumber);
      await waitEnabled(t, '#createStudentBtn', 'Crear alumno');
      await ui.click('#createStudentBtn', { scroll: false });
      await ui.waitModal('#newStudentOverlay', false);
      await ui.idle();
    });
    const created = await t.sqlOne(`
      SELECT a.alumno_id AS id, e.nombre AS estado, to_char(a.fecha_nacimiento, 'YYYY-MM-DD') AS nacimiento FROM alumno a
        JOIN alumno_estado e USING (alumno_estado_id) WHERE a.dni = $1 AND a.institucion_id = $2`,
    [student.dni, await t.fixtures.institutionId(SEED_INSTITUTIONS.SM)]);
    t.require(created, 'El alumno no quedó en la base');
    t.equal([created.estado, created.nacimiento], ['ACTIVO', `${t.year - 16}-03-15`], 'El alumno quedó activo, con la fecha escrita');

    await t.step('Nueva inscripción', async () => {
      await openFromSidebar(t, 'secretary/enrollments/index.html');
      await ui.click('#openNewEnrollmentModalBtn');
      await ui.waitModal('#newEnrollmentOverlay', true);
      await ui.waitFor(`document.querySelector('[data-role="new-enrollment-student-select"] .dropdown-option[data-value="${created.id}"]')`, { message: 'El alumno nuevo no se ofrece para inscribir' });
      await pickSearchable(t, '[data-role="new-enrollment-student-select"]', created.id, student.lastName);
      await pickDropdown(t, '[data-filter="new-enrollment-level"]', 'SECONDARY');
      await pickSearchable(t, '[data-role="new-enrollment-course-select"]', flow.course.id);
      await waitEnabled(t, '#createEnrollmentBtn', 'Crear inscripción');
      await ui.click('#createEnrollmentBtn', { scroll: false });
      await ui.waitModal('#newEnrollmentOverlay', false);
      await ui.idle();
    });
    const enrollment = await t.sqlOne(`
      SELECT i.inscripcion_id AS id, e.nombre AS estado, to_char(i.fecha_inscripcion, 'YYYY-MM-DD') AS fecha FROM inscripcion i
        JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.alumno_id = $1 AND i.curso_id = $2 AND i.fecha_eliminacion IS NULL`,
    [created.id, flow.course.id]);
    t.require(enrollment, 'La inscripción no quedó en la base');
    t.equal([enrollment.estado, enrollment.fecha], ['ACTIVA', t.today], 'La inscripción es activa y de hoy');

    await t.step('Imprimir comprobante', async () => {
      await ui.dismissToasts();
      await ui.waitFor(`document.querySelector('tr[data-enrollment-id="${enrollment.id}"]')`, { message: 'La inscripción nueva no aparece en la tabla' });
      await ui.click(`tr[data-enrollment-id="${enrollment.id}"] [data-action="print"]`);
      const ok = await waitUntil(() => t.openedPaths.length > 0, 15000);
      t.require(ok, 'Imprimir no abrió el comprobante');
      await ui.idle();
    });
    const file = t.openedPaths[0].filePath;
    t.check(fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-', 'El comprobante es un PDF', file);
    Object.assign(flow, { student: created, enrollment });
    await logoutViaUi(t);
  });

  test('teacher', 'El profesor ve la asignación y al alumno, crea una evaluación de hoy y le carga una nota que persiste', { minimal: true }, async (t) => {
    t.require(flow.enrollment, 'Falló un paso anterior: no hay inscripción');
    const { ui } = t;
    await loginViaUi(t, t.data.teacher);
    const title = 'Evaluación del flujo con interfaz';

    await t.step('Asignación y alumnos', async () => {
      await ui.waitFor(`document.querySelector('tr[data-assignment-id="${flow.assignment.id}"]')`, { message: 'La asignación no aparece en el listado del profesor' });
      await ui.click(`tr[data-assignment-id="${flow.assignment.id}"] a.manage-link`);
      t.require(await ui.waitForView('teacher/assignment-management/index.html'), 'Gestionar no abrió la asignación');
      await ui.idle();
      await ui.click('.option-item[href*="assignment-students"]');
      t.require(await ui.waitForView('teacher/assignment-students/index.html'), 'No se abrió Alumnos');
      await ui.idle();
      t.check(await ui.exists(`tr[data-enrollment-id="${flow.enrollment.id}"]`), 'El alumno inscripto aparece en Alumnos');
      await ui.click('.breadcrumb a[href*="assignment-management"]');
      t.require(await ui.waitForView('teacher/assignment-management/index.html'), 'La miga de pan no volvió a la asignación');
      await ui.idle();
    });

    await t.step('Nueva evaluación de hoy', async () => {
      await ui.click('.option-item[href*="assignment-evaluations"]');
      t.require(await ui.waitForView('teacher/assignment-evaluations/index.html'), 'No se abrió Evaluaciones');
      await ui.idle();
      await ui.click('#openNewEvaluationModalBtn');
      await ui.waitModal('#evaluationOverlay', true);
      await ui.fill('#evaluationTitleInput', title);
      await ui.fill('#evaluationDateInput', toDayMonth(t.today).replace('/', ''));
      await waitEnabled(t, '#saveEvaluationBtn', 'Crear evaluación');
      await ui.click('#saveEvaluationBtn', { scroll: false });
      await ui.waitModal('#evaluationOverlay', false);
      await ui.idle();
    });
    const evaluation = await t.sqlOne(`
      SELECT evaluacion_id AS id, to_char(fecha_evaluacion, 'YYYY-MM-DD') AS fecha FROM evaluacion
       WHERE asignacion_docente_id = $1 AND titulo = $2 AND fecha_eliminacion IS NULL`, [flow.assignment.id, title]);
    t.require(evaluation, 'La evaluación no quedó en la base');
    t.equal(evaluation.fecha, t.today, 'La evaluación es de hoy');

    const input = `tr[data-enrollment-id="${flow.enrollment.id}"] .numeric-stepper-input`;
    await t.step('Cargar la nota', async () => {
      await ui.dismissToasts();
      await ui.click(`tr[data-evaluation-id="${evaluation.id}"] a.manage-link`);
      t.require(await ui.waitForView('teacher/evaluation-scores/index.html'), 'Gestionar no abrió las calificaciones');
      await ui.idle();
      await ui.fill(input, '8');
      await ui.press('Enter');
      const saved = await waitUntil(async () => (await t.sql(`
        SELECT 1 FROM calificacion WHERE evaluacion_id = $1 AND inscripcion_id = $2 AND fecha_eliminacion IS NULL AND nota = 8`,
      [evaluation.id, flow.enrollment.id])).length === 1, 8000);
      t.require(saved, 'La nota no quedó en la base');
      await ui.idle();
    });

    await t.step('La nota persiste al volver a abrir la vista', async () => {
      const current = ui.view();
      await ui.navigate(`${current}?${new URL(ui.url()).searchParams.toString()}`);
      const value = await ui.value(input);
      t.equal(Number(String(value).replace(',', '.')), 8, 'El campo muestra la nota guardada');
    });
    await logoutViaUi(t);
  });
});
