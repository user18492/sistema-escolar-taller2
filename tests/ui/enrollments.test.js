// Capa ui: Inscripciones del Secretario. Una inscripción pasa a finalizada solo con el cierre del
// ciclo lectivo: al editarla, Estado ofrece solo Activa y Cancelada
// (plans/secretario-inscripciones/00-estado-y-fecha.md). Una con calificaciones no se elimina: su
// Eliminar está deshabilitado, con el motivo (plans/secretario-inscripciones/01-baja.md).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar, pickDropdown, waitEnabled } = require('./helpers');

const STATUS_FIELD = '[data-filter="edit-enrollment-status"]';

group('ui.enrollments', 'Inscripciones: edición y baja', {
  async setup({ fixtures }) {
    // Primero por apellido: su inscripción queda en la primera página del listado
    const student = await fixtures.createStudent({ lastName: 'Aaaeditable' });
    const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: (await fixtures.createCourse()).id });
    // Un curso con una evaluación de hoy y dos alumnos activos, también primeros por apellido: uno
    // con una nota y otro sin ninguna
    const course = await fixtures.createCourse();
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
    const scoredStudent = await fixtures.createStudent({ lastName: 'Aaacalificado' });
    const scoredEnrollmentId = await fixtures.enroll({ studentId: scoredStudent.id, courseId: course.id });
    await fixtures.score({ evaluationId, enrollmentId: scoredEnrollmentId });
    const unscoredStudent = await fixtures.createStudent({ lastName: 'Aaasinnotas' });
    const unscoredEnrollmentId = await fixtures.enroll({ studentId: unscoredStudent.id, courseId: course.id });
    return {
      editable: { student, enrollmentId },
      scored: { student: scoredStudent, enrollmentId: scoredEnrollmentId },
      unscored: { student: unscoredStudent, enrollmentId: unscoredEnrollmentId },
    };
  },
}, () => {
  test('edit-statuses', 'Editar ofrece solo Activa y Cancelada, con el estado actual marcado, y guarda el cambio', async (t) => {
    const { ui } = t;
    const { enrollmentId } = t.data.editable;
    const editButton = `tr[data-enrollment-id="${enrollmentId}"] [data-action="edit"]`;
    await loginViaUi(t, SEED_USERS.secretary);
    await openFromSidebar(t, 'secretary/enrollments/index.html');
    await ui.waitFor(`document.querySelector('${editButton}')`, { message: 'La inscripción del setup no aparece en la primera página de Inscripciones' });

    await ui.click(editButton);
    await ui.waitModal('#editEnrollmentOverlay', true);
    // Estado queda bloqueado hasta que llega la inscripción
    await ui.waitFor(`document.querySelector('${STATUS_FIELD} .dropdown-option.selected')`, { message: 'Editar no marcó el estado de la inscripción' });
    const options = await ui.js(`Array.from(document.querySelectorAll('${STATUS_FIELD} .dropdown-option'),
      (option) => ({ value: option.dataset.value, selected: option.classList.contains('selected') }))`);
    t.equal(options, [{ value: 'ACTIVE', selected: true }, { value: 'CANCELLED', selected: false }],
      'Estado ofrece Activa y Cancelada, con Activa marcada');

    await pickDropdown(t, STATUS_FIELD, 'CANCELLED');
    await waitEnabled(t, '#saveEnrollmentBtn', 'Guardar');
    await ui.click('#saveEnrollmentBtn', { scroll: false });
    await ui.waitModal('#editEnrollmentOverlay', false);
    await ui.idle();
    t.equal((await t.sqlOne(`SELECT e.nombre FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.inscripcion_id = $1`, [enrollmentId])).nombre,
      'CANCELADA', 'La inscripción quedó cancelada en la base');
    await logoutViaUi(t);
  });

  test('delete-with-scores', 'Una inscripción con calificaciones tiene Eliminar deshabilitado, con el motivo; una sin ellas se elimina', async (t) => {
    const { ui } = t;
    const { scored, unscored } = t.data;
    const rowAction = (enrollmentId, action) => `tr[data-enrollment-id="${enrollmentId}"] [data-action="${action}"]`;
    // Editar y Eliminar de la fila; Eliminar dice el motivo si su title no es su etiqueta
    const rowButtons = (enrollmentId) => ui.js(`(() => {
      const edit = document.querySelector('${rowAction(enrollmentId, 'edit')}');
      const remove = document.querySelector('${rowAction(enrollmentId, 'delete')}');
      return { editDisabled: edit.disabled, deleteDisabled: remove.disabled, deleteHasReason: remove.title !== remove.getAttribute('aria-label') };
    })()`);
    await loginViaUi(t, SEED_USERS.secretary);
    await openFromSidebar(t, 'secretary/enrollments/index.html');
    await ui.waitFor(`document.querySelector('${rowAction(scored.enrollmentId, 'delete')}') && document.querySelector('${rowAction(unscored.enrollmentId, 'delete')}')`,
      { message: 'Las inscripciones del setup no aparecen en la primera página de Inscripciones' });

    await t.step('Eliminar deshabilitado', async () => {
      t.equal(await rowButtons(scored.enrollmentId), { editDisabled: false, deleteDisabled: true, deleteHasReason: true },
        'Con calificaciones, Eliminar está deshabilitado y dice el motivo; Editar sigue habilitado');
      t.equal((await rowButtons(unscored.enrollmentId)).deleteDisabled, false, 'Sin calificaciones, Eliminar está habilitado');
    });

    await t.step('Eliminar la que no tiene calificaciones', async () => {
      await ui.click(rowAction(unscored.enrollmentId, 'delete'));
      await ui.waitModal('#deleteEnrollmentOverlay', true);
      await ui.click('#confirmDeleteEnrollmentBtn', { scroll: false });
      await ui.waitModal('#deleteEnrollmentOverlay', false);
      await ui.idle();
      await ui.waitFor(`!document.querySelector('tr[data-enrollment-id="${unscored.enrollmentId}"]')`,
        { message: 'La fila de la inscripción eliminada sigue en la tabla' });
    });

    const rows = await t.sql(`
      SELECT inscripcion_id, fecha_eliminacion IS NOT NULL AS baja FROM inscripcion
       WHERE inscripcion_id = ANY($1::INT[]) ORDER BY inscripcion_id`, [[scored.enrollmentId, unscored.enrollmentId]]);
    t.equal(rows, [
      { inscripcion_id: scored.enrollmentId, baja: false },
      { inscripcion_id: unscored.enrollmentId, baja: true },
    ], 'En la base, la sin calificaciones quedó dada de baja y la calificada sigue vigente');
    await logoutViaUi(t);
  });
});
