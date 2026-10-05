const { query } = require('../database/connection');
const { Course } = require('../models/course.model');
const { EDUCATION_LEVEL_BY_COLUMN_VALUE } = require('./grade.repository');

// Listado de los cursos de una institución, de todos los ciclos lectivos, con el nombre y el nivel
// educativo de su grado. El orden es total: primero el ciclo lectivo más reciente y, dentro de
// cada uno, primaria antes que secundaria, el grado (del catálogo, de 1° a 6°), la división y el
// turno; curso_id desempata, así dos consultas sobre los mismos datos dan siempre el mismo orden.
const FIND_BY_INSTITUTION_SQL = `
  SELECT c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo
    FROM curso c
    JOIN grado g ON g.grado_id = c.grado_id
   WHERE c.institucion_id = $1
   ORDER BY c.anio_ciclo_lectivo DESC, g.nivel_educativo, g.nombre, c.division, c.turno, c.curso_id
`;

// Alta en la institución. Devuelve la fila creada, con el nombre y el nivel educativo de su grado.
const CREATE_SQL = `
  WITH created AS (
    INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING curso_id, institucion_id, grado_id, division, turno, anio_ciclo_lectivo
  )
  SELECT c.curso_id,
         c.institucion_id,
         c.grado_id,
         c.division,
         c.turno,
         c.anio_ciclo_lectivo,
         g.nombre AS grado_nombre,
         g.nivel_educativo
    FROM created c
    JOIN grado g ON g.grado_id = c.grado_id
`;

// La base guarda el turno en español (ck_curso_turno, db/schema.sql); el resto del sistema usa
// estos códigos. El nivel educativo, que es del grado, lo traduce grade.repository.js.
const SHIFT_BY_COLUMN_VALUE = {
  MAÑANA: 'MORNING',
  TARDE: 'AFTERNOON',
};

const COLUMN_VALUE_BY_SHIFT = Object.fromEntries(
  Object.entries(SHIFT_BY_COLUMN_VALUE).map(([columnValue, shift]) => [shift, columnValue])
);

// Turnos que admite curso.turno, con los códigos del sistema.
const SHIFTS = Object.keys(COLUMN_VALUE_BY_SHIFT);

// Restricciones de curso (con los nombres que les da db/schema.sql) que rechazan un alta por un
// motivo previsto: el curso ya existe en la institución o su grado no está en el catálogo.
const UNIQUE_CONSTRAINT = 'uq_curso_institucion_grado_division_turno_anio_ciclo_lectivo';
const GRADE_FOREIGN_KEY = 'fk_curso_grado';

function toCourse(row) {
  return new Course({
    id: row.curso_id,
    institutionId: row.institucion_id,
    gradeId: row.grado_id,
    gradeName: row.grado_nombre,
    educationLevel: EDUCATION_LEVEL_BY_COLUMN_VALUE[row.nivel_educativo],
    division: row.division,
    shift: SHIFT_BY_COLUMN_VALUE[row.turno],
    schoolYear: row.anio_ciclo_lectivo,
  });
}

// Cursos de la institución, de todos los ciclos lectivos, ordenados por ciclo lectivo (el más
// reciente primero), nivel educativo, grado, división y turno.
async function findByInstitution(institutionId) {
  const { rows } = await query(FIND_BY_INSTITUTION_SQL, [institutionId]);
  return rows.map(toCourse);
}

// Crea un curso en la institución. `gradeId` es un grado_id del catálogo, `division` una letra
// mayúscula, `shift` uno de SHIFTS y `schoolYear` el año del ciclo lectivo. Devuelve el curso
// creado. Si ya hay uno igual en la institución o el grado no existe, PostgreSQL rechaza el alta:
// ver isDuplicateError e isUnknownGradeError.
async function create(institutionId, { gradeId, division, shift, schoolYear }) {
  const { rows } = await query(CREATE_SQL, [
    institutionId,
    gradeId,
    division,
    COLUMN_VALUE_BY_SHIFT[shift],
    schoolYear,
  ]);
  return toCourse(rows[0]);
}

// true si `error` es la violación de la restricción UNIQUE de curso: la institución ya tiene uno
// con el mismo grado, división, turno y ciclo lectivo.
function isDuplicateError(error) {
  return error?.code === '23505' && error.constraint === UNIQUE_CONSTRAINT;
}

// true si `error` es la violación de fk_curso_grado: el grado no está en el catálogo.
function isUnknownGradeError(error) {
  return error?.code === '23503' && error.constraint === GRADE_FOREIGN_KEY;
}

module.exports = { findByInstitution, create, isDuplicateError, isUnknownGradeError, SHIFTS };
