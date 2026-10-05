const { query } = require('../database/connection');
const { TeacherAssignment } = require('../models/teacher-assignment.model');
const { User } = require('../models/user.model');
const { Course } = require('../models/course.model');
const { Subject } = require('../models/subject.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE } = require('./grade.repository');
const { SHIFT_BY_COLUMN_VALUE } = require('./course.repository');

// Listado de las asignaciones docentes vigentes de una institución (las dadas de baja no se
// listan), de todos los ciclos lectivos, con su profesor, su curso y su materia. La institución es
// la del curso: la asignación no la guarda. Solo cuenta la baja de la asignación, no la de su curso
// ni la de su profesor: db/schema.sql todavía permite darlos de baja con asignaciones vigentes, y
// esas asignaciones se siguen listando.
// El orden es total: primero el ciclo lectivo más reciente y, dentro de cada uno, el profesor (por
// apellido y nombre; usuario_id mantiene juntas las de dos profesores que se llaman igual), el
// curso (como en el listado de cursos: primaria antes que secundaria, grado, división y turno) y la
// materia; asignacion_docente_id desempata, así dos consultas sobre los mismos datos dan siempre el
// mismo orden.
const FIND_BY_INSTITUTION_SQL = `
  SELECT a.asignacion_docente_id,
         a.grado_materia_id,
         u.usuario_id,
         u.nombre,
         u.apellido,
         u.email,
         u.imagen_url,
         c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo,
         m.materia_id,
         m.nombre AS materia_nombre
    FROM asignacion_docente a
    JOIN usuario u ON u.usuario_id = a.usuario_id
    JOIN curso c ON c.curso_id = a.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
    JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
    JOIN materia m ON m.materia_id = gm.materia_id
   WHERE c.institucion_id = $1
     AND a.fecha_eliminacion IS NULL
   ORDER BY c.anio_ciclo_lectivo DESC,
            u.apellido, u.nombre, u.usuario_id,
            g.nivel_educativo, g.nombre, c.division, c.turno, c.curso_id,
            m.nombre, a.asignacion_docente_id
`;

function toTeacherAssignment(row) {
  return new TeacherAssignment({
    id: row.asignacion_docente_id,
    teacher: new User({
      id: row.usuario_id,
      firstName: row.nombre,
      lastName: row.apellido,
      email: row.email,
      imageFileName: row.imagen_url,
    }),
    course: new Course({
      id: row.curso_id,
      institutionId: row.institucion_id,
      gradeId: row.grado_id,
      gradeName: row.grado_nombre,
      educationLevel: EDUCATION_LEVEL_BY_COLUMN_VALUE[row.nivel_educativo],
      division: row.division,
      shift: SHIFT_BY_COLUMN_VALUE[row.turno],
      schoolYear: row.anio_ciclo_lectivo,
    }),
    gradeSubjectId: row.grado_materia_id,
    subject: new Subject({
      id: row.materia_id,
      name: row.materia_nombre,
    }),
  });
}

// Asignaciones docentes vigentes de la institución, de todos los ciclos lectivos, ordenadas por
// ciclo lectivo (el más reciente primero), profesor, curso y materia.
async function findByInstitution(institutionId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId]);
  return rows.map(toTeacherAssignment);
}

module.exports = { findByInstitution };
