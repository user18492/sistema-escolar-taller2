const { query } = require('../database/connection');
const { Evaluation } = require('../models/evaluation.model');

// Listado de las evaluaciones vigentes de una asignación docente (sin las dadas de baja).
// El orden es total: la fecha (la más antigua primero) y, entre las del mismo día, el título, que
// no se repite entre las vigentes de una asignación (uq_evaluacion_asignacion_docente_titulo,
// db/schema.sql), así dos consultas sobre los mismos datos dan siempre el mismo orden.
const FIND_BY_TEACHER_ASSIGNMENT_SQL = `
  SELECT e.evaluacion_id,
         e.asignacion_docente_id,
         e.titulo,
         e.fecha_evaluacion
    FROM evaluacion e
   WHERE e.asignacion_docente_id = $1
     AND e.fecha_eliminacion IS NULL
   ORDER BY e.fecha_evaluacion, e.titulo
`;

function toEvaluation(row) {
  return new Evaluation({
    id: row.evaluacion_id,
    teacherAssignmentId: row.asignacion_docente_id,
    title: row.titulo,
    evaluationDate: row.fecha_evaluacion,
  });
}

// Evaluaciones vigentes de la asignación docente `teacherAssignmentId` (un asignacion_docente_id),
// ordenadas por fecha. Que la asignación se pueda consultar lo comprueba el servicio.
async function findByTeacherAssignment(teacherAssignmentId) {
  const { rows } = await query(FIND_BY_TEACHER_ASSIGNMENT_SQL, [teacherAssignmentId]);
  return rows.map(toEvaluation);
}

module.exports = { findByTeacherAssignment };
