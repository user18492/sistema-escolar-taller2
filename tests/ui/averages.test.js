// Capa ui: promedios en Alumnos del Profesor (plans/promedios/03-promedios-profesor.md). Cada fila
// suma los tres trimestres y el anual, con el número en es-AR y la marca Parcial o Final debajo, y
// una raya con su title donde no hay evaluaciones tomadas. Con el reloj de la base fijado como en
// main.teacher: datos del 01/01 del ciclo actual vistos el 09/06, con el 1.er trimestre ya cerrado y
// el 2.º abierto.
// Desde Inscripciones del Secretario, Ver promedios abre la vista Promedios de la inscripción
// (plans/promedios/04-promedios-secretario.md), con una fila por materia con docente en su curso, y
// el breadcrumb vuelve a Inscripciones; en una cancelada, Ver promedios está deshabilitado.
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar, rowActionsState } = require('./helpers');

const STUDENTS_VIEW = 'teacher/assignment-students/index.html';
const ENROLLMENTS_VIEW = 'secretary/enrollments/index.html';
const ENROLLMENT_AVERAGES_VIEW = 'secretary/enrollment-averages/index.html';

group('ui.averages', 'Alumnos: promedios trimestrales y anuales', {
  async setup({ fixtures }) {
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    // Creados el 01/01: una evaluación de ese día, calificada con 7,5
    return fixtures.onDate(`${fixtures.year}-01-01`, async () => {
      const course = await fixtures.createCourse({ institutionId: teacher.institutionId });
      const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const student = await fixtures.createStudent({ institutionId: teacher.institutionId });
      const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
      const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
      await fixtures.score({ evaluationId, enrollmentId, value: 7.5 });
      return { teacher, assignment, enrollmentId };
    });
  },
}, () => {
  test('columns', 'Alumnos muestra los promedios de cada trimestre y el anual, con su marca, y una raya donde no hay evaluaciones', async (t) => {
    const { ui } = t;
    const { teacher, assignment, enrollmentId } = t.data;
    const row = `tr[data-enrollment-id="${enrollmentId}"]`;

    await loginViaUi(t, teacher);
    await t.fixtures.onDate(`${t.year}-06-09`, async () => {
      const query = new URLSearchParams({ assignmentId: String(assignment.id) });
      t.require(await ui.navigate(`${STUDENTS_VIEW}?${query}`) === STUDENTS_VIEW, 'No se abrió Alumnos');
      await ui.waitFor(`document.querySelector('${row} term-average[value]')`, { message: 'La fila del alumno no muestra su promedio' });
      const view = await ui.js(`(() => {
        const headers = Array.from(document.querySelectorAll('.data-table thead th'), (th) => th.textContent.trim().replace(/\\s+/g, ' '));
        const averages = Array.from(document.querySelectorAll('${row} term-average'), (average) => ({
          text: average.innerText.trim().replace(/\\s+/g, ' '),
          title: average.title,
        }));
        return { headers: headers.slice(-4), averages };
      })()`);
      t.equal(view.headers, ['1.er trimestre', '2.º trimestre', '3.er trimestre', 'Anual'], 'Columnas de los promedios, después de Fecha de inscripción');
      const noValue = { text: '—', title: 'Sin evaluaciones tomadas' };
      t.equal(view.averages, [
        { text: '7,50 Final', title: '' },
        noValue,
        noValue,
        { text: '7,50 Parcial', title: '' },
      ], 'El 1.er trimestre cerrado es Final, el anual sigue Parcial y los trimestres sin evaluaciones muestran una raya');
    });
    await logoutViaUi(t);
  });
});

