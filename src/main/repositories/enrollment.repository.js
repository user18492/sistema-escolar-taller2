const { query } = require('../database/connection');
const { Enrollment } = require('../models/enrollment.model');
const { Student } = require('../models/student.model');

// Listado de las inscripciones de un curso, con su alumno: todas las filas del curso, en cualquier
// estado (activas, canceladas, finalizadas y trasladadas), porque la inscripción no tiene baja
// lógica. No hace falta la institución: el alumno es de la misma que el curso
// (trg_inscripcion_coherencia, db/schema.sql). `activa` indica si el estado de la inscripción es
// ACTIVA (un valor de inscripcion_estado.nombre).
// El orden es total: el alumno (por apellido y nombre; alumno_id mantiene juntas las de dos alumnos
// que se llaman igual) y, si un alumno tiene más de una inscripción en el curso, la más antigua
// primero (inscripcion_id), así dos consultas sobre los mismos datos dan siempre el mismo orden.
const FIND_BY_COURSE_SQL = `
  SELECT i.inscripcion_id,
         i.curso_id,
         i.fecha_inscripcion,
         (ie.nombre = 'ACTIVA') AS activa,
         al.alumno_id,
         al.nombre,
         al.apellido,
         al.dni
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN alumno al ON al.alumno_id = i.alumno_id
   WHERE i.curso_id = $1
   ORDER BY al.apellido, al.nombre, al.alumno_id, i.inscripcion_id
`;

function toEnrollment(row) {
  return new Enrollment({
    id: row.inscripcion_id,
    student: new Student({
      id: row.alumno_id,
      firstName: row.nombre,
      lastName: row.apellido,
      dni: row.dni,
    }),
    courseId: row.curso_id,
    enrollmentDate: row.fecha_inscripcion,
    isActive: row.activa,
  });
}

// Inscripciones del curso `courseId` (un curso_id), en cualquier estado, ordenadas por alumno
// (apellido y nombre). Que el curso se pueda consultar lo comprueba el servicio.
async function findByCourse(courseId) {
  const { rows } = await query(FIND_BY_COURSE_SQL, [courseId]);
  return rows.map(toEnrollment);
}

module.exports = { findByCourse };
