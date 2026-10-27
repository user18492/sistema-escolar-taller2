const { query } = require('../database/connection');
const { TeacherAssignment } = require('../models/teacher-assignment.model');
const { User } = require('../models/user.model');
const { Course } = require('../models/course.model');
const { Subject } = require('../models/subject.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE } = require('./grade.repository');
const { SHIFT_BY_COLUMN_VALUE } = require('./course.repository');

// Asignaciones docentes con su profesor, su curso y su materia, y si tienen evaluaciones vigentes
// (`tiene_evaluaciones`). `source` es de dónde salen las filas de asignacion_docente: la tabla o el
// CTE con la fila de un alta, de una edición o de una baja.
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
         m.nombre AS materia_nombre,
         EXISTS (SELECT 1
                   FROM evaluacion e
                  WHERE e.asignacion_docente_id = a.asignacion_docente_id
                    AND e.fecha_eliminacion IS NULL) AS tiene_evaluaciones
    FROM ${source} a
    JOIN usuario u ON u.usuario_id = a.usuario_id
    JOIN curso c ON c.curso_id = a.curso_id
    JOIN grado g ON g.grado_id = c.grado_id
    JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
    JOIN materia m ON m.materia_id = gm.materia_id`;

// Listado de las asignaciones docentes vigentes de una institución (las dadas de baja no se
// listan), de todos los ciclos lectivos, con su profesor, su curso y su materia. La institución es
// la del curso: la asignación no la guarda. Solo hace falta mirar la baja de la asignación: su
// curso está vigente, porque uno con asignaciones vigentes no se da de baja y uno dado de baja no
// las recibe (trg_curso_coherencia y trg_asignacion_docente_coherencia, db/schema.sql). En las del
// ciclo lectivo actual, su profesor está vigente: no se puede dar de baja mientras las tenga
// (trg_usuario_asignaciones_vigentes); en las de un ciclo cerrado puede estar dado de baja.
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

// Listado de las asignaciones docentes vigentes de un profesor (las dadas de baja no se listan), de
// todos los ciclos lectivos, con su curso y su materia. No hace falta la institución: la fila de
// usuario es de una sola y sus asignaciones vigentes son de cursos de esa misma
// (trg_asignacion_docente_coherencia, db/schema.sql). Como en FIND_BY_INSTITUTION_SQL, solo hace
// falta mirar la baja de la asignación, porque su curso está vigente: son las que Docencia le
// muestra al administrador para ese profesor.
// El orden es total, el de FIND_BY_INSTITUTION_SQL sin el profesor: primero el ciclo lectivo más
// reciente y, dentro de cada uno, el curso (primaria antes que secundaria, grado, división y turno)
// y la materia; asignacion_docente_id desempata.
const FIND_BY_TEACHER_SQL = `${selectFrom('asignacion_docente')}
   WHERE a.usuario_id = $1
     AND a.fecha_eliminacion IS NULL
   ORDER BY c.anio_ciclo_lectivo DESC,
            g.nivel_educativo, g.nombre, c.division, c.turno, c.curso_id,
            m.nombre, a.asignacion_docente_id
`;

// Cantidad de asignaciones docentes vigentes de una institución, de todos los ciclos lectivos (las
// que lista FIND_BY_INSTITUTION_SQL, con el mismo criterio: solo cuenta la baja de la asignación),
// y de profesores distintos que tienen al menos una.
const COUNT_BY_INSTITUTION_SQL = `
  SELECT COUNT(*)::INT AS total,
         COUNT(DISTINCT a.usuario_id)::INT AS teacher_total
    FROM asignacion_docente a
    JOIN curso c ON c.curso_id = a.curso_id
   WHERE c.institucion_id = $1
     AND a.fecha_eliminacion IS NULL
`;

// Una asignación vigente de un curso de la institución (la del curso: la asignación no la guarda),
// con su profesor, su curso y su materia.
const FIND_ACTIVE_BY_ID_SQL = `${selectFrom('asignacion_docente')}
   WHERE a.asignacion_docente_id = $1
     AND c.institucion_id = $2
     AND a.fecha_eliminacion IS NULL
`;

// Una asignación vigente de un profesor, con su curso y su materia: una de las que lista
// FIND_BY_TEACHER_SQL, con su mismo criterio (no hace falta la institución y solo hace falta mirar
// la baja de la asignación).
const FIND_ACTIVE_BY_ID_AND_TEACHER_SQL = `${selectFrom('asignacion_docente')}
   WHERE a.asignacion_docente_id = $1
     AND a.usuario_id = $2
     AND a.fecha_eliminacion IS NULL
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

// Edición: solo modifica una asignación vigente de un curso de la institución (`previous_course`,
// el que tiene antes del cambio); la base tampoco deja modificar una dada de baja. La materia ($5,
// un materia_id) se busca en el plan de estudios del grado del curso que se guarda ($4), como en el
// alta: si no es de ese grado, o si el curso no existe, no se modifica nada. Si la asignación tiene
// evaluaciones vigentes, la base rechaza el cambio de curso o de materia (no el de profesor).
// Devuelve la fila como quedó, con su profesor, su curso y su materia.
const UPDATE_SQL = `
  WITH updated AS (
    UPDATE asignacion_docente a
       SET usuario_id = $3,
           curso_id = c.curso_id,
           grado_materia_id = gm.grado_materia_id
      FROM curso previous_course,
           curso c
      JOIN grado_materia gm ON gm.grado_id = c.grado_id
     WHERE a.asignacion_docente_id = $1
       AND previous_course.curso_id = a.curso_id
       AND previous_course.institucion_id = $2
       AND a.fecha_eliminacion IS NULL
       AND c.curso_id = $4
       AND gm.materia_id = $5
    RETURNING a.asignacion_docente_id, a.usuario_id, a.curso_id, a.grado_materia_id
  )${selectFrom('updated')}
`;

// Baja lógica: la fila se conserva con la fecha de baja. Solo marca una asignación vigente de un
// curso de la institución (la del curso: la asignación no la guarda), así una segunda baja
// (repetida o simultánea) no pisa la fecha de la primera; la base tampoco lo permitiría. Si la
// asignación tiene evaluaciones vigentes, la base rechaza la baja. Devuelve la fila, con su
// profesor, su curso y su materia.
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

// Reglas que valida trg_asignacion_docente_coherencia, con el nombre que informa cada una
// (db/schema.sql): el profesor de una asignación vigente no está dado de baja ni suspendido, y su
// curso no está dado de baja.
const DELETED_TEACHER_CONSTRAINT = 'ck_asignacion_docente_usuario_vigente';
const SUSPENDED_TEACHER_CONSTRAINT = 'ck_asignacion_docente_usuario_activo';
const DELETED_COURSE_CONSTRAINT = 'ck_asignacion_docente_curso_vigente';

// Regla que valida trg_asignacion_docente_ciclo_lectivo, con el nombre que informa (db/schema.sql):
// una asignación de un curso de un ciclo lectivo cerrado no se crea, no se edita ni se da de baja.
const CLOSED_SCHOOL_YEAR_CONSTRAINT = 'ck_asignacion_docente_ciclo_lectivo_cerrado';

// Reglas que validan trg_asignacion_docente_evaluaciones_vigentes y
// trg_asignacion_docente_calificaciones_vigentes, con el nombre que informa cada una
// (db/schema.sql): una asignación con evaluaciones vigentes no cambia de curso ni de materia y no
// se da de baja. La de calificaciones dispara antes (orden alfabético), así que es la que rechaza el
// cambio de curso de una asignación calificada.
const WITH_EVALUATIONS_CONSTRAINT = 'ck_asignacion_docente_evaluaciones_vigentes';
const WITH_SCORES_CONSTRAINT = 'ck_asignacion_docente_calificaciones_vigentes';

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
    hasEvaluations: row.tiene_evaluaciones,
  });
}

