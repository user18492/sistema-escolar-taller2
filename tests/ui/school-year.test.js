// Capa ui: lo de un ciclo lectivo cerrado se ve en solo lectura (plans/ciclo-lectivo/02-renderer.md),
// y las tablas de registros de un ciclo (Cursos, Docencia, Asignaciones del Profesor e Inscripciones)
// muestran por defecto solo el ciclo actual, con su filtro de año sin aplicar (pedido del
// 2026-11-08). Los datos del ciclo cerrado se cargan con fixtures.inSchoolYear y, como la capa no
// arranca main.js, el cierre no corre: la inscripción del ciclo cerrado sigue activa.
const { group, test } = require('../lib/framework');
const { SEED_USERS, SEED_INSTITUTIONS } = require('../lib/fixtures');
const {
  loginViaUi, logoutViaUi, openFromSidebar, rowActionsState, typeInColumnFilter, chooseColumnFilterOption, clearColumnFilter,
} = require('./helpers');

const CURRENT_SCHOOL_YEAR_PLAN = 'Pedido del 2026-11-08: ciclo lectivo actual por defecto en las tablas (sin plan en plans/)';

// Las vistas con tablas de registros de un ciclo, como datos: el filtro que elige el ciclo (su
// data-filter y su campo de año), la celda de la fila que dice su año (la de la fecha de
// inscripción, DD/MM/AAAA, en Inscripciones) y las filas que tiene que mostrar con el ciclo `year`,
// con una consulta propia: { rowSelector, filter, yearInput, yearCell, sql(year, ctx) }.
const INSTITUTION_SQL = `(SELECT institucion_id FROM institucion WHERE cuit = '${SEED_INSTITUTIONS.SM}')`;
const VIEWS = {
  courses: {
    rowSelector: 'tr[data-course-id]', filter: 'year', yearInput: '.column-filter-input', yearCell: 4,
    sql: (year) => [`SELECT curso_id FROM curso WHERE institucion_id = ${INSTITUTION_SQL} AND fecha_eliminacion IS NULL AND anio_ciclo_lectivo = $1`, [year]],
  },
  assignments: {
    rowSelector: 'tr[data-assignment-id]', filter: 'year', yearInput: '.column-filter-input', yearCell: 4,
    sql: (year) => [`SELECT a.asignacion_docente_id FROM asignacion_docente a JOIN curso c USING (curso_id)
                      WHERE c.institucion_id = ${INSTITUTION_SQL} AND a.fecha_eliminacion IS NULL AND c.anio_ciclo_lectivo = $1`, [year]],
  },
  enrollments: {
    rowSelector: 'tr[data-enrollment-id]', filter: 'date', yearInput: 'input[name="year"]', yearCell: 3,
    sql: (year) => [`SELECT i.inscripcion_id FROM inscripcion i JOIN curso c USING (curso_id) JOIN alumno a USING (alumno_id)
                      WHERE c.institucion_id = ${INSTITUTION_SQL} AND i.fecha_eliminacion IS NULL AND a.fecha_eliminacion IS NULL
                        AND EXTRACT(YEAR FROM i.fecha_inscripcion) = $1`, [year]],
  },
  teacherAssignments: {
    rowSelector: 'tr[data-assignment-id]', filter: 'year', yearInput: '.column-filter-input', yearCell: 3,
    sql: (year, { teacher }) => [`SELECT a.asignacion_docente_id FROM asignacion_docente a JOIN curso c USING (curso_id)
                                   WHERE a.usuario_id = $2 AND a.fecha_eliminacion IS NULL AND c.anio_ciclo_lectivo = $1`, [year, teacher.id]],
  },
};

// Espera que la tabla de `view` muestre el ciclo `year`: todas sus filas a la vista son de ese año,
// el total del pie es el de la consulta propia y el embudo del filtro de ciclo se ve aplicado o no
// según `applied`.
async function expectShownSchoolYear(t, view, year, applied, label) {
  const [sql, params] = view.sql(year, t.data);
  const expectedTotal = (await t.sql(sql, params)).length;
  const state = `(() => {
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(view.rowSelector)}));
    const years = rows.map((row) => row.cells[${view.yearCell}].textContent.trim().slice(-4));
    const total = Number((document.querySelector('table-pagination .results-count').textContent.match(/(\\d+)\\s*$/) || [])[1]);
    const applied = document.querySelector('th[data-filter="${view.filter}"] .column-filter-toggle').classList.contains('has-selection');
    return { years, total, applied };
  })()`;
  const ok = await t.ui.waitFor(`(() => { const s = ${state}; return s.total === ${expectedTotal} && s.years.length === Math.min(10, ${expectedTotal})
    && s.years.every((y) => y === '${year}') && s.applied === ${applied}; })()`, { timeoutMs: 6000 });
  t.check(ok, `${label}: la tabla muestra solo el ciclo ${year} (${expectedTotal} en total) con el filtro ${applied ? 'aplicado' : 'sin aplicar'}`,
    { expectedTotal, state: await t.ui.js(state) });
}

