// Capa ui: Docencia del Administrador. Una asignación no se edita con un profesor suspendido, aunque
// sea el que ya tiene: el formulario no lo ofrece, lo nombra en una aclaración y hay que elegir otro
// (plans/administrador-usuarios.md, plans/administrador-docencia/01-vista-docencia.md). Una
// asignación con evaluaciones no se elimina y, al editarla, solo se cambia el profesor
// (plans/administrador-docencia/01-vista-docencia.md).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { LEVEL } = require('../lib/domain');
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
    // También primero por apellido, y antes que el suspendido: sus dos asignaciones quedan en la
    // primera página. Cada una en un curso propio; solo `evaluated` tiene una evaluación.
    const evaluatedTeacher = await fixtures.createUser({ role: 'PROFESOR', lastName: 'Aaaevaluado' });
    const evaluatedCourse = await fixtures.createCourse();
    const evaluated = await fixtures.assign({ teacherId: evaluatedTeacher.id, courseId: evaluatedCourse.id });
    const evaluationId = await fixtures.createEvaluation({ assignmentId: evaluated.id });
    const unevaluated = await fixtures.assign({ teacherId: evaluatedTeacher.id, courseId: (await fixtures.createCourse()).id });
    return { suspendedTeacher, assignment, otherTeacher, evaluatedTeacher, evaluatedCourse, evaluated, evaluationId, unevaluated };
  },
}, () => {
  test('edit-suspended-teacher', 'Editar la asignación de un profesor suspendido deja Profesor vacío y sin él, con una aclaración que lo nombra; con otro profesor activo se guarda', {
    history: [{ plan: 'plans/administrador-docencia/01-vista-docencia.md', date: '2026-10-27', change: 'En "Editar", además, #newAssignmentTeacherHint está visible y su texto contiene el apellido del profesor suspendido; en "Reemplazar y guardar", después de elegir al otro profesor, queda oculto' }],
  }, async (t) => {
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
      const hint = await ui.js(`(() => {
        const hint = document.getElementById('newAssignmentTeacherHint');
        return { visible: !hint.hidden && hint.offsetParent !== null, text: hint.textContent };
      })()`);
      t.check(hint.visible && hint.text.includes(suspendedTeacher.lastName), 'La aclaración de Profesor se ve y nombra al profesor suspendido', hint);
    });

    await t.step('Reemplazar y guardar', async () => {
      await pickSearchable(t, TEACHER_SELECT, otherTeacher.id, otherTeacher.lastName);
      t.check(await ui.js(`document.getElementById('newAssignmentTeacherHint').hidden`), 'La aclaración de Profesor se oculta al elegir otro profesor');
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

  test('with-evaluations', 'Una asignación con evaluaciones tiene Eliminar deshabilitado y, al editarla, el nivel educativo, el curso y la materia bloqueados con su valor; el profesor se cambia y se guarda', async (t) => {
    const { ui } = t;
    const { otherTeacher, evaluatedTeacher, evaluatedCourse, evaluated, evaluationId, unevaluated } = t.data;
    const rowAction = (assignment, action) => `tr[data-assignment-id="${assignment.id}"] [data-action="${action}"]`;
    // Editar y Eliminar de la fila de `assignment`; Eliminar dice el motivo si su title no es su etiqueta
    const rowButtons = (assignment) => ui.js(`(() => {
      const edit = document.querySelector('${rowAction(assignment, 'edit')}');
      const remove = document.querySelector('${rowAction(assignment, 'delete')}');
      return { editDisabled: edit.disabled, deleteDisabled: remove.disabled, deleteHasReason: remove.title !== remove.getAttribute('aria-label') };
    })()`);
    await loginViaUi(t, SEED_USERS.admin);
    await openFromSidebar(t, 'admin/assignments/index.html');
    await ui.waitFor(`document.querySelector('${rowAction(evaluated, 'edit')}') && document.querySelector('${rowAction(unevaluated, 'edit')}')`, { message: 'Las asignaciones del profesor con evaluaciones no aparecen en la primera página' });
    await ui.waitFor(`document.querySelectorAll('${TEACHER_SELECT} .dropdown-option').length > 0`, { message: 'No cargaron los profesores del formulario' });

    await t.step('Eliminar deshabilitado', async () => {
      t.equal(await rowButtons(evaluated), { editDisabled: false, deleteDisabled: true, deleteHasReason: true },
        'Con evaluaciones, Eliminar está deshabilitado y dice el motivo; Editar sigue habilitado');
      t.equal((await rowButtons(unevaluated)).deleteDisabled, false, 'Sin evaluaciones, Eliminar está habilitado');
    });

    await t.step('Editar', async () => {
      await ui.click(rowAction(evaluated, 'edit'));
      await ui.waitModal('#newAssignmentOverlay', true);
      await ui.waitFor(`document.querySelector('[data-filter="new-assignment-subject"] .dropdown-option.selected')`, { message: 'La materia de la asignación no quedó elegida' });
      const form = await ui.js(`(() => {
        const q = (selector) => document.querySelector(selector);
        const level = q('[data-filter="new-assignment-level"]');
        const course = q('[data-role="course-select"]');
        const subject = q('[data-filter="new-assignment-subject"]');
        const selected = (root) => root.querySelector('.dropdown-option.selected')?.dataset.value ?? null;
        const visible = (selector) => !q(selector).hidden && q(selector).offsetParent !== null;
        return {
          levelDisabled: level.querySelector('.dropdown-toggle').disabled,
          courseLocked: course.classList.contains('is-locked'),
          subjectDisabled: subject.querySelector('.dropdown-toggle').disabled,
          level: selected(level),
          course: selected(course),
          subject: selected(subject),
          teacher: selected(q('${TEACHER_SELECT}')),
          lockedHint: visible('#newAssignmentLockedHint'),
          teacherHint: visible('#newAssignmentTeacherHint'),
        };
      })()`);
      t.equal(form, {
        levelDisabled: true,
        courseLocked: true,
        subjectDisabled: true,
        level: LEVEL[evaluatedCourse.level],
        course: String(evaluated.courseId),
        subject: String(evaluated.subjectId),
        teacher: String(evaluatedTeacher.id),
        lockedHint: true,
        teacherHint: false,
      }, 'Nivel educativo, Curso y Materia quedan bloqueados con el valor de la asignación, con la aclaración, y Profesor tiene al suyo');
    });

    await t.step('Cambiar profesor y guardar', async () => {
      await pickSearchable(t, TEACHER_SELECT, otherTeacher.id, otherTeacher.lastName);
      await waitEnabled(t, '#createAssignmentBtn', 'Guardar');
      await ui.click('#createAssignmentBtn', { scroll: false });
      await ui.waitModal('#newAssignmentOverlay', false);
      await ui.idle();
      t.equal(await t.sqlOne(`
        SELECT a.asignacion_docente_id, a.usuario_id, a.curso_id, a.grado_materia_id, a.fecha_eliminacion,
               e.fecha_eliminacion AS evaluacion_fecha_eliminacion
          FROM evaluacion e JOIN asignacion_docente a USING (asignacion_docente_id)
         WHERE e.evaluacion_id = $1`, [evaluationId]),
      { asignacion_docente_id: evaluated.id, usuario_id: otherTeacher.id, curso_id: evaluated.courseId, grado_materia_id: evaluated.gradeSubjectId, fecha_eliminacion: null, evaluacion_fecha_eliminacion: null },
      'La asignación quedó con el profesor elegido, con su curso y su materia, y la evaluación sigue vigente en ella');
      // La tabla pasa a la página donde quedó la asignación
      await ui.waitFor(`document.querySelector('${rowAction(evaluated, 'delete')}')`, { message: 'La asignación editada no se muestra en la tabla' });
      t.check(await ui.js(`document.querySelector('${rowAction(evaluated, 'delete')}').disabled`), 'Después de guardar, Eliminar de su fila sigue deshabilitado');
    });
    await logoutViaUi(t);
  });
});
