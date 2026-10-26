// Capa ui: lo de un ciclo lectivo cerrado se ve en solo lectura (plans/ciclo-lectivo/02-renderer.md).
// Los datos del ciclo cerrado se cargan con fixtures.inSchoolYear y, como la capa no arranca main.js,
// el cierre no corre: la inscripción del ciclo cerrado sigue activa.
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar } = require('./helpers');

// Estado de los botones de acción de la fila con ese selector: { print, edit, delete }, cada uno
// { disabled, title, label } (label es su aria-label), o null si la fila no está
const rowActionsState = (t, rowSelector) => t.ui.js(`(() => {
  const row = document.querySelector(${JSON.stringify(rowSelector)});
  if (!row) return null;
  return Object.fromEntries(Array.from(row.querySelectorAll('[data-action]'), (button) => [
    button.dataset.action,
    { disabled: button.disabled, title: button.title, label: button.getAttribute('aria-label') },
  ]));
})()`);

group('ui.school-year', 'Ciclo lectivo: lo de un ciclo cerrado en solo lectura', {
  async setup({ fixtures }) {
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const closedYear = fixtures.year - 1;
    // Primeros por apellido: las dos inscripciones quedan en la primera página del listado
    const currentStudent = await fixtures.createStudent({ lastName: 'Aaactual' });
    const currentEnrollmentId = await fixtures.enroll({ studentId: currentStudent.id, courseId: (await fixtures.createCourse()).id });
    const closed = await fixtures.inSchoolYear(closedYear, async () => {
      const course = await fixtures.createCourse();
      const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const student = await fixtures.createStudent({ lastName: 'Aacerrado' });
      const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
      return { assignment, enrollmentId };
    });
    return { teacher, closedYear, currentEnrollmentId, ...closed };
  },
}, () => {
  test('closed-read-only', 'Inscripciones y Evaluaciones muestran lo de un ciclo cerrado con Editar, Eliminar y Nueva evaluación deshabilitados', async (t) => {
    const { ui } = t;
    const { teacher, closedYear, currentEnrollmentId, assignment, enrollmentId } = t.data;

    await t.step('Inscripciones', async () => {
      await loginViaUi(t, SEED_USERS.secretary);
      await openFromSidebar(t, 'secretary/enrollments/index.html');
      const closedRow = `tr[data-enrollment-id="${enrollmentId}"]`;
      await ui.waitFor(`document.querySelector('${closedRow} [data-action="edit"]')`, { message: 'La inscripción del ciclo cerrado no aparece en la primera página' });
      const closedActions = await rowActionsState(t, closedRow);
      for (const action of ['edit', 'delete']) {
        const { disabled, title, label } = closedActions[action];
        t.check(disabled, `${label}: deshabilitado en una inscripción del ciclo cerrado`, closedActions[action]);
        t.check(title !== label && title.includes(String(closedYear)), `${label}: el title explica que el ciclo ${closedYear} está cerrado`, closedActions[action]);
      }
      t.check(!closedActions.print.disabled, 'Imprimir sigue habilitado en una inscripción del ciclo cerrado', closedActions.print);

      const currentActions = await rowActionsState(t, `tr[data-enrollment-id="${currentEnrollmentId}"]`);
      t.require(currentActions, 'La inscripción del ciclo actual no aparece en la primera página');
      t.check(['print', 'edit', 'delete'].every((action) => !currentActions[action].disabled), 'Las acciones de una inscripción del ciclo actual siguen habilitadas', currentActions);
      await logoutViaUi(t);
    });

    await t.step('Evaluaciones de una asignación del ciclo cerrado', async () => {
      await loginViaUi(t, teacher);
      await ui.waitFor(`document.querySelector('tr[data-assignment-id="${assignment.id}"]')`, { message: 'La asignación del ciclo cerrado no aparece en el listado del profesor' });
      await ui.click(`tr[data-assignment-id="${assignment.id}"] a.manage-link`);
      t.require(await ui.waitForView('teacher/assignment-management/index.html'), 'Gestionar no abrió la asignación');
      await ui.idle();
      await ui.click('.option-item[href*="assignment-evaluations"]');
      t.require(await ui.waitForView('teacher/assignment-evaluations/index.html'), 'No se abrió Evaluaciones');
      await ui.idle();
      await ui.waitFor(`document.getElementById('openNewEvaluationModalBtn').disabled`, { message: 'Nueva evaluación sigue habilitado en una asignación del ciclo cerrado' });
      const title = await ui.js(`document.getElementById('openNewEvaluationModalBtn').title`);
      t.check(title.includes(String(closedYear)), `Nueva evaluación: el title explica que el ciclo ${closedYear} está cerrado`, title);
    });
  });
});