// Los data-value de las opciones (sin "Todos") y de las marcadas del filtro de columna `filter`
const filterOptions = (t, filter) => t.ui.js(`(() => {
  const options = Array.from(document.querySelectorAll('th[data-filter="${filter}"] .dropdown-option')).filter((option) => option.dataset.value);
  return { values: options.map((option) => option.dataset.value), selected: options.filter((option) => option.classList.contains('selected')).map((option) => option.dataset.value) };
})()`);

const isFilterApplied = (t, filter) =>
  t.ui.js(`document.querySelector('th[data-filter="${filter}"] .column-filter-toggle').classList.contains('has-selection')`);

group('ui.school-year', 'Ciclo lectivo: lo de un ciclo cerrado en solo lectura y el ciclo actual por defecto', {
  async setup({ fixtures }) {
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const otherTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const closedYear = fixtures.year - 1;
    // Primeros por apellido: cada inscripción queda en la primera página del listado de su ciclo
    const currentStudent = await fixtures.createStudent({ lastName: 'Aaactual' });
    const currentCourse = await fixtures.createCourse();
    const currentEnrollmentId = await fixtures.enroll({ studentId: currentStudent.id, courseId: currentCourse.id });
    // En el ciclo actual, otro profesor dicta la primera materia del grado y `teacher`, la segunda:
    // `teacher` tiene asignaciones de los dos ciclos, con materias distintas, y `otherTeacher`, solo
    // del actual
    const otherCurrentAssignment = await fixtures.assign({ teacherId: otherTeacher.id, courseId: currentCourse.id });
    const currentAssignment = await fixtures.assign({ teacherId: teacher.id, courseId: currentCourse.id });
    const closed = await fixtures.inSchoolYear(closedYear, async () => {
      const course = await fixtures.createCourse();
      const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
      const student = await fixtures.createStudent({ lastName: 'Aacerrado' });
      const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
      return { closedCourse: course, assignment, closedStudent: student, enrollmentId };
    });
    return {
      teacher, otherTeacher, closedYear, currentStudent, currentCourse, currentEnrollmentId, currentAssignment, otherCurrentAssignment, ...closed,
    };
  },
}, () => {
  test('closed-read-only', 'Inscripciones y Evaluaciones muestran lo de un ciclo cerrado con Editar, Eliminar y Nueva evaluación deshabilitados', {
    history: [{
      plan: CURRENT_SCHOOL_YEAR_PLAN,
      date: '2026-11-08',
      change: 'Las tablas muestran por defecto solo el ciclo actual: la inscripción del ciclo actual se comprueba al entrar y la del ciclo cerrado, después de escribir su año en el filtro Fecha de inscripción; en Asignaciones del Profesor, la asignación del ciclo cerrado aparece después de escribir su año en el filtro Ciclo lectivo',
    }],
  }, async (t) => {
    const { ui } = t;
    const { teacher, closedYear, currentEnrollmentId, assignment, enrollmentId } = t.data;

    await t.step('Inscripciones', async () => {
      await loginViaUi(t, SEED_USERS.secretary);
      await openFromSidebar(t, 'secretary/enrollments/index.html');
      const currentRow = `tr[data-enrollment-id="${currentEnrollmentId}"]`;
      await ui.waitFor(`document.querySelector('${currentRow} [data-action="edit"]')`, { message: 'La inscripción del ciclo actual no aparece en la primera página' });
      const currentActions = await rowActionsState(t, currentRow);
      t.check(['print', 'edit', 'delete'].every((action) => !currentActions[action].disabled), 'Las acciones de una inscripción del ciclo actual siguen habilitadas', currentActions);

      await typeInColumnFilter(t, 'date', 'input[name="year"]', String(closedYear));
      const closedRow = `tr[data-enrollment-id="${enrollmentId}"]`;
      await ui.waitFor(`document.querySelector('${closedRow} [data-action="edit"]')`, { message: 'La inscripción del ciclo cerrado no aparece en la primera página de su ciclo' });
      const closedActions = await rowActionsState(t, closedRow);
      for (const action of ['edit', 'delete']) {
        const { disabled, title, label } = closedActions[action];
        t.check(disabled, `${label}: deshabilitado en una inscripción del ciclo cerrado`, closedActions[action]);
        t.check(title !== label && title.includes(String(closedYear)), `${label}: el title explica que el ciclo ${closedYear} está cerrado`, closedActions[action]);
      }
      t.check(!closedActions.print.disabled, 'Imprimir sigue habilitado en una inscripción del ciclo cerrado', closedActions.print);
      await logoutViaUi(t);
    });

    await t.step('Evaluaciones de una asignación del ciclo cerrado', async () => {
      await loginViaUi(t, teacher);
      await ui.idle();
      await typeInColumnFilter(t, 'year', '.column-filter-input', String(closedYear));
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

  test('current-by-default', 'Cursos, Docencia, Asignaciones del Profesor e Inscripciones muestran al entrar solo el ciclo actual, con el filtro sin aplicar; al escribir otro año, ese ciclo, con el filtro aplicado, sus opciones y sin lo elegido que no es de él; "Limpiar filtro" vuelve al actual', async (t) => {
    const { ui } = t;
    const {
      teacher, otherTeacher, closedYear, currentStudent, closedStudent, currentEnrollmentId, enrollmentId, currentAssignment, assignment,
    } = t.data;
    const currentYear = t.year;

    await t.step('Cursos', async () => {
      await loginViaUi(t, SEED_USERS.admin);
      await openFromSidebar(t, 'admin/courses/index.html');
      await expectShownSchoolYear(t, VIEWS.courses, currentYear, false, 'Al entrar');
      await typeInColumnFilter(t, 'year', '.column-filter-input', String(closedYear));
      await expectShownSchoolYear(t, VIEWS.courses, closedYear, true, 'Con el ciclo cerrado elegido');
      await clearColumnFilter(t, 'year');
      await expectShownSchoolYear(t, VIEWS.courses, currentYear, false, 'Después de "Limpiar filtro"');
    });

    await t.step('Docencia', async () => {
      await openFromSidebar(t, 'admin/assignments/index.html');
      await expectShownSchoolYear(t, VIEWS.assignments, currentYear, false, 'Al entrar');
      const currentOptions = await filterOptions(t, 'teacher');
      t.check([teacher.id, otherTeacher.id].every((id) => currentOptions.values.includes(String(id))), 'Profesor ofrece a los profesores con asignaciones del ciclo actual', currentOptions);

      // `otherTeacher` no tiene asignaciones en el ciclo cerrado: elegido, deja de filtrar al pasar a él
      const onlyRow = (id) => `document.querySelectorAll('tr[data-assignment-id]').length === 1 && document.querySelector('tr[data-assignment-id="${id}"]')`;
      await chooseColumnFilterOption(t, 'teacher', String(otherTeacher.id));
      await ui.waitFor(onlyRow(t.data.otherCurrentAssignment.id), { message: 'El filtro Profesor no dejó solo la asignación del profesor elegido' });
      await typeInColumnFilter(t, 'year', '.column-filter-input', String(closedYear));
      await expectShownSchoolYear(t, VIEWS.assignments, closedYear, true, 'Con el ciclo cerrado elegido');
      t.check(!(await isFilterApplied(t, 'teacher')), 'El filtro Profesor, con un profesor sin asignaciones en el ciclo cerrado, dejó de estar aplicado');
      const closedOptions = await filterOptions(t, 'teacher');
      t.check(closedOptions.values.includes(String(teacher.id)) && !closedOptions.values.includes(String(otherTeacher.id)), 'Profesor ofrece solo a los profesores con asignaciones del ciclo cerrado', closedOptions);

      await clearColumnFilter(t, 'year');
      await expectShownSchoolYear(t, VIEWS.assignments, currentYear, false, 'Después de "Limpiar filtro"');
      t.check((await filterOptions(t, 'teacher')).values.includes(String(otherTeacher.id)), 'De vuelta en el ciclo actual, Profesor vuelve a ofrecer al profesor del ciclo actual');

      // `teacher` tiene asignaciones en los dos ciclos: elegido, sigue filtrando al pasar al cerrado
      await chooseColumnFilterOption(t, 'teacher', String(teacher.id));
      await ui.waitFor(onlyRow(currentAssignment.id), { message: 'El filtro Profesor no dejó solo la asignación del ciclo actual del profesor elegido' });
      await typeInColumnFilter(t, 'year', '.column-filter-input', String(closedYear));
      await ui.waitFor(onlyRow(assignment.id), { message: 'Con el ciclo cerrado, el profesor elegido sigue filtrando y la tabla muestra solo su asignación de ese ciclo' });
      t.equal((await filterOptions(t, 'teacher')).selected, [String(teacher.id)], 'El profesor con asignaciones en el ciclo cerrado sigue elegido');
      await clearColumnFilter(t, 'teacher');
      await clearColumnFilter(t, 'year');
      await expectShownSchoolYear(t, VIEWS.assignments, currentYear, false, 'Sin filtros');
      await logoutViaUi(t);
    });

    await t.step('Inscripciones', async () => {
      await loginViaUi(t, SEED_USERS.secretary);
      await openFromSidebar(t, 'secretary/enrollments/index.html');
      await expectShownSchoolYear(t, VIEWS.enrollments, currentYear, false, 'Al entrar');
      const currentNumbers = await filterOptions(t, 'number');
      const currentStudents = await filterOptions(t, 'student');
      t.check(currentNumbers.values.includes(String(currentEnrollmentId)) && !currentNumbers.values.includes(String(enrollmentId)), 'Número de inscripción ofrece solo las del ciclo actual', currentNumbers);
      t.check(currentStudents.values.includes(String(currentStudent.id)) && !currentStudents.values.includes(String(closedStudent.id)), 'Alumno ofrece solo los alumnos del ciclo actual', currentStudents);

      // Una inscripción del ciclo actual elegida deja de filtrar al pasar al ciclo cerrado
      await chooseColumnFilterOption(t, 'number', String(currentEnrollmentId));
      await ui.waitFor(`document.querySelectorAll('tr[data-enrollment-id]').length === 1 && document.querySelector('tr[data-enrollment-id="${currentEnrollmentId}"]')`, { message: 'El filtro Número de inscripción no dejó solo la inscripción elegida' });
      await typeInColumnFilter(t, 'date', 'input[name="year"]', String(closedYear));
      await expectShownSchoolYear(t, VIEWS.enrollments, closedYear, true, 'Con el ciclo cerrado elegido');
      t.check(!(await isFilterApplied(t, 'number')), 'El filtro Número de inscripción, con una inscripción del ciclo actual, dejó de estar aplicado');
      const closedNumbers = await filterOptions(t, 'number');
      t.check(closedNumbers.values.includes(String(enrollmentId)) && !closedNumbers.values.includes(String(currentEnrollmentId)), 'Número de inscripción ofrece solo las del ciclo cerrado', closedNumbers);
      t.check((await filterOptions(t, 'student')).values.includes(String(closedStudent.id)), 'Alumno ofrece al alumno del ciclo cerrado');

      await clearColumnFilter(t, 'date');
      await expectShownSchoolYear(t, VIEWS.enrollments, currentYear, false, 'Después de "Limpiar filtro"');
      const numbersAfterClear = await filterOptions(t, 'number');
      t.check(numbersAfterClear.values.includes(String(currentEnrollmentId)) && !numbersAfterClear.values.includes(String(enrollmentId)), 'De vuelta en el ciclo actual, Número de inscripción ofrece solo las del ciclo actual', numbersAfterClear);
      await logoutViaUi(t);
    });

    await t.step('Asignaciones del Profesor', async () => {
      await loginViaUi(t, teacher);
      await ui.idle();
      await expectShownSchoolYear(t, VIEWS.teacherAssignments, currentYear, false, 'Al entrar');
      t.equal((await filterOptions(t, 'subject')).values, [String(currentAssignment.subjectId)], 'Materia ofrece solo la materia del ciclo actual');

      await chooseColumnFilterOption(t, 'subject', String(currentAssignment.subjectId));
      await typeInColumnFilter(t, 'year', '.column-filter-input', String(closedYear));
      await expectShownSchoolYear(t, VIEWS.teacherAssignments, closedYear, true, 'Con el ciclo cerrado elegido');
      t.check(!(await isFilterApplied(t, 'subject')), 'El filtro Materia, con la materia del ciclo actual, dejó de estar aplicado');
      t.equal((await filterOptions(t, 'subject')).values, [String(assignment.subjectId)], 'Materia ofrece solo la materia del ciclo cerrado');

      await clearColumnFilter(t, 'year');
      await expectShownSchoolYear(t, VIEWS.teacherAssignments, currentYear, false, 'Después de "Limpiar filtro"');
      t.equal((await filterOptions(t, 'subject')).values, [String(currentAssignment.subjectId)], 'De vuelta en el ciclo actual, Materia vuelve a ofrecer la materia del ciclo actual');
    });
  });
});
