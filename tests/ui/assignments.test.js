// Capa ui: Docencia del Administrador. Una asignación no se edita con un profesor suspendido, aunque
// sea el que ya tiene: el formulario no lo ofrece y hay que elegir otro (plans/administrador-usuarios.md).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar, pickSearchable, waitEnabled } = require('./helpers');

const TEACHER_SELECT = '[data-role="teacher-select"]';

group('ui.assignments', 'Docencia: edición de asignaciones', {
  async setup({ fixtures, client }) {
    // Primero por apellido: su asignación queda en la primera página del listado
    const suspendedTeacher = await fixtures.createUser({ role: 'PROFESOR', lastName: 'Aaasuspendido' });
    const assignment = await fixtures.assign({ teacherId: suspendedTeacher.id, courseId: (await fixtures.createCourse()).id });
    // La base no le crea asignaciones a un suspendido: se lo suspende después
    await client.query(`UPDATE usuario SET estado = false WHERE usuario_id = $1`, [suspendedTeacher.id]);
    const otherTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    return { suspendedTeacher, assignment, otherTeacher };
  },
}, () => {
  test('edit-suspended-teacher', 'Editar la asignación de un profesor suspendido deja Profesor vacío y sin él; con otro profesor activo se guarda', async (t) => {
    const { ui } = t;
    const { suspendedTeacher, assignment, otherTeacher } = t.data;
    const editButton = `tr[data-assignment-id="${assignment.id}"] [data-action="edit"]`;
    await loginViaUi(t, SEED_USERS.admin);
    await openFromSidebar(t, 'admin/assignments/index.html');
    await ui.waitFor(`document.querySelector('${editButton}')`, { message: 'La asignación del profesor suspendido no aparece en la primera página' });
    await ui.waitFor(`document.querySelectorAll('${TEACHER_SELECT} .dropdown-option').length > 0`, { message: 'No cargaron los profesores del formulario' });

    await t.step('Editar', async () => {
      await ui.click(editButton);
      await ui.waitModal('#newAssignmentOverlay', true);
      await ui.waitFor(`document.querySelector('[data-filter="new-assignment-subject"] .dropdown-option.selected')`, { message: 'La materia de la asignación no quedó elegida' });
      const teacherField = await ui.js(`(() => {
        const root = document.querySelector('${TEACHER_SELECT}');
        return {
          selected: root.querySelectorAll('.dropdown-option.selected').length,
          hasValue: root.querySelector('.searchable-bar').classList.contains('has-value'),
          offersSuspended: Boolean(root.querySelector('.dropdown-option[data-value="${suspendedTeacher.id}"]')),
        };
      })()`);
      t.equal(teacherField, { selected: 0, hasValue: false, offersSuspended: false }, 'Profesor queda vacío y no ofrece al suspendido');
      t.check(await ui.js(`document.getElementById('createAssignmentBtn').disabled`), 'Guardar sigue deshabilitado sin profesor');
    });

    await t.step('Reemplazar y guardar', async () => {
      await pickSearchable(t, TEACHER_SELECT, otherTeacher.id, otherTeacher.lastName);
      await waitEnabled(t, '#createAssignmentBtn', 'Guardar');
      await ui.click('#createAssignmentBtn', { scroll: false });
      await ui.waitModal('#newAssignmentOverlay', false);
      await ui.idle();
    });
    t.equal(await t.sqlOne(`
      SELECT usuario_id, curso_id, grado_materia_id, fecha_eliminacion FROM asignacion_docente WHERE asignacion_docente_id = $1`, [assignment.id]),
    { usuario_id: otherTeacher.id, curso_id: assignment.courseId, grado_materia_id: assignment.gradeSubjectId, fecha_eliminacion: null },
    'La asignación quedó con el profesor elegido, con su curso y su materia');
    await logoutViaUi(t);
  });
});
