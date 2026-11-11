const { query } = require('../database/connection');

const OWN_FOLLOW_UP = `
  FROM seguimiento_alumno s
  JOIN asignacion_docente a ON a.asignacion_docente_id = s.asignacion_docente_id
  JOIN curso c ON c.curso_id = a.curso_id
  JOIN inscripcion i ON i.inscripcion_id = s.inscripcion_id AND i.curso_id = c.curso_id
  JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
  JOIN alumno al ON al.alumno_id = i.alumno_id
 WHERE a.usuario_id = $1 AND c.institucion_id = $2
   AND a.fecha_eliminacion IS NULL AND c.fecha_eliminacion IS NULL
   AND ($3::INT IS NULL OR a.asignacion_docente_id = $3)
`;

const ACTIVE_ENROLLMENT = `
  c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
  AND ie.nombre = 'ACTIVA' AND i.fecha_eliminacion IS NULL AND al.fecha_eliminacion IS NULL
`;

async function getPassingGrade() {
  const { rows: [{ grade }] } = await query('SELECT fn_nota_aprobacion()::FLOAT AS grade');
  return grade;
}

async function findPendingCounts(teacherId, institutionId, assignmentId) {
  const { rows } = await query(`
    SELECT s.asignacion_docente_id AS "assignmentId", COUNT(*)::INT AS count
    ${OWN_FOLLOW_UP}
      AND s.fecha_resolucion IS NULL AND s.pendiente AND ${ACTIVE_ENROLLMENT}
    GROUP BY s.asignacion_docente_id
  `, [teacherId, institutionId, assignmentId]);
  return rows;
}

async function findCases(teacherId, institutionId, assignmentId) {
  const { rows } = await query(`
    SELECT s.seguimiento_alumno_id AS id, s.asignacion_docente_id AS "assignmentId", s.version,
           al.nombre AS "firstName", al.apellido AS "lastName",
           s.motivos AS reasons, s.evidencia AS evidence, s.fecha_atencion AS "attendedAt",
           s.fecha_resolucion AS "resolvedAt",
           CASE WHEN s.fecha_resolucion IS NOT NULL THEN 'RESOLVED'
                WHEN s.pendiente THEN 'PENDING' ELSE 'ATTENDED' END AS status
    ${OWN_FOLLOW_UP}
      AND (s.fecha_resolucion IS NOT NULL OR (${ACTIVE_ENROLLMENT}))
    ORDER BY al.apellido, al.nombre, s.seguimiento_alumno_id DESC
  `, [teacherId, institutionId, assignmentId]);
  return rows;
}

async function updateAttendance(teacherId, institutionId, assignmentId, caseId, version, attended) {
  const { rowCount } = await query(`
    WITH visible_case AS (
      SELECT s.seguimiento_alumno_id
      ${OWN_FOLLOW_UP}
        AND s.seguimiento_alumno_id = $4 AND ${ACTIVE_ENROLLMENT}
      FOR SHARE OF a, c, i, al
    )
    UPDATE seguimiento_alumno s
       SET pendiente = NOT $6::BOOLEAN,
           fecha_atencion = CASE WHEN $6 THEN statement_timestamp() END,
           version = version + 1
      FROM visible_case
     WHERE s.seguimiento_alumno_id = visible_case.seguimiento_alumno_id
       AND s.fecha_resolucion IS NULL AND s.version = $5 AND s.pendiente = $6
  `, [teacherId, institutionId, assignmentId, caseId, version, attended]);
  return rowCount === 1;
}

module.exports = { getPassingGrade, findPendingCounts, findCases, updateAttendance };
