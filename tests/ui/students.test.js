// Capa ui: Alumnos del Secretario. Un alumno con una inscripción activa no pasa a egresado: al
// editarlo, la opción Egresado queda deshabilitada, con una aclaración debajo de Estado
// (plans/secretario-alumnos/01-vistas.md).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar } = require('./helpers');

const STATUS_FIELD = '#editStudentStatusField';

group('ui.students', 'Alumnos: egreso con una inscripción activa', {
  async setup({ fixtures }) {
    // Primeros por apellido: los dos quedan en la primera página del listado
    const enrolledStudent = await fixtures.createStudent({ lastName: 'Aaainscripto' });
    await fixtures.enroll({ studentId: enrolledStudent.id, courseId: (await fixtures.createCourse()).id });
    const freeStudent = await fixtures.createStudent({ lastName: 'Aaalibre' });
    return { enrolledStudent, freeStudent };
  },
}, () => {
  test('graduate-locked', 'Un alumno con una inscripción activa tiene Egresado deshabilitado, con la aclaración; uno sin ella pasa a egresado', async (t) => {
    const { ui } = t;
    const { enrolledStudent, freeStudent } = t.data;
    const editButton = (student) => `tr[data-student-id="${student.id}"] [data-action="edit"]`;
    // Egresado, la opción elegida y la aclaración del campo Estado
    const statusField = () => ui.js(`(() => {
      const field = document.querySelector('${STATUS_FIELD}');
      const hint = document.getElementById('editStudentStatusHint');
      return {
        graduatedDisabled: field.querySelector('.dropdown-option[data-value="GRADUATED"]').getAttribute('aria-disabled') === 'true',
        selected: field.querySelector('.dropdown-option.selected')?.dataset.value ?? null,
        hintVisible: !hint.hidden && hint.offsetParent !== null,
        hintHasText: hint.textContent.trim().length > 0,
      };
    })()`);
    await loginViaUi(t, SEED_USERS.secretary);
    await openFromSidebar(t, 'secretary/students/index.html');
    await ui.waitFor(`document.querySelector('${editButton(enrolledStudent)}') && document.querySelector('${editButton(freeStudent)}')`, { message: 'Los alumnos del setup no aparecen en la primera página de Alumnos' });

    await t.step('Con inscripción activa', async () => {
      await ui.click(editButton(enrolledStudent));
      await ui.waitModal('#newStudentOverlay', true);
      t.equal(await statusField(), { graduatedDisabled: true, selected: 'ACTIVE', hintVisible: true, hintHasText: true },
        'Egresado está deshabilitado, con Activo elegido y la aclaración visible');
      await ui.click(`${STATUS_FIELD} .dropdown-toggle`);
      await ui.chooseOption(`${STATUS_FIELD} .dropdown-option[data-value="GRADUATED"]`);
      t.equal((await statusField()).selected, 'ACTIVE', 'El clic en Egresado no la elige: sigue Activo');
      // La lista sigue abierta y tapa el pie del modal: Escape la cierra sin cerrar el modal
      await ui.press('Escape');
      await ui.click('#cancelNewStudentBtn', { scroll: false });
      await ui.waitModal('#newStudentOverlay', false);
    });

    await t.step('Sin inscripción activa', async () => {
      await ui.click(editButton(freeStudent));
      await ui.waitModal('#newStudentOverlay', true);
      const { graduatedDisabled, hintVisible } = await statusField();
      t.equal({ graduatedDisabled, hintVisible }, { graduatedDisabled: false, hintVisible: false },
        'Egresado está habilitado y no hay aclaración, aunque antes se abrió el alumno inscripto');
      await ui.click(`${STATUS_FIELD} .dropdown-toggle`);
      await ui.chooseOption(`${STATUS_FIELD} .dropdown-option[data-value="GRADUATED"]`);
      t.equal((await statusField()).selected, 'GRADUATED', 'Egresado queda elegido');
      await ui.click('#createStudentBtn', { scroll: false });
      await ui.waitModal('#newStudentOverlay', false);
      await ui.idle();
      t.equal(await t.sqlOne(`
        SELECT (SELECT e.nombre FROM alumno a JOIN alumno_estado e USING (alumno_estado_id) WHERE a.alumno_id = $1) AS free,
               (SELECT e.nombre FROM alumno a JOIN alumno_estado e USING (alumno_estado_id) WHERE a.alumno_id = $2) AS enrolled`,
      [freeStudent.id, enrolledStudent.id]),
      { free: 'EGRESADO', enrolled: 'ACTIVO' },
      'El alumno sin inscripción activa quedó egresado y el inscripto sigue activo');
    });
    await logoutViaUi(t);
  });
});
