const { query } = require('../database/connection');
const { Enrollment } = require('../models/enrollment.model');
const { Student } = require('../models/student.model');

// Listado de las inscripciones de un curso, con su alumno: todas las filas del curso, en cualquier
// estado (activas, finalizadas y canceladas), porque la inscripción no tiene baja
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

// Cantidad de inscripciones activas (de estado ACTIVA, un valor de inscripcion_estado.nombre) de una
// institución en el ciclo lectivo del año en curso. La institución y el ciclo lectivo son los del
// curso: la inscripción no los guarda. El año en curso lo resuelve la base (CURRENT_DATE), así que
// las de ciclos anteriores quedan afuera sin que nadie las descuente: la cuenta vuelve a 0 cuando
// empieza un año. Solo cuenta el estado de la inscripción, no el del alumno ni la baja del curso.
const COUNT_ACTIVE_IN_CURRENT_SCHOOL_YEAR_SQL = `
  SELECT COUNT(*)::INT AS total
    FROM inscripcion i
    JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
    JOIN curso c ON c.curso_id = i.curso_id
   WHERE c.institucion_id = $1
     AND ie.nombre = 'ACTIVA'
     AND c.anio_ciclo_lectivo = EXTRACT(YEAR FROM CURRENT_DATE)::INT
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

// Cantidad de inscripciones activas de la institución en el ciclo lectivo del año en curso.
async function countActiveInCurrentSchoolYear(institutionId) {
  const { rows } = await query(COUNT_ACTIVE_IN_CURRENT_SCHOOL_YEAR_SQL, [institutionId]);
  return rows[0].total;
}

module.exports = { findByCourse, countActiveInCurrentSchoolYear };