group('ui.enrollment-averages', 'Inscripciones: promedios de una inscripción', {
  async setup({ fixtures }) {
    // Primeros por apellido: sus inscripciones quedan en la primera página del listado. Una
    // evaluación de hoy, calificada en la activa; la otra inscripción está cancelada
    const course = await fixtures.createCourse();
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
    const active = await fixtures.enroll({
      studentId: (await fixtures.createStudent({ lastName: 'Aaapromedio' })).id, courseId: course.id,
    });
    await fixtures.score({ evaluationId, enrollmentId: active, value: 9 });
    const cancelled = await fixtures.enroll({
      studentId: (await fixtures.createStudent({ lastName: 'Aaacancelada' })).id, courseId: course.id, status: 'CANCELADA',
    });
    return { assignment, active, cancelled };
  },
}, () => {
  test('open-and-back', 'Ver promedios abre los promedios de una inscripción activa, está deshabilitado en una cancelada y el breadcrumb vuelve a Inscripciones', async (t) => {
    const { ui } = t;
    const { assignment, active, cancelled } = t.data;
    const averagesButton = (enrollmentId) => `tr[data-enrollment-id="${enrollmentId}"] [data-action="averages"]`;

    await loginViaUi(t, SEED_USERS.secretary);
    await openFromSidebar(t, ENROLLMENTS_VIEW);
    await ui.waitFor(`document.querySelector('${averagesButton(active)}') && document.querySelector('${averagesButton(cancelled)}')`,
      { message: 'Las inscripciones del setup no aparecen en la primera página de Inscripciones' });

    await t.step('Ver promedios en cada estado', async () => {
      const activeAverages = (await rowActionsState(t, `tr[data-enrollment-id="${active}"]`)).averages;
      const cancelledAverages = (await rowActionsState(t, `tr[data-enrollment-id="${cancelled}"]`)).averages;
      t.equal(activeAverages.disabled, false, 'En la activa, Ver promedios está habilitado');
      t.check(cancelledAverages.disabled && cancelledAverages.title !== cancelledAverages.label,
        'En la cancelada, Ver promedios está deshabilitado y dice el motivo', cancelledAverages);
    });

    await t.step('Vista Promedios', async () => {
      await ui.click(averagesButton(active));
      t.require(await ui.waitForView(ENROLLMENT_AVERAGES_VIEW), 'Ver promedios no abrió la vista Promedios', ui.view());
      t.equal(new URL(ui.url()).searchParams.get('enrollmentId'), String(active), 'La vista recibe el id de la inscripción');
      await ui.waitFor(`document.querySelector('tr[data-subject] term-average[value]')`, { message: 'La vista no muestra los promedios de la inscripción' });
      const expectedSubjects = await t.sql(`
        SELECT m.nombre FROM asignacion_docente a JOIN grado_materia gm USING (grado_materia_id) JOIN materia m USING (materia_id)
         WHERE a.curso_id = (SELECT curso_id FROM inscripcion WHERE inscripcion_id = $1) AND a.fecha_eliminacion IS NULL`, [active]);
      const view = await ui.js(`(() => ({
        subjects: Array.from(document.querySelectorAll('tr[data-subject]'), (row) => row.dataset.subject),
        averages: Array.from(document.querySelectorAll('tr[data-subject="${assignment.name}"] term-average'), (average) => average.getAttribute('value')),
        errorHidden: document.getElementById('enrollmentLoadError').hidden,
      }))()`);
      t.equal(view.subjects.slice().sort(), expectedSubjects.map((row) => row.nombre).sort(), 'Una fila por materia con docente en el curso');
      t.check(view.averages.includes('9'), 'La materia de la evaluación calificada muestra su promedio', view.averages);
      t.equal(view.errorHidden, true, 'Sin mensaje de error');
    });

    await t.step('Breadcrumb', async () => {
      await ui.click('.breadcrumb a[href$="enrollments/index.html"]');
      t.require(await ui.waitForView(ENROLLMENTS_VIEW), 'El breadcrumb no volvió a Inscripciones', ui.view());
      await ui.waitFor(`document.querySelector('${averagesButton(active)}')`, { message: 'Inscripciones no volvió a cargar la tabla' });
    });
    await logoutViaUi(t);
  });

  test('cancelled-error', 'Abierta con una inscripción cancelada, la vista Promedios oculta la tarjeta y la tabla y muestra el error', async (t) => {
    const { ui } = t;
    await loginViaUi(t, SEED_USERS.secretary);
    t.allowRejection('enrollments:get-averages', 'ENROLLMENT_CANCELLED', 'La vista se abre con el id de una inscripción cancelada');
    t.allow('ui-error', /enrollmentLoadError/, 'El mensaje de error de la carga es lo que se comprueba');
    const query = new URLSearchParams({ enrollmentId: String(t.data.cancelled) });
    t.require(await ui.navigate(`${ENROLLMENT_AVERAGES_VIEW}?${query}`) === ENROLLMENT_AVERAGES_VIEW, 'No se abrió la vista Promedios');
    await ui.waitFor(`!document.getElementById('enrollmentLoadError').hidden`, { message: 'La vista no mostró el error' });
    t.equal(await ui.js(`({
      summary: document.querySelector('.enrollment-summary').hidden,
      table: document.querySelector('.averages-card').hidden,
    })`), { summary: true, table: true }, 'La tarjeta y la tabla quedan ocultas');
    await logoutViaUi(t);
  });
});
