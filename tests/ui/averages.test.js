// Capa ui: promedios en Alumnos del Profesor (plans/promedios/03-promedios-profesor.md). Cada fila
// suma los tres trimestres y el anual, con el número en es-AR y la marca Parcial o Final debajo, y
// una raya con su title donde no hay evaluaciones tomadas. Con el reloj de la base fijado como en
// main.teacher: datos del 01/01 del ciclo actual vistos el 09/06, con el 1.er trimestre ya cerrado y
// el 2.º abierto.
const { group, test } = require('../lib/framework');
const { loginViaUi, logoutViaUi } = require('./helpers');

const STUDENTS_VIEW = 'teacher/assignment-students/index.html';

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
