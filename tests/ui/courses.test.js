// Capa ui: Cursos del Administrador. Un curso con asignaciones docentes o inscripciones vigentes no se
// edita ni se elimina: Editar y Eliminar quedan deshabilitados, con el motivo como title
// (plans/administrador-cursos/01-vista-cursos.md).
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi, openFromSidebar } = require('./helpers');

group('ui.courses', 'Cursos: cursos con asignaciones o inscripciones', {
  async setup({ fixtures }) {
    // 1° de primaria a la mañana: los tres quedan en la primera página del listado
    const createCourse = () => fixtures.createCourse({ level: 'PRIMARIA', grade: '1°', shift: 'MAÑANA' });
    const assignedCourse = await createCourse();
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    await fixtures.assign({ teacherId: teacher.id, courseId: assignedCourse.id });
    const enrolledCourse = await createCourse();
    const student = await fixtures.createStudent();
    await fixtures.enroll({ studentId: student.id, courseId: enrolledCourse.id });
    const freeCourse = await createCourse();
    return { assignedCourse, enrolledCourse, freeCourse };
  },
}, () => {
  test('in-use', 'Un curso con asignaciones docentes o inscripciones tiene Editar y Eliminar deshabilitados, con el motivo; uno sin ellas se elimina', async (t) => {
    const { ui } = t;
    const { assignedCourse, enrolledCourse, freeCourse } = t.data;
    const rowAction = (course, action) => `tr[data-course-id="${course.id}"] [data-action="${action}"]`;
    // Editar y Eliminar de la fila de `course`; cada uno dice el motivo si su title no es su etiqueta
    const rowButtons = (course) => ui.js(`(() => {
      const edit = document.querySelector('${rowAction(course, 'edit')}');
      const remove = document.querySelector('${rowAction(course, 'delete')}');
      return {
        editDisabled: edit.disabled,
        editHasReason: edit.title !== edit.getAttribute('aria-label'),
        deleteDisabled: remove.disabled,
        deleteHasReason: remove.title !== remove.getAttribute('aria-label'),
      };
    })()`);
    await loginViaUi(t, SEED_USERS.admin);
    await openFromSidebar(t, 'admin/courses/index.html');
    const shown = [assignedCourse, enrolledCourse, freeCourse].map((course) => `document.querySelector('${rowAction(course, 'edit')}')`);
    await ui.waitFor(shown.join(' && '), { message: 'Los cursos del setup no aparecen en la primera página de Cursos' });

    await t.step('Botones', async () => {
      const inUse = { editDisabled: true, editHasReason: true, deleteDisabled: true, deleteHasReason: true };
      t.equal(await rowButtons(assignedCourse), inUse, 'Con asignaciones docentes, Editar y Eliminar están deshabilitados y dicen el motivo');
      t.equal(await rowButtons(enrolledCourse), inUse, 'Con inscripciones, Editar y Eliminar están deshabilitados y dicen el motivo');
      const { editDisabled, deleteDisabled } = await rowButtons(freeCourse);
      t.equal({ editDisabled, deleteDisabled }, { editDisabled: false, deleteDisabled: false }, 'Sin asignaciones ni inscripciones, Editar y Eliminar están habilitados');
    });

    await t.step('Eliminar', async () => {
      await ui.click(rowAction(freeCourse, 'delete'));
      await ui.waitModal('#deleteCourseOverlay', true);
      await ui.click('#confirmDeleteCourseBtn', { scroll: false });
      await ui.waitModal('#deleteCourseOverlay', false);
      await ui.idle();
      await ui.waitFor(`!document.querySelector('tr[data-course-id="${freeCourse.id}"]')`, { message: 'La fila del curso eliminado se sigue mostrando' });
      t.equal(await t.sqlOne(`
        SELECT (SELECT fecha_eliminacion IS NOT NULL FROM curso WHERE curso_id = $1) AS free,
               (SELECT fecha_eliminacion IS NOT NULL FROM curso WHERE curso_id = $2) AS assigned,
               (SELECT fecha_eliminacion IS NOT NULL FROM curso WHERE curso_id = $3) AS enrolled`,
      [freeCourse.id, assignedCourse.id, enrolledCourse.id]),
      { free: true, assigned: false, enrolled: false },
      'El curso sin asignaciones ni inscripciones quedó dado de baja y los otros dos siguen vigentes');
    });
    await logoutViaUi(t);
  });
});
