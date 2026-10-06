const { query } = require('../database/connection');
const { TeacherAssignment } = require('../models/teacher-assignment.model');
const { User } = require('../models/user.model');
const { Course } = require('../models/course.model');
const { Subject } = require('../models/subject.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE } = require('./grade.repository');
const { SHIFT_BY_COLUMN_VALUE } = require('./course.repository');

// Asignaciones docentes con su profesor, su curso y su materia. `source` es de dónde salen las
// filas de asignacion_docente: la tabla o el CTE con la fila de un alta o de una baja.
const selectFrom = (source) => `
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
    FROM ${source} a
    JOIN usuario u ON u.usuario_id = a.usuario_id
    JOIN curso c ON c.curso_id = a.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
    JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
    JOIN materia m ON m.materia_id = gm.materia_id`;

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
const FIND_BY_INSTITUTION_SQL = `${selectFrom('asignacion_docente')}
   WHERE c.institucion_id = $1
     AND a.fecha_eliminacion IS NULL
   ORDER BY c.anio_ciclo_lectivo DESC,
            u.apellido, u.nombre, u.usuario_id,
            g.nivel_educativo, g.nombre, c.division, c.turno, c.curso_id,
            m.nombre, a.asignacion_docente_id
`;

// Alta. La materia ($3, un materia_id) se busca en el plan de estudios del grado del curso: si no
// es de ese grado, o si el curso no existe, no se inserta nada. Devuelve la fila creada, con su
// profesor, su curso y su materia.
const CREATE_SQL = `
  WITH created AS (
    INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
    SELECT $1::INT, c.curso_id, gm.grado_materia_id
      FROM curso c
      JOIN grado_materia gm ON gm.grado_id = c.grado_id
     WHERE c.curso_id = $2
       AND gm.materia_id = $3
    RETURNING asignacion_docente_id, usuario_id, curso_id, grado_materia_id
  )${selectFrom('created')}
`;

// Baja lógica: la fila se conserva con la fecha de baja. Solo marca una asignación vigente de un
// curso de la institución (la del curso: la asignación no la guarda), así una segunda baja
// (repetida o simultánea) no pisa la fecha de la primera. Devuelve la fila, con su profesor, su
// curso y su materia.
const MARK_AS_DELETED_SQL = `
  WITH deleted AS (
    UPDATE asignacion_docente a
       SET fecha_eliminacion = NOW()
      FROM curso c
     WHERE a.asignacion_docente_id = $1
       AND c.curso_id = a.curso_id
       AND c.institucion_id = $2
       AND a.fecha_eliminacion IS NULL
    RETURNING a.asignacion_docente_id, a.usuario_id, a.curso_id, a.grado_materia_id
  )${selectFrom('deleted')}
`;

// Cuenta también a las dadas de baja.
const EXISTS_IN_INSTITUTION_SQL = `
  SELECT 1
    FROM asignacion_docente a
    JOIN curso c ON c.curso_id = a.curso_id
   WHERE a.asignacion_docente_id = $1
     AND c.institucion_id = $2
`;

// Índice único de asignacion_docente (con el nombre que le da db/schema.sql): una materia de un
// curso tiene un solo profesor vigente. PostgreSQL informa el nombre del índice como el de una
// restricción.
const UNIQUE_INDEX = 'uq_asignacion_docente_curso_grado_materia';

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

// Crea la asignación vigente del profesor `teacherId` (un usuario_id) en el curso `courseId` para
// la materia `subjectId` (un materia_id). Devuelve la asignación creada; null si la materia no es
// del plan de estudios del grado del curso (o el curso no existe). Si esa materia ya tiene un
// profesor vigente en el curso, PostgreSQL rechaza el alta: ver isDuplicateError. Que el profesor y
// el curso se puedan elegir lo comprueba el servicio.
async function create({ teacherId, courseId, subjectId }) {
  const { rows } = await query(CREATE_SQL, [teacherId, courseId, subjectId]);
  return rows.length > 0 ? toTeacherAssignment(rows[0]) : null;
}

// Da de baja la asignación, que deja de listarse y de contar para el índice único: su materia se
// puede volver a asignar en ese curso. Devuelve la asignación dada de baja; null si no existe en la
// institución o ya estaba dada de baja.
async function markAsDeleted(teacherAssignmentId, institutionId) {
  const { rows } = await query(MARK_AS_DELETED_SQL, [teacherAssignmentId, institutionId]);
  return rows.length > 0 ? toTeacherAssignment(rows[0]) : null;
}

// true si la asignación es de un curso de la institución, esté vigente o dada de baja.
async function existsInInstitution(teacherAssignmentId, institutionId) {
  const { rows } = await query(EXISTS_IN_INSTITUTION_SQL, [teacherAssignmentId, institutionId]);
  return rows.length > 0;
}

// true si `error` es la violación del índice único de asignacion_docente: la materia ya tiene un
// profesor vigente en ese curso.
function isDuplicateError(error) {
  return error?.code === '23505' && error.constraint === UNIQUE_INDEX;
}

module.exports = { findByInstitution, create, markAsDeleted, existsInInstitution, isDuplicateError };
