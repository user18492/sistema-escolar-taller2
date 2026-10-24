const { query } = require('../database/connection');
const { Institution } = require('../models/institution.model');

// La institución $1.
const FIND_BY_ID_SQL = `
  SELECT institucion_id,
         nombre,
         direccion_calle,
         direccion_altura,
         email,
         telefono,
         cuit
    FROM institucion
   WHERE institucion_id = $1
`;

function toInstitution(row) {
  return new Institution({
    id: row.institucion_id,
    name: row.nombre,
    street: row.direccion_calle,
    streetNumber: row.direccion_altura,
    email: row.email,
    phone: row.telefono,
    cuit: row.cuit,
  });
}

// La institución con ese id, con todos sus datos; null si no existe.
async function findById(institutionId) {
  const { rows } = await query(FIND_BY_ID_SQL, [institutionId]);
  return rows.length > 0 ? toInstitution(rows[0]) : null;
}

module.exports = { findById };
