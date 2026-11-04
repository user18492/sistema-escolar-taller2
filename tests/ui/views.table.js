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
  'admin/users/index.html': {
    roles: ['ADMIN'],
    rows: {
      selector: 'tr[data-user-id]',
      sql: (ctx) => [`SELECT usuario_id FROM usuario WHERE institucion_id = $1 AND usuario_id <> $2 AND fecha_eliminacion IS NULL`, [ctx.institutionId, ctx.userId]],
    },
  },
  'admin/courses/index.html': {
    roles: ['ADMIN'],
    rows: { selector: 'tr[data-course-id]', sql: (ctx) => [`SELECT curso_id FROM curso WHERE institucion_id = $1 AND fecha_eliminacion IS NULL`, [ctx.institutionId]] },
  },
  'admin/assignments/index.html': {
    roles: ['ADMIN'],
    rows: {
      selector: 'tr[data-assignment-id]',
      sql: (ctx) => [`SELECT a.asignacion_docente_id FROM asignacion_docente a JOIN curso c USING (curso_id) WHERE c.institucion_id = $1 AND a.fecha_eliminacion IS NULL`, [ctx.institutionId]],
    },
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
                       WHERE c.institucion_id = $1 AND i.fecha_eliminacion IS NULL AND a.fecha_eliminacion IS NULL`, [ctx.institutionId]],
    },
  },

  'teacher/assignments/index.html': {
    roles: ['PROFESOR'],
    rows: { selector: 'tr[data-assignment-id]', sql: (ctx) => [`SELECT asignacion_docente_id FROM asignacion_docente WHERE usuario_id = $1 AND fecha_eliminacion IS NULL`, [ctx.userId]] },
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