// Asignaciones docentes vigentes de la institución, de todos los ciclos lectivos, ordenadas por
// ciclo lectivo (el más reciente primero), profesor, curso y materia.
async function findByInstitution(institutionId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId]);
  return rows.map(toTeacherAssignment);
}

// Asignaciones docentes vigentes del profesor `teacherId` (un usuario_id), de todos los ciclos
// lectivos, ordenadas por ciclo lectivo (el más reciente primero), curso y materia.
async function findByTeacher(teacherId) {
  const { rows } = await query(FIND_BY_TEACHER_SQL, [teacherId]);
  return rows.map(toTeacherAssignment);
}

// Cuenta las asignaciones docentes vigentes de la institución, de todos los ciclos lectivos (las de
// findByInstitution). Devuelve { total, teacherTotal }: cuántas son y cuántos profesores distintos
// tienen al menos una.
async function countByInstitution(institutionId) {
  const { rows } = await query(COUNT_BY_INSTITUTION_SQL, [institutionId]);
  return { total: rows[0].total, teacherTotal: rows[0].teacher_total };
}

// La asignación vigente con ese id, si es de un curso de la institución; null si no existe en ella
// o fue dada de baja.
async function findActiveById(teacherAssignmentId, institutionId) {
  const { rows } = await query(FIND_ACTIVE_BY_ID_SQL, [teacherAssignmentId, institutionId]);
  return rows.length > 0 ? toTeacherAssignment(rows[0]) : null;
}

