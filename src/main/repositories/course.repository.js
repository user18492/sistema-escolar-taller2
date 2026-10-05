const { query } = require('../database/connection');
const { Course } = require('../models/course.model');

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

// La base guarda el turno y el nivel educativo en español (ck_curso_turno y
// ck_grado_nivel_educativo, db/schema.sql); el resto del sistema usa estos códigos.
const SHIFT_BY_COLUMN_VALUE = {
  MAÑANA: 'MORNING',
  TARDE: 'AFTERNOON',
};

const EDUCATION_LEVEL_BY_COLUMN_VALUE = {
  PRIMARIA: 'PRIMARY',
  SECUNDARIA: 'SECONDARY',
};

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

module.exports = { findByInstitution };
