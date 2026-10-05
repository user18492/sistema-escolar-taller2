const { query } = require('../database/connection');
const { Grade } = require('../models/grade.model');

// Catálogo completo de grados, común a todas las instituciones. El orden es total y el mismo que
// usa el listado de cursos: primaria antes que secundaria y, dentro de cada nivel, de 1° a 6°.
const FIND_ALL_SQL = `
  SELECT grado_id,
         nombre,
         nivel_educativo
    FROM grado
   ORDER BY nivel_educativo, nombre, grado_id
`;

// La base guarda el nivel educativo en español (ck_grado_nivel_educativo, db/schema.sql); el resto
// del sistema usa estos códigos.
const EDUCATION_LEVEL_BY_COLUMN_VALUE = {
  PRIMARIA: 'PRIMARY',
  SECUNDARIA: 'SECONDARY',
};

function toGrade(row) {
  return new Grade({
    id: row.grado_id,
    name: row.nombre,
    educationLevel: EDUCATION_LEVEL_BY_COLUMN_VALUE[row.nivel_educativo],
  });
}

// Todos los grados del catálogo, ordenados por nivel educativo y nombre.
async function findAll() {
  const { rows } = await query(FIND_ALL_SQL);
  return rows.map(toGrade);
}

module.exports = { findAll, EDUCATION_LEVEL_BY_COLUMN_VALUE };
