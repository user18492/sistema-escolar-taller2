// Capa ui: Inscripciones del Secretario. Una inscripción pasa a finalizada solo con el cierre del
// ciclo lectivo: al editarla, Estado ofrece solo Activa y Cancelada
// (plans/secretario-inscripciones/00-estado-y-fecha.md).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar, pickDropdown, waitEnabled } = require('./helpers');

const STATUS_FIELD = '[data-filter="edit-enrollment-status"]';

group('ui.enrollments', 'Inscripciones: edición y baja', {
  async setup({ fixtures }) {
    // Primero por apellido: su inscripción queda en la primera página del listado
    const student = await fixtures.createStudent({ lastName: 'Aaaeditable' });
    const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: (await fixtures.createCourse()).id });
    return { editable: { student, enrollmentId } };
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
});
