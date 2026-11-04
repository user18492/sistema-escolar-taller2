// Capa ui: bugs conocidos que siguen sin corregir. Cada prueba comprueba el comportamiento correcto
// y lleva knownFailure con su motivo y vencimiento: mientras el bug siga, el informe la cuenta como
// falla conocida; si deja de fallar, avisa que hay que quitar la marca. No registran el bug como
// comportamiento correcto.
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, openFromSidebar, pickDropdown, waitEnabled } = require('./helpers');

group('ui.known-bugs', 'Bugs conocidos sin corregir', {
  async setup({ fixtures }) {
    const course = await fixtures.createCourse();
    // Primero por apellido: la inscripción queda en la primera página del listado
    const student = await fixtures.createStudent({ lastName: 'Aaprimera' });
    const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
    return { course, student, enrollmentId };
  },
}, () => {
  test('column-filter-enter', 'Enter en el campo de texto de un filtro de columna cierra el panel y lo deja cerrado', {
    knownFailure: {
      reason: 'column-filter.js: el Enter cierra el panel, mueve el foco al botón del filtro y el keypress siguiente lo vuelve a abrir (bug previo, sin corregir).',
      until: '2026-12-31',
      ref: 'memoria: column-filter-enter-reopen-bug',
    },
  }, async (t) => {
    const { ui } = t;
    await loginViaUi(t, SEED_USERS.admin);
    await openFromSidebar(t, 'admin/courses/index.html');
    await ui.click('th[data-filter="division"] .column-filter-toggle');
    await ui.waitFor(`document.getElementById('divisionFilter').matches(':popover-open')`, { message: 'No se abrió el filtro de división' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await ui.type('A');
    await ui.press('Enter');
    await new Promise((resolve) => setTimeout(resolve, 400));
    t.check(!(await ui.js(`document.getElementById('divisionFilter').matches(':popover-open')`)), 'El panel del filtro volvió a abrirse después de Enter');
  });

  test('grade-filter-keyboard', 'Marcar un nivel del filtro de grado con el teclado filtra la tabla, como el clic', {
    knownFailure: {
      reason: 'grade-dropdown.js: Espacio o Enter sobre la fila de un nivel marca sus grados pero no emite column-filter-change, así que la tabla no se filtra hasta el próximo cambio (hallazgo previo, sin corregir).',
      until: '2026-12-31',
      ref: 'memoria: teacher-assignment-list-criteria',
    },
  }, async (t) => {
    const { ui } = t;
    await loginViaUi(t, SEED_USERS.admin);
    await openFromSidebar(t, 'admin/courses/index.html');
    await ui.click('th[data-filter="grade"] .column-filter-toggle');
    await ui.waitFor(`document.getElementById('gradeFilter').matches(':popover-open')`, { message: 'No se abrió el filtro de grado' });
    await ui.js(`document.querySelector('#gradeFilter [data-level-header="PRIMARY"]').focus(); true`);
    await ui.press('Space');
    await ui.idle();
    const secondary = await t.sql(`
      SELECT c.curso_id FROM curso c JOIN grado g USING (grado_id) WHERE g.nivel_educativo = 'SECUNDARIA'
         AND c.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8') AND c.fecha_eliminacion IS NULL`);
    const shown = await ui.js(`Array.from(document.querySelectorAll('tr[data-course-id]'), (row) => Number(row.dataset.courseId))`);
    const secondaryIds = new Set(secondary.map((row) => row.curso_id));
    t.check(shown.length > 0 && shown.every((id) => !secondaryIds.has(id)), 'La tabla sigue mostrando cursos de secundaria con solo Primaria marcada', { shown });
  });

  test('enrollment-edit-refreshes-create-list', 'Después de cancelar una inscripción desde Editar, el alta ofrece a su alumno', {
    knownFailure: {
      reason: 'enrollments.js: una edición que cambia el estado a o desde Activa no invalida la lista de alumnos del alta, que queda vieja hasta recargar la vista (problema previo, avisado y sin corregir).',
      until: '2026-12-31',
      ref: 'memoria: one-active-enrollment-not-deleted',
    },
  }, async (t) => {
    const { ui } = t;
    const { enrollmentId, student } = t.data;
    await loginViaUi(t, SEED_USERS.secretary);
    await openFromSidebar(t, 'secretary/enrollments/index.html');
    // Abre el alta una vez para que cargue su lista (sin el alumno, que tiene una activa)
    await ui.click('#openNewEnrollmentModalBtn');
    await ui.waitModal('#newEnrollmentOverlay', true);
    await ui.click('#cancelNewEnrollmentBtn', { scroll: false });
    await ui.waitModal('#newEnrollmentOverlay', false);
    // La cancela desde Editar
    await ui.waitFor(`document.querySelector('tr[data-enrollment-id="${enrollmentId}"]')`, { message: 'La inscripción no aparece en su página' });
    await ui.click(`tr[data-enrollment-id="${enrollmentId}"] [data-action="edit"]`);
    await ui.waitModal('#editEnrollmentOverlay', true);
    await pickDropdown(t, '[data-filter="edit-enrollment-status"]', 'CANCELLED');
    await waitEnabled(t, '#saveEnrollmentBtn', 'Guardar');
    await ui.click('#saveEnrollmentBtn', { scroll: false });
    await ui.waitModal('#editEnrollmentOverlay', false);
    await ui.idle();
    t.equal((await t.sqlOne(`SELECT e.nombre FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id) WHERE i.inscripcion_id = $1`, [enrollmentId])).nombre,
      'CANCELADA', 'La edición canceló la inscripción');
    await ui.dismissToasts();
    await ui.click('#openNewEnrollmentModalBtn');
    await ui.waitModal('#newEnrollmentOverlay', true);
    t.check(await ui.exists(`[data-role="new-enrollment-student-select"] .dropdown-option[data-value="${student.id}"]`), 'El alumno de la inscripción cancelada no se ofrece en el alta');
  });

  test('modal-resize-console', 'Los errores de validación de un modal no dejan errores en la consola', {
    knownFailure: {
      reason: 'modal-resize.js emite "ResizeObserver loop completed with undelivered notifications" cada vez que cambia el alto de un modal (problema previo, sin corregir). known-issues.js lo tolera en las demás pruebas.',
      until: '2026-12-31',
      ref: 'memoria: form-validation-plan-status',
    },
  }, async (t) => {
    const { ui } = t;
    await loginViaUi(t, SEED_USERS.secretary);
    await openFromSidebar(t, 'secretary/students/index.html');
    const events = await t.detect(async () => {
      await ui.click('#openNewStudentModalBtn');
      await ui.waitModal('#newStudentOverlay', true);
      // Datos inválidos en todos los campos: los errores cambian el alto del modal
      for (const id of ['newStudentFirstName', 'newStudentLastName', 'newStudentDni', 'newStudentEmail', 'newStudentPhone']) {
        await ui.fill(`#${id}`, id === 'newStudentEmail' ? 'no-es-email' : '1');
        await ui.press('Tab');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const errors = events.filter((event) => event.type === 'console' && event.source === 'renderer');
    t.check(errors.length === 0, 'La consola del renderer registró errores al cambiar el alto del modal', errors.map((event) => event.message));
  });
});