// La asignación vigente con ese id, si está a cargo del profesor `teacherId` (un usuario_id); null
// si no existe, fue dada de baja o es de otro profesor.
async function findActiveByIdAndTeacher(teacherAssignmentId, teacherId) {
  const { rows } = await query(FIND_ACTIVE_BY_ID_AND_TEACHER_SQL, [teacherAssignmentId, teacherId]);
  return rows.length > 0 ? toTeacherAssignment(rows[0]) : null;
}

// Crea la asignación vigente del profesor `teacherId` (un usuario_id) en el curso `courseId` para
// la materia `subjectId` (un materia_id). Devuelve la asignación creada; null si la materia no es
// del plan de estudios del grado del curso (o el curso no existe). Si esa materia ya tiene un
// profesor vigente en el curso, PostgreSQL rechaza el alta (ver isDuplicateError), y también si el
// profesor está suspendido o dado de baja (ver isUnavailableTeacherError), si el curso está dado de
// baja (ver isDeletedCourseError) o si es de un ciclo lectivo cerrado (ver isClosedSchoolYearError).
// Que el profesor y el curso se puedan elegir lo comprueba el servicio.
async function create({ teacherId, courseId, subjectId }) {
  const { rows } = await query(CREATE_SQL, [teacherId, courseId, subjectId]);
  return rows.length > 0 ? toTeacherAssignment(rows[0]) : null;
}

// Guarda el profesor, el curso y la materia de una asignación vigente de la institución, con los
// mismos valores que admite create. Devuelve la asignación como quedó; null si no existe en la
// institución o fue dada de baja, o si la materia no es del plan de estudios del grado del curso (o
// el curso no existe). Si esa materia ya tiene un profesor vigente en el curso con otra asignación,
// PostgreSQL rechaza el cambio (ver isDuplicateError): la fila no choca consigo misma, así que
// guardarla con el curso y la materia que ya tenía no es un duplicado. También lo rechaza si el
// profesor está suspendido o dado de baja, aunque sea el que ya tenía (ver
// isUnavailableTeacherError), si el curso nuevo está dado de baja (ver isDeletedCourseError; el que
// tenía está vigente), o si el curso que tenía o el nuevo es de un ciclo lectivo cerrado (ver
// isClosedSchoolYearError): en las asignaciones del ciclo actual el profesor está vigente, aunque
// puede haber quedado suspendido; en las de un ciclo cerrado puede estar dado de baja, pero esas no
// se editan. Si la asignación tiene evaluaciones vigentes, rechaza el cambio de curso o de materia
// (ver isWithEvaluationsError); el de profesor no: el nuevo hereda las evaluaciones. Que el profesor
// y el curso se puedan elegir lo comprueba el servicio.
async function update(teacherAssignmentId, institutionId, { teacherId, courseId, subjectId }) {
  const { rows } = await query(UPDATE_SQL, [teacherAssignmentId, institutionId, teacherId, courseId, subjectId]);
  return rows.length > 0 ? toTeacherAssignment(rows[0]) : null;
}

// Da de baja la asignación, que deja de listarse y de contar para el índice único: su materia se
// puede volver a asignar en ese curso. Devuelve la asignación dada de baja; null si no existe en la
// institución o ya estaba dada de baja. PostgreSQL rechaza la baja si su curso es de un ciclo
// lectivo cerrado (ver isClosedSchoolYearError) o si tiene evaluaciones vigentes (ver
// isWithEvaluationsError).
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

// true si `error` indica que el profesor de la asignación está suspendido o dado de baja.
function isUnavailableTeacherError(error) {
  return error?.code === '23514'
    && (error.constraint === DELETED_TEACHER_CONSTRAINT || error.constraint === SUSPENDED_TEACHER_CONSTRAINT);
}

// true si `error` indica que el curso de la asignación está dado de baja: no recibe asignaciones.
function isDeletedCourseError(error) {
  return error?.code === '23514' && error.constraint === DELETED_COURSE_CONSTRAINT;
}

// true si `error` indica que el curso de la asignación es de un ciclo lectivo cerrado: ese ciclo
// queda en solo lectura.
function isClosedSchoolYearError(error) {
  return error?.code === '23514' && error.constraint === CLOSED_SCHOOL_YEAR_CONSTRAINT;
}

// true si `error` indica que la asignación tiene evaluaciones vigentes, con calificaciones o sin
// ellas: no cambia de curso ni de materia y no se da de baja.
function isWithEvaluationsError(error) {
  return error?.code === '23514'
    && (error.constraint === WITH_EVALUATIONS_CONSTRAINT || error.constraint === WITH_SCORES_CONSTRAINT);
}

module.exports = {
  findByInstitution,
  findByTeacher,
  countByInstitution,
  findActiveById,
  findActiveByIdAndTeacher,
  create,
  update,
  markAsDeleted,
  existsInInstitution,
  isDuplicateError,
  isUnavailableTeacherError,
  isDeletedCourseError,
  isClosedSchoolYearError,
  isWithEvaluationsError,
};
