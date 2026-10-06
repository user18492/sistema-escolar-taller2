const { query } = require('../database/connection');
const { Subject } = require('../models/subject.model');

// Materias del plan de estudios del grado de un curso que todavía no tienen un profesor en ese
// curso: las que no tienen una asignación docente vigente. Una asignación dada de baja no cuenta,
// igual que para uq_asignacion_docente_curso_grado_materia (db/schema.sql), así que su materia se
// vuelve a listar. Tampoco cuenta la asignación $2 (la que se está editando; NULL si no hay
// ninguna): su materia sigue disponible para ella. Por nombre, que no se repite en el catálogo: el
// orden es total.
const FIND_UNASSIGNED_BY_COURSE_SQL = `
  SELECT m.materia_id,
         m.nombre
    FROM curso c
    JOIN grado_materia gm ON gm.grado_id = c.grado_id
    JOIN materia m ON m.materia_id = gm.materia_id
   WHERE c.curso_id = $1
     AND NOT EXISTS (
           SELECT 1
             FROM asignacion_docente a
            WHERE a.curso_id = c.curso_id
              AND a.grado_materia_id = gm.grado_materia_id
              AND a.fecha_eliminacion IS NULL
              AND a.asignacion_docente_id IS DISTINCT FROM $2::INT
         )
   ORDER BY m.nombre
`;

function toSubject(row) {
  return new Subject({
    id: row.materia_id,
    name: row.nombre,
  });
}

// Materias del grado del curso que no tienen una asignación docente vigente en él, ordenadas por
// nombre; con `excludedTeacherAssignmentId` (un asignacion_docente_id), sin contar esa asignación.
// Devuelve una lista vacía si ya están todas asignadas o si el curso no existe: que sea un curso
// de la institución lo comprueba el servicio.
async function findUnassignedByCourse(courseId, excludedTeacherAssignmentId = null) {
  const { rows } = await query(FIND_UNASSIGNED_BY_COURSE_SQL, [courseId, excludedTeacherAssignmentId]);
  return rows.map(toSubject);
}

module.exports = { findUnassignedByCourse };
