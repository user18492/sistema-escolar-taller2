// Vistas de renderer/, como datos, para el recorrido de views.test.js: qué rol las abre, qué
// parámetros necesitan y qué tabla tiene que mostrar filas cuando la base las tiene. El recorrido
// usa los usuarios del seed (solo lee) y comprueba las filas con una consulta propia.
// Una vista nueva (renderer/<área>/<vista>/index.html) sin fila acá hace fallar
// ui.views.table-matches-renderer.
//
// roles: los que pueden abrirla (la guardia rechaza a los demás); null = pública (login).
// query(ctx): parámetros de la URL, con los ids que encuentra ctx (ver views.test.js).
// rows: { selector, sql(ctx) }: la tabla de la vista tiene que tener al menos una fila si la consulta
// devuelve alguna.
module.exports = {
  'auth/login/index.html': { roles: null },
  'profile/settings/index.html': { roles: ['ADMIN', 'SECRETARIO', 'PROFESOR'] },

  'admin/dashboard/index.html': { roles: ['ADMIN'] },
  // Reportes y sus tres reportes (plans/reportes-administrador/00-navegacion-y-base.md): sin filas
  // hasta que cada reporte cargue sus datos (partes 01 a 03).
  'admin/reports/index.html': { roles: ['ADMIN'] },
  // Solo los cursos incompletos, del ciclo actual por defecto: con alguna materia del plan sin una
  // asignación vigente de un profesor activo y no dado de baja (parte 01)
  'admin/subject-coverage-report/index.html': {
    roles: ['ADMIN'],
    rows: {
      selector: 'tr[data-course-id]',
      sql: (ctx) => [`SELECT c.curso_id FROM curso c WHERE c.institucion_id = $1 AND c.fecha_eliminacion IS NULL
                       AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
                       AND EXISTS (SELECT 1 FROM grado_materia gm WHERE gm.grado_id = c.grado_id
                                     AND NOT EXISTS (SELECT 1 FROM asignacion_docente a JOIN usuario u USING (usuario_id)
                                                      WHERE a.curso_id = c.curso_id AND a.grado_materia_id = gm.grado_materia_id
                                                        AND a.fecha_eliminacion IS NULL AND u.fecha_eliminacion IS NULL AND u.estado))`, [ctx.institutionId]],
    },
  },
  // Una fila por profesor no dado de baja de la institución, activo o suspendido, también sin
  // asignaciones (parte 02)
  'admin/teacher-workload-report/index.html': {
    roles: ['ADMIN'],
    rows: {
      selector: '[data-teacher-id]',
      sql: (ctx) => [`SELECT u.usuario_id FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
                       WHERE u.institucion_id = $1 AND r.nombre = 'PROFESOR' AND u.fecha_eliminacion IS NULL`, [ctx.institutionId]],
    },
  },
  'admin/backup-regularity-report/index.html': { roles: ['ADMIN'] },
  'admin/users/index.html': {
    roles: ['ADMIN'],
    rows: {
      selector: 'tr[data-user-id]',
      sql: (ctx) => [`SELECT usuario_id FROM usuario WHERE institucion_id = $1 AND usuario_id <> $2 AND fecha_eliminacion IS NULL`, [ctx.institutionId, ctx.userId]],
    },
  },
  // Cursos, Docencia, Inscripciones y Asignaciones del Profesor muestran por defecto solo el ciclo
  // lectivo actual (pedido del 2026-11-08): sus filas esperadas son las de ese ciclo.
  'admin/courses/index.html': {
    roles: ['ADMIN'],
    rows: {
      selector: 'tr[data-course-id]',
      sql: (ctx) => [`SELECT curso_id FROM curso WHERE institucion_id = $1 AND fecha_eliminacion IS NULL
                       AND anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()`, [ctx.institutionId]],
    },
  },
  'admin/assignments/index.html': {
    roles: ['ADMIN'],
    rows: {
      selector: 'tr[data-assignment-id]',
      sql: (ctx) => [`SELECT a.asignacion_docente_id FROM asignacion_docente a JOIN curso c USING (curso_id) WHERE c.institucion_id = $1 AND a.fecha_eliminacion IS NULL
                       AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()`, [ctx.institutionId]],
    },
  },
  'admin/backups/index.html': {
    roles: ['ADMIN'],
    rows: { selector: 'tr[data-backup-id]', sql: (ctx) => [`SELECT respaldo_id FROM respaldo WHERE institucion_id = $1`, [ctx.institutionId]] },
  },

  'secretary/dashboard/index.html': { roles: ['SECRETARIO'] },
  'secretary/reports/index.html': { roles: ['SECRETARIO'] },
  'secretary/students/index.html': {
    roles: ['SECRETARIO'],
    rows: { selector: 'tr[data-student-id]', sql: (ctx) => [`SELECT alumno_id FROM alumno WHERE institucion_id = $1 AND fecha_eliminacion IS NULL`, [ctx.institutionId]] },
  },
  'secretary/enrollments/index.html': {
    roles: ['SECRETARIO'],
    rows: {
      selector: 'tr[data-enrollment-id]',
      sql: (ctx) => [`SELECT i.inscripcion_id FROM inscripcion i JOIN curso c USING (curso_id) JOIN alumno a USING (alumno_id)
                       WHERE c.institucion_id = $1 AND i.fecha_eliminacion IS NULL AND a.fecha_eliminacion IS NULL
                         AND EXTRACT(YEAR FROM i.fecha_inscripcion) = fn_anio_ciclo_lectivo_actual()`, [ctx.institutionId]],
    },
  },
  'secretary/enrollment-averages/index.html': {
    roles: ['SECRETARIO'],
    query: (ctx) => ({ enrollmentId: ctx.enrollmentId }),
    rows: {
      selector: 'tr[data-subject]',
      sql: (ctx) => [`SELECT a.asignacion_docente_id FROM asignacion_docente a JOIN inscripcion i USING (curso_id)
                       WHERE i.inscripcion_id = $1 AND a.fecha_eliminacion IS NULL`, [ctx.enrollmentId]],
    },
  },

  'teacher/assignments/index.html': {
    roles: ['PROFESOR'],
    rows: {
      selector: 'tr[data-assignment-id]',
      sql: (ctx) => [`SELECT a.asignacion_docente_id FROM asignacion_docente a JOIN curso c USING (curso_id)
                       WHERE a.usuario_id = $1 AND a.fecha_eliminacion IS NULL
                         AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()`, [ctx.userId]],
    },
  },
  'teacher/assignment-management/index.html': {
    roles: ['PROFESOR'],
    query: (ctx) => ({ assignmentId: ctx.assignmentId }),
  },
  'teacher/assignment-students/index.html': {
    roles: ['PROFESOR'],
    query: (ctx) => ({ assignmentId: ctx.assignmentId }),
    rows: {
      selector: 'tr[data-enrollment-id]',
      sql: (ctx) => [`SELECT i.inscripcion_id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
                       WHERE i.curso_id = (SELECT curso_id FROM asignacion_docente WHERE asignacion_docente_id = $1)
                         AND i.fecha_eliminacion IS NULL AND e.nombre IN ('ACTIVA', 'FINALIZADA')`, [ctx.assignmentId]],
    },
  },
  'teacher/assignment-evaluations/index.html': {
    roles: ['PROFESOR'],
    query: (ctx) => ({ assignmentId: ctx.assignmentId }),
    rows: { selector: 'tr[data-evaluation-id]', sql: (ctx) => [`SELECT evaluacion_id FROM evaluacion WHERE asignacion_docente_id = $1 AND fecha_eliminacion IS NULL`, [ctx.assignmentId]] },
  },
  'teacher/evaluation-scores/index.html': {
    roles: ['PROFESOR'],
    query: (ctx) => ({ assignmentId: ctx.assignmentId, evaluationId: ctx.evaluationId }),
    rows: {
      selector: 'tr[data-enrollment-id]',
      sql: (ctx) => [`SELECT i.inscripcion_id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
                       WHERE i.curso_id = (SELECT curso_id FROM asignacion_docente WHERE asignacion_docente_id = $1)
                         AND i.fecha_eliminacion IS NULL AND e.nombre IN ('ACTIVA', 'FINALIZADA')`, [ctx.assignmentId]],
    },
  },
};
