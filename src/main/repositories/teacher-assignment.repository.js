const { query } = require('../database/connection');
const { TeacherAssignment } = require('../models/teacher-assignment.model');
const { User } = require('../models/user.model');
const { Course } = require('../models/course.model');
const { Subject } = require('../models/subject.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE, COLUMN_VALUE_BY_EDUCATION_LEVEL } = require('./grade.repository');
const { SHIFT_BY_COLUMN_VALUE, COLUMN_VALUE_BY_SHIFT } = require('./course.repository');

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

// Las asignaciones docentes vigentes de un curso, con su profesor y su materia: las materias que
// tienen un profesor en el curso. Con el criterio de FIND_BY_INSTITUTION_SQL, solo hace falta mirar
// la baja de la asignación. Por nombre de materia: un curso tiene a lo sumo una asignación vigente
// por materia (uq_asignacion_docente_curso_grado_materia, db/schema.sql) y el nombre no se repite en
// el catálogo, así que el orden es total; asignacion_docente_id desempata igual.
const FIND_BY_COURSE_SQL = `${selectFrom('asignacion_docente')}
   WHERE a.curso_id = $1
     AND a.fecha_eliminacion IS NULL
   ORDER BY m.nombre, a.asignacion_docente_id
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

// Reporte Materias sin docente por curso: los cursos vigentes de la institución ($1) en el ciclo
// lectivo $2, de un nivel educativo ($3) y de un turno ($4), con los valores de la base (NULL =
// todos), y por cada uno las materias del plan de estudios de su grado (grado_materia) con su
// asignación vigente, si tiene: a lo sumo una por materia (uq_asignacion_docente_curso_grado_materia,
// db/schema.sql). Un grado sin plan da 0 materias, y entonces las dos listas quedan vacías.
//   - subject_count: las materias del plan.
//   - unassigned: los nombres de las que no tienen docente, por nombre. Cuenta también la de un
//     profesor dado de baja: en el ciclo actual no puede tener asignaciones vigentes
//     (trg_usuario_asignaciones_vigentes), pero en uno cerrado su asignación sigue vigente a su
//     nombre, y esa materia queda sin docente (decisión del usuario).
//   - suspended: las que tienen la asignación vigente de un profesor suspendido (estado FALSE y sin
//     baja), con la materia, el nombre y el apellido, por nombre de materia.
// Las dos listas son '{}' si no hay ninguna (array_agg con FILTER da NULL). El orden es el del
// listado de cursos (course.repository.js): nivel educativo, grado, división y turno; curso_id
// desempata.
const FIND_SUBJECT_COVERAGE_SQL = `
  SELECT c.curso_id,
         g.nombre AS grado_nombre,
         g.nivel_educativo,
         c.division,
         c.turno,
         COUNT(gm.grado_materia_id)::INT AS subject_count,
         COALESCE(array_agg(m.nombre ORDER BY m.nombre)
                    FILTER (WHERE gm.grado_materia_id IS NOT NULL
                              AND (a.asignacion_docente_id IS NULL OR u.fecha_eliminacion IS NOT NULL)),
                  '{}') AS unassigned,
         COALESCE(array_agg(json_build_object('subject_name', m.nombre,
                                              'first_name', u.nombre,
                                              'last_name', u.apellido) ORDER BY m.nombre)
                    FILTER (WHERE u.estado = FALSE AND u.fecha_eliminacion IS NULL),
                  '{}') AS suspended
    FROM curso c
    JOIN grado g ON g.grado_id = c.grado_id
    LEFT JOIN grado_materia gm ON gm.grado_id = c.grado_id
    LEFT JOIN materia m ON m.materia_id = gm.materia_id
    LEFT JOIN asignacion_docente a ON a.curso_id = c.curso_id
                                  AND a.grado_materia_id = gm.grado_materia_id
                                  AND a.fecha_eliminacion IS NULL
    LEFT JOIN usuario u ON u.usuario_id = a.usuario_id
   WHERE c.institucion_id = $1
     AND c.fecha_eliminacion IS NULL
     AND c.anio_ciclo_lectivo = $2
     AND ($3::VARCHAR IS NULL OR g.nivel_educativo = $3)
     AND ($4::VARCHAR IS NULL OR c.turno = $4)
   GROUP BY c.curso_id, g.grado_id
   ORDER BY g.nivel_educativo, g.nombre, c.division, c.turno, c.curso_id
`;

// Reporte Carga docente por profesor: los profesores (rol PROFESOR) de la institución ($1) que no
// están dados de baja, activos y suspendidos, con sus asignaciones vigentes de cursos vigentes del
// ciclo lectivo $2, de un nivel educativo ($3) y de un turno ($4), con los valores de la base
// (NULL = todos). Las condiciones de la asignación y de su curso van en el LEFT JOIN, no en el
// WHERE, para conservar a los profesores que no tienen ninguna (cuentan 0). No hace falta mirar la
// institución del curso: las asignaciones vigentes de un usuario son de cursos de su institución
// (trg_asignacion_docente_coherencia, db/schema.sql).
//   - assignment_count: las asignaciones.
//   - assignments: el curso (grado, división y turno) y la materia de cada una, en el orden del
//     listado de cursos (nivel educativo, grado, división y turno) y por materia; '[]' si no tiene
//     ninguna (json_agg con FILTER da NULL).
// Limitación en un ciclo pasado: lista a los profesores no dados de baja hoy. usuario no guarda la
// fecha de alta, así que puede aparecer con 0 uno que entró después de ese ciclo, y no aparece uno
// dado de baja después, aunque haya tenido asignaciones en él.
// El orden es total: de más a menos asignaciones y, con la misma cantidad, por apellido y nombre;
// usuario_id desempata entre dos que se llaman igual.
const COUNT_BY_TEACHER_SQL = `
  SELECT u.usuario_id,
         u.nombre,
         u.apellido,
         u.estado,
         COUNT(a.asignacion_docente_id)::INT AS assignment_count,
         COALESCE(json_agg(json_build_object('grade_name', g.nombre,
                                             'division', c.division,
                                             'shift', c.turno,
                                             'subject_name', m.nombre)
                           ORDER BY g.nivel_educativo, g.nombre, c.division, c.turno, m.nombre)
                    FILTER (WHERE a.asignacion_docente_id IS NOT NULL),
                  '[]'::JSON) AS assignments
    FROM usuario u
    JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
    LEFT JOIN (asignacion_docente a
               JOIN curso c ON c.curso_id = a.curso_id
               JOIN grado g ON g.grado_id = c.grado_id
               JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
               JOIN materia m ON m.materia_id = gm.materia_id)
           ON a.usuario_id = u.usuario_id
          AND a.fecha_eliminacion IS NULL
          AND c.fecha_eliminacion IS NULL
          AND c.anio_ciclo_lectivo = $2
          AND ($3::VARCHAR IS NULL OR g.nivel_educativo = $3)
          AND ($4::VARCHAR IS NULL OR c.turno = $4)
   WHERE u.institucion_id = $1
     AND r.nombre = 'PROFESOR'
     AND u.fecha_eliminacion IS NULL
   GROUP BY u.usuario_id
   ORDER BY assignment_count DESC, u.apellido, u.nombre, u.usuario_id
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

// Asignaciones docentes vigentes del curso `courseId` (un curso_id), ordenadas por nombre de
// materia. Lista vacía si no tiene ninguna o si el curso no existe: que sea un curso de la
// institución lo comprueba el servicio.
async function findByCourse(courseId) {
  const { rows } = await query(FIND_BY_COURSE_SQL, [courseId]);
  return rows.map(toTeacherAssignment);
}

// Cuenta las asignaciones docentes vigentes de la institución, de todos los ciclos lectivos (las de
// findByInstitution). Devuelve { total, teacherTotal }: cuántas son y cuántos profesores distintos
// tienen al menos una.
async function countByInstitution(institutionId) {
  const { rows } = await query(COUNT_BY_INSTITUTION_SQL, [institutionId]);
  return { total: rows[0].total, teacherTotal: rows[0].teacher_total };
}

// Cobertura de las materias de los cursos vigentes de la institución en el ciclo lectivo
// `schoolYear` (un año), con `educationLevel` (uno de EDUCATION_LEVELS de grade.repository.js) y
// `shift` (uno de SHIFTS de course.repository.js) o null para todos. Por curso, en el orden del
// listado de cursos: { courseId, gradeName, educationLevel, division, shift, subjectCount,
// unassignedSubjects, suspendedSubjects }, con unassignedSubjects los nombres de las materias sin
// docente y suspendedSubjects { subjectName, teacherFirstName, teacherLastName } de las que tienen
// un profesor suspendido (ver FIND_SUBJECT_COVERAGE_SQL).
async function findSubjectCoverage(institutionId, { schoolYear, educationLevel, shift }) {
  const { rows } = await query(FIND_SUBJECT_COVERAGE_SQL, [
    institutionId,
    schoolYear,
    educationLevel ? COLUMN_VALUE_BY_EDUCATION_LEVEL[educationLevel] : null,
    shift ? COLUMN_VALUE_BY_SHIFT[shift] : null,
  ]);
  return rows.map((row) => ({
    courseId: row.curso_id,
    gradeName: row.grado_nombre,
    educationLevel: EDUCATION_LEVEL_BY_COLUMN_VALUE[row.nivel_educativo],
    division: row.division,
    shift: SHIFT_BY_COLUMN_VALUE[row.turno],
    subjectCount: row.subject_count,
    unassignedSubjects: row.unassigned,
    suspendedSubjects: row.suspended.map((subject) => ({
      subjectName: subject.subject_name,
      teacherFirstName: subject.first_name,
      teacherLastName: subject.last_name,
    })),
  }));
}

// Carga docente de los profesores no dados de baja de la institución (activos y suspendidos, también
// sin asignaciones) en el ciclo lectivo `schoolYear` (un año), con `educationLevel` (uno de
// EDUCATION_LEVELS de grade.repository.js) y `shift` (uno de SHIFTS de course.repository.js) o null
// para todos. Por profesor, de más a menos asignaciones: { teacherId, firstName, lastName,
// suspended, assignmentCount, assignments }, con assignments { gradeName, division, shift,
// subjectName } de cada asignación (ver COUNT_BY_TEACHER_SQL, también su limitación en los ciclos
// pasados).
async function countByTeacher(institutionId, { schoolYear, educationLevel, shift }) {
  const { rows } = await query(COUNT_BY_TEACHER_SQL, [
    institutionId,
    schoolYear,
    educationLevel ? COLUMN_VALUE_BY_EDUCATION_LEVEL[educationLevel] : null,
    shift ? COLUMN_VALUE_BY_SHIFT[shift] : null,
  ]);
  return rows.map((row) => ({
    teacherId: row.usuario_id,
    firstName: row.nombre,
    lastName: row.apellido,
    suspended: !row.estado,
    assignmentCount: row.assignment_count,
    assignments: row.assignments.map((assignment) => ({
      gradeName: assignment.grade_name,
      division: assignment.division,
      shift: SHIFT_BY_COLUMN_VALUE[assignment.shift],
      subjectName: assignment.subject_name,
    })),
  }));
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
  findByCourse,
  countByInstitution,
  findSubjectCoverage,
  countByTeacher,
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
